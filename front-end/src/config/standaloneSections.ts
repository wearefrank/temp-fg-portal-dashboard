import type { JsonSchema } from '../actions/SchemaValidation';

// Sections APISIX only accepts in standalone (yaml) mode. /v1/schema describes what etcd stores,
// so it omits these and the root validator would report them as unknown keys.
export const STANDALONE_DEFINITIONS: Record<string, JsonSchema> = {
    // only id is declared - the rest is checked against the plugin's metadata_schema by
    // the detectPluginMetadata keyword in SchemaValidation.ts
    plugin_metadata: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        detectPluginMetadata: true,
    },
};
