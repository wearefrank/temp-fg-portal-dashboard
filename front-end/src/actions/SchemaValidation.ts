import Ajv, {type ErrorObject, type ValidateFunction} from 'ajv';
import addFormats from 'ajv-formats';
import type {DataValidationCxt} from "ajv/lib/types";
import { getResourceType } from './ValidationLogger';
import type {AjvErrorCollection} from "./ErrorResolver.ts";

// Type aliases for better readability
export type JsonSchema = Record<string, unknown>;
export type PluginConfiguration = Record<string, unknown>;
export type ResourceConfiguration = Record<string, unknown>;

export interface ApisixConfig {
    routes?: ResourceConfiguration[];
    [key: string]: unknown; // fallback for unknown keys
}

interface PluginDef {
    schema?: JsonSchema;
    consumer_schema?: JsonSchema;
    [key: string]: unknown; // fallback for unknown keys
}

export interface SchemaCatalog {
    plugins?: Record<string, PluginDef>;
    stream_plugins?: Record<string, PluginDef>;
    main?: JsonSchema;
    [key: string]: unknown; // fallback for unknown keys
}

export interface RawConfigValidation {
    valid: boolean;
    errorCollections: AjvErrorCollection[];
    warningErrors: ErrorObject[];
    warnings: Array<{ message: string; path: string }>;
}

interface PluginValidator {
    (
        schema: JsonSchema,
        data: unknown,
        parentSchema?: unknown,
        dataCtx?: DataValidationCxt
    ): boolean;
    errors?: Partial<ErrorObject>[];
}

export class SchemaValidator {
    private readonly ajv: Ajv;
    private schema: SchemaCatalog | null = null;
    private config: ApisixConfig | null = null;
    private pluginErrorBatch: AjvErrorCollection[] = [];
    private pluginWarningBatch: Array<{ message: string; path: string }> = [];
    private fillInDefaults: boolean = false;

    // cache of plugin schemas, keyed by plugin name
    private pluginSchemasCache: Map<string, ValidateFunction> = new Map();

    // cache of the compiled root validator - reset when schema changes
    private compiledRootValidator: ValidateFunction | null = null;

    constructor() {
        this.ajv = new Ajv({
            allErrors: true,
            strict: false,
            verbose: true,
            // useDefaults: 'empty',
        });
        addFormats(this.ajv);

        this.addPluginDetection();
    }

    public validateConfig(): RawConfigValidation {
        this.pluginErrorBatch = [];
        this.pluginWarningBatch = [];

        if (!this.config) {
            return { valid: false, errorCollections: [], warningErrors: [], warnings: [] };
        }

        if (!this.schema?.main || !this.isJsonSchema(this.schema.main)) {
            return { valid: false, errorCollections: [], warningErrors: [], warnings: [] };
        }

        // clone before mutating - this.schema.main is the same object handed to the Monaco/monaco-yaml
        // schema sync (see monacoSchemaSync.ts), which doesn't know about our detectPlugins keyword
        const definitions = structuredClone(this.schema.main);

        // mutate definitions to inject the detectPlugins keyword on every `plugins` property
        this.injectPluginDetectionProperties(definitions);

        // we get the proper plugin schema and give it to the validator
        const properties = this.buildValidationProperties(definitions);

        // compile once and reuse - reset by setSchema() or setConfig() when input changes
        if (!this.compiledRootValidator) {
            this.compiledRootValidator = this.ajv.compile({
                type: 'object',
                properties,
                definitions,
                additionalProperties: false,
            });
        }
        const validate = this.compiledRootValidator;

        const payloadToValidate = structuredClone(this.config);
        this.applyConfigDefaults(payloadToValidate, definitions, properties);

        if (validate(payloadToValidate)) {
            return { valid: true, errorCollections: [...this.pluginErrorBatch], warningErrors: [], warnings: [...this.pluginWarningBatch] };
        }

        // additionalProperties errors are shown as warnings - they are common in APISIX configs
        // that carry fields not yet in the schema (e.g. future APISIX versions)
        const warningErrors: ErrorObject[] = [];
        const schemaErrors: ErrorObject[] = [];

        for (const err of (validate.errors ?? [])) {
            if (err.keyword === 'additionalProperties') {
                warningErrors.push(err);
            } else {
                schemaErrors.push(err);
            }
        }

        const filteredSchemaErrors = this.filterTemplateErrors(schemaErrors, payloadToValidate);

        const errorCollections: AjvErrorCollection[] = [];
        if (filteredSchemaErrors.length > 0) {
            errorCollections.push({ type: 'root', parent: 'config', sourceErrors: filteredSchemaErrors });
        }
        errorCollections.push(...this.pluginErrorBatch);

        const isValid = errorCollections.length === 0;
        return { valid: isValid, errorCollections, warningErrors, warnings: [...this.pluginWarningBatch] };
    }

