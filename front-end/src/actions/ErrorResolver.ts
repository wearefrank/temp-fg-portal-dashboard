import type {ErrorObject} from "ajv";

export interface ResolvedError {
    message: string;
    path: string;
    errorObject?: AjvErrorCollection;
    sourceError?: ErrorObject;
    hint?: FieldHint;
}

export interface FieldHint {
    field: string;
    type: errorType;
    possibleOptions?: unknown;
    default?: unknown;
    minimum?: number;
    maximum?: number;
}

export interface AjvErrorCollection {
    parent: string,
    type: string,
    sourceErrors: ErrorObject[]
}

interface ClassifiedErrors {
    direct: ErrorObject[];
    ifThenWrappers: ErrorObject[];
    ifThenLeaves: ErrorObject[];
    oneOfErrors: ErrorObject[];
}

interface IfConditionProperties {
    field: string,
    kind: 'enum' | 'const',
    values: string[];
}

type MatchResult = 'match' | 'vacuous' | 'no-match' | 'unknown';

type errorType = 'anyof' | 'direct';

class ErrorResolver {
    // these keywords are internal to our validation pipeline and don't make sense to show to the user
    private skippedKeywords = ['detectPlugins', 'detectPluginMetadata'];

    public resolve(collections: AjvErrorCollection[]): ResolvedError[] {
        const resolvedErrors: ResolvedError[] = [];

        for (const ajvErrors of collections) {

            const filteredErrors = ajvErrors.sourceErrors.filter(
                e => !this.skippedKeywords.includes(e.keyword)
            );

            if (filteredErrors.length == 0) continue;

            // AJV dumps a big flat list of errors we need to sort them into buckets first
            // so we know how to explain each one in a way that actually makes sense to the user
            const classified = this.classifyErrors(filteredErrors);
            const messages: ResolvedError[] = [];

            if (classified.direct.length > 0) {
                messages.push(...this.resolveDirectErrors(classified.direct, ajvErrors))
            }
            if (classified.ifThenWrappers.length > 0) {
                // only show if/then branch errors when the condition actually applied to the data
                messages.push(...this.resolveBranchErrors(classified.ifThenWrappers, classified.ifThenLeaves, ajvErrors))
            }
            if (classified.oneOfErrors.length > 0) {
                // pass the leaf errors too so we can drill into the right branch when needed
                messages.push(...this.resolveOneOfErrors(classified.oneOfErrors, classified.ifThenLeaves, ajvErrors))
            }

            resolvedErrors.push(...messages)
        }

        return resolvedErrors;
    }

