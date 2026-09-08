import Ajv, {type ErrorObject, type ValidateFunction} from 'ajv';
import addFormats from 'ajv-formats';
import type {DataValidationCxt} from "ajv/lib/types";
import { getResourceType } from './ValidationLogger';
import type {AjvErrorCollection} from "./ErrorResolver.ts";
import { STANDALONE_DEFINITIONS } from '../config/standaloneSections';

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
    // shape of a plugin_metadata entry - only present for plugins that accept metadata
    metadata_schema?: JsonSchema;
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

    // cache of schema.main merged with the standalone-only sections - reset when schema changes
    private mergedDefinitions: JsonSchema | null = null;

    constructor() {
        this.ajv = new Ajv({
            allErrors: true,
            strict: false,
            verbose: true,
            // useDefaults: 'empty',
        });
        addFormats(this.ajv);

        this.addPluginDetection();
        this.addPluginMetadataDetection();
    }

    public validateConfig(): RawConfigValidation {
        this.pluginErrorBatch = [];
        this.pluginWarningBatch = [];

        if (!this.config) {
            return { valid: false, errorCollections: [], warningErrors: [], warnings: [] };
        }

        const definitions = this.getDefinitions();
        if (!definitions) {
            return { valid: false, errorCollections: [], warningErrors: [], warnings: [] };
        }

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

    // same idea as addPluginDetection, but plugin_metadata entries name their plugin in an `id`
    // field instead of sitting under a `plugins` map, so they need their own hook
    public addPluginMetadataDetection() {
        const validateMetadata: PluginValidator = (
            _schema: JsonSchema,
            data: unknown,
            _parentSchema: unknown,
            dataCtx?: DataValidationCxt,
        ) => {
            const path = dataCtx?.instancePath || '';
            const entry = (data || {}) as Record<string, unknown>;

            if (this.validatePluginMetadata(entry, path)) return true;

            validateMetadata.errors = [{
                keyword: 'detectPluginMetadata',
                message: `Metadata for plugin '${String(entry.id)}' is invalid.`,
                params: { failedPlugin: entry.id },
                instancePath: path,
            }];
            return false;
        };

        this.ajv.addKeyword({
            keyword: 'detectPluginMetadata',
            type: 'object',
            validate: validateMetadata,
            errors: true
        })
    }

    public validateCategory(categoryName: string, data: Record<string, unknown>): AjvErrorCollection[] {
        this.pluginErrorBatch = [];
        this.pluginWarningBatch = [];

        const definitions = this.getDefinitions();
        if (!definitions) return [];

        // already cloned and keyword-injected by getDefinitions()
        const categorySchema = definitions[categoryName] as JsonSchema | undefined;

        if (!categorySchema || !this.isJsonSchema(categorySchema)) return [];

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

        // a schema that won't compile counts against the plugin here
        return this.runSchemaValidation(`${resourceType}::${pluginName}`, pluginSchema, pluginConfig, pluginPath, pluginName) ?? false;
    }

    // one `plugin_metadata` entry, checked against the metadata_schema of the plugin its `id` names
    private validatePluginMetadata(entry: Record<string, unknown>, path: string): boolean {
        const pluginName = String(entry.id ?? '');
        const pluginDef = this.findPluginDef(pluginName);
        const metadataSchema = pluginDef?.metadata_schema;

        // only some plugins accept metadata, so a missing metadata_schema is normal
        if (!metadataSchema || !this.isJsonSchema(metadataSchema)) {
            const reason = pluginDef ? 'has no metadata schema' : 'is unknown (no schema found)';
            this.pluginWarningBatch.push({ message: `Plugin '${pluginName}' ${reason}.`, path });
            return true;
        }

        this.fixSchemaTypes(metadataSchema);

        // id names the plugin, it isn't a metadata field - stripped on a copy so schemas with
        // additionalProperties: false don't reject it and defaults stay off the parsed config
        const metadata = { ...entry };
        delete metadata.id;
        this.applySchemaDefaults(metadataSchema, metadata);

        // a schema that won't compile is our problem, so the entry stays unjudged
        // the prefix keeps the cache key clear of the `${resourceType}::${pluginName}` ones
        return this.runSchemaValidation(`metadata::${pluginName}`, metadataSchema, metadata, path, pluginName) ?? true;
    }

    // compile (cached), validate, and batch whatever fails. Returns null when the schema itself
    // won't compile, leaving it to the caller to say what an unverifiable payload means.
    private runSchemaValidation(
        cacheKey: string,
        schema: JsonSchema,
        payload: unknown,
        path: string,
        parent: string,
    ): boolean | null {
        let validate = this.pluginSchemasCache.get(cacheKey);

        if (!validate) {
            try {
                validate = this.ajv.compile(schema);
                this.pluginSchemasCache.set(cacheKey, validate);
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                this.pluginWarningBatch.push({ message: `Failed to compile schema: ${errorMessage}`, path });
                return null;
            }
        }

        if (validate(payload)) {
            return true;
        }

        if (validate.errors) {
            const filteredErrors = this.filterTemplateErrors([...validate.errors], payload);
            if (filteredErrors.length === 0) {
                return true;
            }
            this.pluginErrorBatch.push({
                type: path,
                parent: parent,
                sourceErrors: filteredErrors,
            });
        }

        return false;
    }

    // plugins and stream_plugins are separate maps in the catalog, a name lives in one or the other
    private findPluginDef(pluginName: string): PluginDef | null {
        return this.schema?.plugins?.[pluginName] ?? this.schema?.stream_plugins?.[pluginName] ?? null;
    }

    private findPluginSchema(pluginName: string, resourceType: string): JsonSchema | null {
        const pluginDef = this.findPluginDef(pluginName);

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

            // APISIX ships opentelemetry's `resource` with a list of allowed variants here, but
            // JSON Schema only takes a boolean or one schema - fold the list into an anyOf
            if (key === 'additionalProperties' && Array.isArray(schema[key])) {
                schema[key] = { anyOf: schema[key] };
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
        this.mergedDefinitions = null;
        this.pluginSchemasCache.clear();
    }

    // schema.main plus the standalone-only sections, cloned before we inject our own keywords -
    // the raw main is the same object handed to monacoSchemaSync.ts, which knows none of them
    private getDefinitions(): JsonSchema | null {
        if (!this.schema?.main || !this.isJsonSchema(this.schema.main)) return null;

        if (!this.mergedDefinitions) {
            // main wins on a name clash, so a future APISIX that does publish one of these takes over
            const merged = structuredClone({ ...STANDALONE_DEFINITIONS, ...this.schema.main });
            this.injectPluginDetectionProperties(merged);
            this.mergedDefinitions = merged;
        }

        return this.mergedDefinitions;
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