    public addPluginDetection() {
        const validatePlugins: PluginValidator = (
            _schema: JsonSchema,
            data: unknown,
            _parentSchema: unknown,
            dataCtx?: DataValidationCxt,
        ) => {
            const path = dataCtx?.instancePath || '';
            const pluginsData = (data || {}) as Record<string, PluginConfiguration>;

            let allPluginsValid = true;
            const customAjvErrors: Partial<ErrorObject>[] = [];

            // Iterate over ALL plugins without short-circuiting
            Object.keys(pluginsData).forEach(pluginName => {
                const pluginPath = `${path}/${pluginName}`;

                // validatePluginConfig handles the granular logging to your UI Logger
                const pluginIsValid = this.validatePluginConfig(
                    pluginName,
                    pluginsData[pluginName],
                    pluginPath
                );

                if (!pluginIsValid) {
                    allPluginsValid = false;

                    // Construct a precise AJV error for this specific plugin
                    customAjvErrors.push({
                        keyword: 'detectPlugins',
                        message: `Configuration for plugin '${pluginName}' is invalid.`,
                        params: { failedPlugin: pluginName },
                        // Point the instancePath directly to the failing plugin in the JSON tree
                        instancePath: pluginPath
                    });
                }
            });

            // fulfill the AJV custom keyword contract
            if (!allPluginsValid) {
                validatePlugins.errors = customAjvErrors;
            } else {
                validatePlugins.errors = undefined;
            }

            return allPluginsValid;
        };

        this.ajv.addKeyword({
            keyword: 'detectPlugins',
            type: 'object',
            validate: validatePlugins,
            errors: true
        })
    }