    private resolveOneOfErrors(errors: ErrorObject[], leaves: ErrorObject[], entry: AjvErrorCollection): ResolvedError[] {
        const resolvedErrors: ResolvedError[] = [];

        for (const error of errors) {
            const schema = error.schema;
            const data = error.data;

            if (!Array.isArray(schema)) continue;

            // the generic "score by matching keys" logic below won't work as arrays/scalars don't have keys
            // instead we look at which oneOf branch's declared type matches this value's actual type
            if (!this.isObject(data)) {
                const dataType = Array.isArray(data) ? 'array' : (data === null ? 'null' : typeof data);
                const branchIdx = (schema as Record<string, unknown>[]).findIndex(b => b.type === dataType);
                if (branchIdx >= 0) {
                    // the leaf errors from AJV already contain the details (e.g. missing required field),
                    // we just need to find the ones that belong to the matching branch
                    const branchLeaves = this.drillBranchLeaves(error.schemaPath, branchIdx, leaves);
                    for (const leaf of branchLeaves) {
                        resolvedErrors.push({
                            message: `${entry.parent}: ${this.formatDirectError(leaf)}`,
                            path: this.buildResolvedPath(entry, this.getExactPath(leaf)),
                            errorObject: entry,
                            sourceError: leaf,
                        });
                    }
                } else {
                    // the value's type doesn't match any branch at all (e.g. a boolean where only integer/string are allowed) -
                    // there are no leaf errors to drill into here, so report the type mismatch directly.
                    // dedupe since branches often share a type and only differ by format/pattern
                    const allowedTypes = [...new Set(
                        (schema as Record<string, unknown>[]).map(b => typeof b.type === 'string' ? b.type : '(unknown)')
                    )];

                    // a numeric last segment is an array index (e.g. whitelist/1), not a field name
                    const lastSegment = error.instancePath.split('/').pop();
                    const subject = !lastSegment
                        ? `'${entry.parent}'`
                        : /^\d+$/.test(lastSegment) ? `item ${lastSegment}` : `'${lastSegment}'`;

                    resolvedErrors.push({
                        message: `${entry.parent}: ${subject} must be ${allowedTypes.join(' or ')}, got ${dataType}`,
                        path: this.buildResolvedPath(entry, this.getExactPath(error)),
                        errorObject: entry,
                        sourceError: error,
                    });
                }
                continue;
            }

            if (error.params?.passingSchemas != null) {
                // AJV already knows which branches matched, use oneOf only
                // this means the data matched more than one branch, which oneOf doesn't allow
                const passing = error.params.passingSchemas as number[];
                const allOptions = this.gatherOneOfOptions(schema);
                const conflicting = passing.map(i => allOptions[i] || ['(unknown variant)']);

                resolvedErrors.push({
                    message: `${entry.parent}: ${error.keyword} — matches multiple variants, pick one:\n| ${this.formatOptions(conflicting)}`,
                    path: this.buildResolvedPath(entry, this.getExactPath(error)),
                    errorObject: entry,
                    sourceError: error,
                });
                continue;
            }

            // try the specific leaf error (e.g. failed minimum) before falling back to guessing
            const objectBranchLeaves = this.collectObjectBranchLeaves(schema, error.schemaPath, leaves);
            if (objectBranchLeaves.length > 0) {
                for (const leaf of objectBranchLeaves) {
                    resolvedErrors.push({
                        message: `${entry.parent}: ${this.formatDirectError(leaf)}`,
                        path: this.buildResolvedPath(entry, this.getExactPath(leaf)),
                        errorObject: entry,
                        sourceError: leaf,
                    });
                }
                continue;
            }

            // no branch matched at all score each branch by how many of the user's fields appear in it
            const scored = this.matchOneOfErrors(schema, data);

            const fieldHint: FieldHint = {
                field: entry.parent,
                type: 'anyof',
                possibleOptions: scored
            }

            resolvedErrors.push({
                message: `${entry.parent}: ${error.keyword} — no variant matched. Closest options:\n| ${this.formatOptions(scored)}`,
                path: this.buildResolvedPath(entry, this.getExactPath(error)),
                errorObject: entry,
                sourceError: error,
                hint: fieldHint
            });
        }

        return resolvedErrors;
    }

    // finds AJV's leaf errors nested under a given anyOf/oneOf branch index
    private drillBranchLeaves(schemaPath: string, branchIdx: number, leaves: ErrorObject[]): ErrorObject[] {
        const prefix = `${schemaPath}/${branchIdx}/`;
        return leaves.filter(leaf => leaf.schemaPath.startsWith(prefix));
    }

    // only branches explicitly typed "object" are treated as candidates for the data
    private collectObjectBranchLeaves(schema: unknown, schemaPath: string, leaves: ErrorObject[]): ErrorObject[] {
        if (!Array.isArray(schema)) return [];

        const result: ErrorObject[] = [];
        schema.forEach((branch, idx) => {
            if (!this.isObject(branch) || branch.type !== 'object') return;
            result.push(...this.drillBranchLeaves(schemaPath, idx, leaves));
        });
        return result;
    }

    private matchOneOfErrors(branch: unknown, data:unknown): string[][] {
        if (!Array.isArray(branch)) return [];

        const dataKeys = this.isObject(data) ? Object.keys(data) : [];
        const optionsWithMatches: { opts: string[]; matchCount: number }[] = [];

        let maxHits = 0;

        for (const error of branch) {
            const opts = this.gatherOneOfOptionsFromBranch(error);

            // count how many fields the user already provided that appear in this branch
            // so we can rank which branch they were probably trying to fill in
            const matchCount = opts.filter(opt => dataKeys.includes(opt)).length;

            if (matchCount > maxHits){
                maxHits = matchCount;
            }

            optionsWithMatches.push({ opts, matchCount });
        }

        // only keep the branches that tied for most matches
        const filteredOptions = optionsWithMatches.filter(
            a => a.matchCount >= maxHits
        );

        filteredOptions.sort(
            (a, b) => b.matchCount - a.matchCount
        );

        return filteredOptions.map(item => item.opts);
    }

    private formatOptions = (options: string[][]) => {
        return `${options.map(opt => opt.join(', ')).join('\n| ')}`;
    };

    private gatherOneOfOptions(schema: unknown): string[][] {
        if (!Array.isArray(schema)) return [];

        const options: string[][] = [];

        for (const branch of schema) {
            options.push(this.gatherOneOfOptionsFromBranch(branch));
        }
        return options;
    }

    private gatherOneOfOptionsFromBranch(branch: unknown): string[] {
        if (!this.isObject(branch)) return [];

        let subOptions: string[] = [];

        // prefer required fields as the label
        if (Array.isArray(branch.required)) {
            subOptions = branch.required.map((item) => item.toString());
            return subOptions;
        }

        if (this.isObject(branch.properties)) {
            subOptions = Object.keys(branch.properties);
            return subOptions;
        }

        // array-of-objects form (e.g. nodes: [{host, port, weight}])
        if (this.isObject(branch.items)) {
            const items = branch.items;
            if (Array.isArray(items.required)) {
                return [`array of {${items.required.join(', ')}}`];
            }
            if (this.isObject(items.properties)) {
                return [`array of {${Object.keys(items.properties).join(', ')}}`];
            }
            return ['array'];
        }

        // map form (e.g. nodes: {"host:port": weight})
        if (this.isObject(branch.patternProperties)) {
            return ['object (key: value map)'];
        }

        // mutual-exclusion guard (e.g. "neither host nor hosts is set") - describe by what it excludes
        if (this.isObject(branch.not)) {
            const excluded = this.gatherRequiredFields(branch.not);
            if (excluded.length > 0) {
                return [`none of: ${excluded.join(', ')}`];
            }
        }

        // bare type with no further constraints (e.g. oneOf: [{type: "string"}, {type: "object"}])
        if (typeof branch.type === 'string') {
            return [branch.type];
        }

        // fixed value(s) with no type of their own (e.g. anyOf: [{type: "array", ...}, {enum: ["*"]}])
        if (Array.isArray(branch.enum)) {
            return [`value: ${branch.enum.map(String).join(' or ')}`];
        }
        if ('const' in branch) {
            return [`value: ${String(branch.const)}`];
        }

        return ['(unknown variant)'];
    }

    // collects "required" field names from a schema and its direct anyOf/oneOf sub-branches
    private gatherRequiredFields(schema: unknown): string[] {
        if (!this.isObject(schema)) return [];

        if (Array.isArray(schema.required)) {
            return schema.required.map(String);
        }

        const subBranches = schema.anyOf ?? schema.oneOf;
        if (Array.isArray(subBranches)) {
            return subBranches.flatMap(b => this.gatherRequiredFields(b));
        }

        return [];
    }

    private classifyErrors(errors: ErrorObject[]): ClassifiedErrors {
        const result: ClassifiedErrors = {
            direct: [],
            ifThenWrappers: [],
            ifThenLeaves: [],
            oneOfErrors: [],
        };

        for (const error of errors) {
            if (error.keyword === 'if') {
                result.ifThenWrappers.push(error)
                continue;
            }

            if (error.keyword === 'anyOf' || error.keyword === 'oneOf') {
                result.oneOfErrors.push(error)
                continue
            }

            if (this.isUnderBranchPath(error)) {
                result.ifThenLeaves.push(error)
                continue;
            }

            result.direct.push(error);
        }

        return result;
    }

    private isUnderBranchPath(errorObj: ErrorObject): boolean {
        return /\/(then|else|anyOf|oneOf)\//.test(errorObj.schemaPath);
    }