    public validateCategory(categoryName: string, data: Record<string, unknown>): AjvErrorCollection[] {
        this.pluginErrorBatch = [];
        this.pluginWarningBatch = [];

        if (!this.schema?.main) return [];

        const definitions = this.schema.main;
        const rawCategorySchema = definitions[categoryName] as JsonSchema | undefined;

        if (!rawCategorySchema || !this.isJsonSchema(rawCategorySchema)) return [];

        // clone before mutating - definitions is the same object handed to the Monaco/monaco-yaml
        // schema sync (see monacoSchemaSync.ts), which doesn't know about our detectPlugins keyword
        const categorySchema = structuredClone(rawCategorySchema);

        this.injectPluginDetectionProperties({ [categoryName]: categorySchema });

        try {
            const validate = this.ajv.compile({
                ...categorySchema,
                definitions,
            });

            const payload = structuredClone(data);
            this.applySchemaDefaults(categorySchema, payload);
            const collections: AjvErrorCollection[] = [];
            if (!validate(payload) && validate.errors) {
                const filteredErrors = this.filterTemplateErrors([...validate.errors], payload);
                if (filteredErrors.length > 0) {
                    collections.push({ type: categoryName, parent: categoryName, sourceErrors: filteredErrors });
                }
            }
            return [...collections, ...this.pluginErrorBatch];
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`validateCategory: failed to compile schema for '${categoryName}': ${message}`);
            return [];
        }
    }

    private validatePluginConfig(pluginName: string, pluginConfig: unknown, pluginPath: string): boolean {
        const resourceType = getResourceType(pluginPath) || 'unknown';
        const pluginSchema = this.findPluginSchema(pluginName, resourceType);

        if (!pluginSchema) {
            this.pluginWarningBatch.push({ message: 'Plugin is unknown (no schema found).', path: pluginPath });
            return true;
        }

        this.applySchemaDefaults(pluginSchema, pluginConfig);

        const cacheKey = `${resourceType}::${pluginName}`;
        let validate = this.pluginSchemasCache.get(cacheKey);

        if (!validate) {
            try {
                validate = this.ajv.compile(pluginSchema);
                this.pluginSchemasCache.set(cacheKey, validate);
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                this.pluginWarningBatch.push({ message: `Failed to compile schema: ${errorMessage}`, path: pluginPath });
                return false;
            }
        }

        const valid = validate(pluginConfig);

        if (valid) {
            return true;
        }

        if (validate.errors) {
            const filteredErrors = this.filterTemplateErrors([...validate.errors], pluginConfig);
            if (filteredErrors.length === 0) {
                return true;
            }
            this.pluginErrorBatch.push({
                type: pluginPath,
                parent: pluginName,
                sourceErrors: filteredErrors,
            });
        }

        return false;
    }

    private findPluginSchema(pluginName: string, resourceType: string): JsonSchema | null {
        if (!this.schema) return null;


        const plugins = this.schema.plugins;
        const streamPlugins = this.schema.stream_plugins;

        const pluginDef = plugins?.[pluginName] || streamPlugins?.[pluginName];

        if (!pluginDef) {
            return null;
        }


        let schema: JsonSchema | undefined;

        // consumers and consumer_groups require the consumer_schema variant when one exists
        // because the allowed plugin config differs from the route context
        const isConsumerContext = resourceType === 'consumers' || resourceType === 'consumer_groups';
        if (isConsumerContext && pluginDef.consumer_schema) {
            schema = pluginDef.consumer_schema;
        } else {
            schema = pluginDef.schema;
        }

        if (schema) {
            this.fixSchemaTypes(schema);
            return schema;
        }

        return null;
    }


    private fixSchemaTypes(schema: JsonSchema) {
        if (!this.isJsonSchema(schema)) return;

        const numericKeys = ['minLength'];

        for (const key in schema) {
            if (numericKeys.includes(key) && typeof schema[key] === 'string') {
                const val = parseInt(schema[key] as string, 10);
                if (!isNaN(val)) {
                    schema[key] = val;
                }
            }

            if (this.isJsonSchema(schema[key])) {
                this.fixSchemaTypes(schema[key] as JsonSchema);
            }
        }
    }

    private applyConfigDefaults(payload: Record<string, unknown>, definitions: JsonSchema, properties: JsonSchema) {
        if (!this.fillInDefaults) return;

        for (const [key, propSchema] of Object.entries(properties)) {
            if (!this.isJsonSchema(propSchema)) continue;

            const items = propSchema.items;
            if (!this.isJsonSchema(items)) continue;

            const ref = items.$ref;
            if (typeof ref !== 'string') continue;

            const defName = ref.split('/').pop();
            if (!defName || !this.isJsonSchema(definitions[defName])) continue;

            const defSchema = definitions[defName] as JsonSchema;
            const arr = payload[key];
            if (!Array.isArray(arr)) continue;

            for (const item of arr) {
                this.applySchemaDefaults(defSchema, item);
            }
        }
    }

    private applySchemaDefaults(schema: JsonSchema, config: unknown) {
        // a solution to https://github.com/ajv-validator/ajv/issues/127
        // https://ajv.js.org/guide/modifying-data.html#assigning-defaults
        if (!this.fillInDefaults) {
            return;
        }

        if (!this.isJsonSchema(schema) || typeof config !== 'object' || config === null) return;

        const configObj = config as Record<string, unknown>;

        if (this.isJsonSchema(schema.properties)) {
            for (const [key, propDef] of Object.entries(schema.properties)) {
                if (this.isJsonSchema(propDef)) {
                    // Inject default if value is completely missing or an empty string
                    if (propDef.default !== undefined) {
                        if (configObj[key] === undefined || configObj[key] === null || configObj[key] === '') {
                            configObj[key] = propDef.default;
                        }
                    }

                    // Recurse into nested configuration objects
                    if (propDef.type === 'object' && configObj[key]) {
                        this.applySchemaDefaults(propDef as JsonSchema, configObj[key]);
                    }
                }
            }
        }
    }

    public setConfig(config: ApisixConfig) {
        this.config = config;
    }

    public getConfig(): ApisixConfig | null {
        return this.config;
    }

    public setSchema(schema: SchemaCatalog | null) {
        this.schema = schema;
        this.compiledRootValidator = null;
        this.pluginSchemasCache.clear();
    }

    public getSchema(): SchemaCatalog | null {
        return this.schema;
    }

    public setFillInDefaults(fillInDefaults: boolean) {
        this.fillInDefaults = fillInDefaults;
    }

    private injectPluginDetectionProperties(definitions: JsonSchema | null) {
        if (!this.isJsonSchema(definitions)) return;

        interface DefinitionShape {
            properties?: {
                plugins?: {
                    detectPlugins?: boolean;
                    [key: string]: unknown;
                };
                [key: string]: unknown;
            };
            [key: string]: unknown;
        }


        Object.values(definitions).forEach((def: unknown) => {
            if (this.isJsonSchema(def)) {
                const typedDef = def as DefinitionShape;

                if (typedDef.properties?.plugins) {
                    typedDef.properties.plugins.detectPlugins = true;
                }
            }
        });
    }

    private buildValidationProperties(definitions: unknown): JsonSchema {
        const properties: JsonSchema = {};

        if (!this.isJsonSchema(definitions)) {
            return properties;
        }

        const defNames = Object.keys(definitions);

        defNames.forEach((defName: string) => {
            // Register both singular and plural
            const candidateKeys = [defName, `${defName}s`];

            candidateKeys.forEach((key) => {
                properties[key] = {
                    type: 'array',
                    items: { $ref: `#/definitions/${defName}` }
                };
            });
        });
        return properties;
    }

    // ${{VAR}} is resolved outside the console, so schema checks on the literal text are meaningless.
    // Unanchored because a value can hold several placeholders, or a trailing newline from a "|" block.
    private containsTemplatePlaceholder(val: unknown): boolean {
        return typeof val === 'string' && /\$\{\{[^{}]+}}/.test(val);
    }

    private getValueAtPath(data: unknown, instancePath: string): unknown {
        if (!instancePath) return data;
        const parts = instancePath.split('/').filter(p => p !== '');
        let current: unknown = data;
        for (const part of parts) {
            if (current === null || current === undefined) {
                return undefined;
            }

            if (Array.isArray(current)) {
                const index = parseInt(part, 10);
                if (isNaN(index)) {
                    return undefined;
                }

                current = current[index];
            } else if (typeof current === 'object') {
                current = (current as Record<string, unknown>)[part];
            } else {
                return undefined;
            }
        }
        return current;
    }


    private filterTemplateErrors(errors: ErrorObject[], data: unknown): ErrorObject[] {
        return errors.filter(err => {
            const val = this.getValueAtPath(data, err.instancePath);
            return !this.containsTemplatePlaceholder(val);
        });
    }

    private isJsonSchema(def: unknown): def is JsonSchema {
        return (
            def !== null &&
            typeof def === 'object' &&
            !Array.isArray(def)
        );
    }
}