    private resolveBranchErrors(ifThenWrappers: ErrorObject[], ifThenLeaves: ErrorObject[], entry: AjvErrorCollection): ResolvedError[] {
        const resolvedErrors: ResolvedError[] = [];

        if (ifThenLeaves.length === 0) return resolvedErrors;

        ifThenWrappers.forEach(wrapper => {
            const ifSchema = wrapper.parentSchema?.if as Record<string, unknown> | undefined;
            const data = wrapper.data;

            if (!ifSchema) return;

            const properties = ifSchema.properties as Record<string, unknown> | undefined;
            if (!properties) return;

            const parsed: IfConditionProperties[] = [];
            for (const [field, constraint] of Object.entries(properties)) {
                const p = this.parseIfSchemaProperties(field, constraint);
                if (p) {
                    parsed.push(p);
                }
            }

            const matchResult = this.evaluateIfCondition(parsed, data);

            if (matchResult === 'match') {
                // the if condition matched the data so the then/else branch errors are relevant
                const prefix = wrapper.schemaPath.replace(/\/if$/, '');

                const ownedLeaves = ifThenLeaves.filter(
                    leaf => leaf.schemaPath.startsWith(`${prefix}/then/`)
                        || leaf.schemaPath.startsWith(`${prefix}/else/`)
                );

                const conditionString = this.buildConditionString(parsed);

                ownedLeaves.forEach(leaf => {
                    resolvedErrors.push({
                        message: `${entry.parent}: when ${conditionString}, ${this.formatDirectError(leaf)}`,
                        path: this.buildResolvedPath(entry, this.getExactPath(leaf)),
                        errorObject: entry,
                        sourceError: leaf,
                    });
                });
            } else if (matchResult === 'vacuous') {
                resolvedErrors.push(...this.handleVacuousErrors(wrapper, parsed, entry))
            }
            // silent skip
        });

        return resolvedErrors;
    }


    private handleVacuousErrors(wrapper: ErrorObject, parsed: IfConditionProperties[], entry: AjvErrorCollection): ResolvedError[] {
        const field = parsed[0]?.field;

        if (!field) return [];

        const schema = wrapper.parentSchema;

        if (!schema) return [];

        if (this.isObject(schema) && this.isObject(schema.properties) && field in schema.properties) {

            const propDef = schema.properties[field];
            const relPath = wrapper.instancePath ? `${wrapper.instancePath}/${field}` : `/${field}`;
            const exactPath = this.buildResolvedPath(entry, relPath);

            if (!this.isObject(propDef)) return [];

            let options: string[];
            if (Array.isArray(propDef.enum)) {
                options = propDef.enum.map(String);
            } else if ('const' in propDef) {
                options = [String(propDef.const)];
            } else {
                return [{
                    message: `${entry.parent}: '${field}' could not find any constraint properties.`,
                    path: exactPath,
                    errorObject: entry,
                    sourceError: wrapper,
                }];
            }

            if (options.length === 0) {
                return [{
                    message: `${entry.parent}: '${field}' is required`,
                    path: exactPath,
                    errorObject: entry,
                    sourceError: wrapper,
                }];
            }

            const defaultValue = 'default' in propDef ? String(propDef.default) : undefined;
            const defaultNote = defaultValue ? ` (default: '${defaultValue}')` : '';

            return [{
                message: `${entry.parent}: '${field}' is required${defaultNote}, options: ${options.join(', ')}`,
                path: exactPath,
                errorObject: entry,
                sourceError: wrapper,
                hint: defaultValue !== undefined ? { field: exactPath, type: 'direct', default: propDef.default } : undefined,
            }];
        }
        return [];
    }

    private buildConditionString(parsedConstraints: IfConditionProperties[]): string {
        const parts = parsedConstraints.map(constraint => {
            if (constraint.values.length === 1) {
                return `'${constraint.field}' is '${constraint.values[0]}'`;
            }
            return `'${constraint.field}' is one of: ${constraint.values.join(', ')}`;
        });

        return parts.join(' and ');
    }

    private evaluateIfCondition(parsedConstraints: IfConditionProperties[], data: unknown): MatchResult {
        if (parsedConstraints.length === 0) return 'unknown';

        if (!this.isObject(data)) return 'vacuous';

        let allVacuous = true;

        for (const constraint of parsedConstraints) {
            // field not in data at all can't say if the condition matches yet
            if (!(constraint.field in data)) {
                continue;
            }

            allVacuous = false;

            if (constraint.values.includes(String(data[constraint.field]))) {
                continue;
            }

            return 'no-match';
        }

        if (allVacuous) {
            return 'vacuous';
        }

        return 'match';
    }

    private parseIfSchemaProperties(field: string, constraint: unknown): IfConditionProperties | null {

        if (!field || !(constraint && typeof constraint === 'object')) {
            return null;
        }

        if ('const' in constraint) {
            return {
                field: field,
                kind: 'const',
                values: [String(constraint.const)],
            };
        } else if ('enum' in constraint && Array.isArray(constraint.enum)) {
            return {
                field: field,
                kind: 'enum',
                values: constraint.enum.map(String),
            };
        }
        return null;
    }

    private getExactPath(err: ErrorObject): string {
        const base = err.instancePath;
        switch (err.keyword) {
            case 'required': {
                // AJV puts the missing field name in params not in the path itself
                const field = err.params?.missingProperty ?? '';
                return base ? `${base}/${field}` : `/${field}`;
            }
            case 'additionalProperties': {
                const field = err.params?.additionalProperty ?? '';
                return base ? `${base}/${field}` : `/${field}`;
            }
            default:
                return base;
        }
    }

    // plugin errors use a full path as the type (e.g. /routes/0/plugins/limit-count)
    // for everything else we just use the field path directly
    private buildResolvedPath(entry: AjvErrorCollection, exactPath: string): string {
        if (entry.type.startsWith('/')) {
            return `${entry.type}${exactPath}`;
        }
        return exactPath || entry.type;
    }

    private resolveDirectErrors(
        errors: ErrorObject[],
        entry: AjvErrorCollection
    ): ResolvedError[] {
        return errors.map(err => ({
            message: `${entry.parent}: ${this.formatDirectError(err)}`,
            path: this.buildResolvedPath(entry, this.getExactPath(err)),
            errorObject: entry,
            sourceError: err,
        }));
    }

    private formatDirectError(err: ErrorObject): string {

        const path = err.instancePath;
        const prop = path.split('/').pop() ?? 'unknown';

        switch (err.keyword) {
            case 'required':
                return `missing required property '${err.params?.missingProperty ?? 'unknown'}'`;
            case 'additionalProperties':
                return `unknown property '${err.params?.additionalProperty ?? 'unknown'}'`;
            case 'type':
                return `'${prop}' must be ${err.params?.type ?? 'unknown'}`;
            case 'enum':
                return `'${prop}' must be one of: ${(err.params?.allowedValues ?? []).join(', ')}`;
            case 'minimum':
                return `'${prop}' must be >= ${err.params?.limit}`;
            case 'maximum':
                return `'${prop}' must be <= ${err.params?.limit}`;
            case 'minLength':
                return `'${prop}' must be at least ${err.params?.limit} characters`;
            case 'minItems':
                return `'${prop}' must have at least ${err.params?.limit} items`;
            case 'pattern':
                return `'${prop}' does not match required pattern: ${err.params?.pattern ?? 'unknown'}`;
            case 'not': {
                // schema-form "dependencies" compiles to a bare "not" error with no field names in params
                const excluded = this.gatherRequiredFields(err.schema);
                if (excluded.length > 0) {
                    const trigger = err.schemaPath.match(/\/dependencies\/([^/]+)\/not$/)?.[1];
                    return trigger
                        ? `'${trigger}' cannot be combined with: ${excluded.join(', ')}`
                        : `must not also set: ${excluded.join(', ')}`;
                }
                return err.message ?? 'unknown validation error';
            }
            default:
                return err.message ?? 'unknown validation error';
        }
    }

    private isObject(val: unknown): val is Record<string, unknown> {
        return val !== null && typeof val === 'object' && !Array.isArray(val);
    }


}

export default ErrorResolver