import { describe, it, expect } from 'vitest';
import { SchemaValidator } from '../actions/SchemaValidation';
import type { SchemaCatalog, ApisixConfig } from '../actions/SchemaValidation';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSchema(overrides: Record<string, unknown> = {}): SchemaCatalog {
    return {
        main: {
            route: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    uri: { type: 'string' },
                    plugins: { type: 'object' },
                },
                required: ['id', 'uri'],
                additionalProperties: false,
            },
            ...overrides,
        },
        plugins: {
            'limit-count': {
                schema: {
                    type: 'object',
                    properties: { count: { type: 'integer' } },
                    required: ['count'],
                },
            },
            'jwt-auth': {
                schema: {
                    type: 'object',
                    properties: { key: { type: 'string' } },
                },
                consumer_schema: {
                    type: 'object',
                    properties: { key: { type: 'string' } },
                    required: ['key'],
                },
            },
        },
    };
}

const validConfig: ApisixConfig = {
    routes: [{ id: 'r1', uri: '/test' }],
};

const invalidConfig: ApisixConfig = {
    // uri should be a string, not a number
    routes: [{ id: 'r1', uri: 123 }],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SchemaValidator — getters/setters', () => {
    it('getConfig returns null initially', () => {
        const v = new SchemaValidator();
        expect(v.getConfig()).toBeNull();
    });

    it('setConfig / getConfig round-trips', () => {
        const v = new SchemaValidator();
        v.setConfig(validConfig);
        expect(v.getConfig()).toBe(validConfig);
    });

    it('getSchema returns null initially', () => {
        const v = new SchemaValidator();
        expect(v.getSchema()).toBeNull();
    });

    it('setSchema / getSchema round-trips', () => {
        const v = new SchemaValidator();
        const s = makeSchema();
        v.setSchema(s);
        expect(v.getSchema()).toBe(s);
    });
});

describe('SchemaValidator.validateConfig() — guard clauses', () => {
    it('returns valid:false when no config is set', () => {
        const v = new SchemaValidator();
        v.setSchema(makeSchema());
        const result = v.validateConfig();
        expect(result.valid).toBe(false);
    });

    it('returns valid:false when no schema is set', () => {
        const v = new SchemaValidator();
        v.setConfig(validConfig);
        const result = v.validateConfig();
        expect(result.valid).toBe(false);
    });

    it('returns valid:false when schema has no main', () => {
        const v = new SchemaValidator();
        v.setConfig(validConfig);
        v.setSchema({ plugins: {} });
        const result = v.validateConfig();
        expect(result.valid).toBe(false);
    });
});

describe('SchemaValidator.validateConfig() — valid config', () => {
    it('returns valid:true for a well-formed config', () => {
        const v = new SchemaValidator();
        v.setSchema(makeSchema());
        v.setConfig(validConfig);
        const result = v.validateConfig();
        expect(result.valid).toBe(true);
        expect(result.errorCollections).toHaveLength(0);
    });
});

describe('SchemaValidator.validateConfig() — schema errors', () => {
    it('returns valid:false and puts errors in errorCollections for wrong type', () => {
        const v = new SchemaValidator();
        v.setSchema(makeSchema());
        v.setConfig(invalidConfig);
        const result = v.validateConfig();
        expect(result.valid).toBe(false);
        expect(result.errorCollections.length).toBeGreaterThan(0);
    });

    it('places additionalProperties errors in warningErrors, not errorCollections', () => {
        const v = new SchemaValidator();
        v.setSchema(makeSchema());
        // unknown field triggers additionalProperties
        v.setConfig({ routes: [{ id: 'r1', uri: '/x', unknownField: true }] });
        const result = v.validateConfig();
        expect(result.warningErrors.length).toBeGreaterThan(0);
        const hasAdditionalPropInErrors = result.errorCollections.some(c =>
            c.sourceErrors.some(e => e.keyword === 'additionalProperties')
        );
        expect(hasAdditionalPropInErrors).toBe(false);
    });
});

describe('SchemaValidator.validateConfig() — plugin validation', () => {
    it('passes and adds a warning when plugin has no schema', () => {
        const v = new SchemaValidator();
        v.setSchema(makeSchema());
        v.setConfig({
            routes: [{ id: 'r1', uri: '/x', plugins: { 'unknown-plugin': {} } }],
        });
        const result = v.validateConfig();
        expect(result.valid).toBe(true);
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.warnings[0].message).toMatch(/unknown/i);
    });

    it('passes when a known plugin config is valid', () => {
        const v = new SchemaValidator();
        v.setSchema(makeSchema());
        v.setConfig({
            routes: [{ id: 'r1', uri: '/x', plugins: { 'limit-count': { count: 5 } } }],
        });
        const result = v.validateConfig();
        expect(result.valid).toBe(true);
        expect(result.errorCollections).toHaveLength(0);
    });

    it('returns errors in errorCollections when a known plugin config is invalid', () => {
        const v = new SchemaValidator();
        v.setSchema(makeSchema());
        // 'count' is required but missing
        v.setConfig({
            routes: [{ id: 'r1', uri: '/x', plugins: { 'limit-count': {} } }],
        });
        const result = v.validateConfig();
        expect(result.valid).toBe(false);
        const pluginError = result.errorCollections.find(c => c.parent === 'limit-count');
        expect(pluginError).toBeDefined();
    });
});

describe('SchemaValidator — consumer_schema vs schema', () => {
    it('uses consumer_schema for consumers context', () => {
        const schema = makeSchema({
            consumer: {
                type: 'object',
                properties: {
                    username: { type: 'string' },
                    plugins: { type: 'object' },
                },
                required: ['username'],
                additionalProperties: false,
            },
        });
        const v = new SchemaValidator();
        v.setSchema(schema);
        // jwt-auth consumer_schema requires 'key'; omitting it should produce error
        v.setConfig({
            consumers: [{ username: 'alice', plugins: { 'jwt-auth': {} } }],
        });
        const result = v.validateConfig();
        expect(result.valid).toBe(false);
        const pluginError = result.errorCollections.find(c => c.parent === 'jwt-auth');
        expect(pluginError).toBeDefined();
    });

    it('uses regular schema for non-consumer context', () => {
        const v = new SchemaValidator();
        v.setSchema(makeSchema());
        // jwt-auth regular schema does NOT require 'key', so empty config is valid
        v.setConfig({
            routes: [{ id: 'r1', uri: '/x', plugins: { 'jwt-auth': {} } }],
        });
        const result = v.validateConfig();
        expect(result.valid).toBe(true);
    });
});

describe('SchemaValidator.validateCategory()', () => {
    it('returns [] when no schema is set', () => {
        const v = new SchemaValidator();
        const errors = v.validateCategory('route', { id: 'r1', uri: '/x' });
        expect(errors).toEqual([]);
    });

    it('returns [] for valid data', () => {
        const v = new SchemaValidator();
        v.setSchema(makeSchema());
        const errors = v.validateCategory('route', { id: 'r1', uri: '/x' });
        expect(errors).toEqual([]);
    });

    it('returns errors for invalid data', () => {
        const v = new SchemaValidator();
        v.setSchema(makeSchema());
        // uri is required but missing
        const errors = v.validateCategory('route', { id: 'r1' });
        expect(errors.length).toBeGreaterThan(0);
    });

    it('returns [] for an unknown category name', () => {
        const v = new SchemaValidator();
        v.setSchema(makeSchema());
        const errors = v.validateCategory('nonexistent', { foo: 'bar' });
        expect(errors).toEqual([]);
    });
});

describe('SchemaValidator — setFillInDefaults', () => {
    // applySchemaDefaults is called per-plugin (not per-route), so we test it
    // via a plugin schema that has a required field with a default value.

    it('injects plugin defaults before validation when enabled', () => {
        const schema: SchemaCatalog = {
            main: {
                route: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        uri: { type: 'string' },
                        plugins: { type: 'object' },
                    },
                    required: ['id', 'uri'],
                    additionalProperties: false,
                },
            },
            plugins: {
                'my-plugin': {
                    schema: {
                        type: 'object',
                        properties: {
                            count: { type: 'integer', default: 10 },
                        },
                        required: ['count'],
                    },
                },
            },
        };

        const v = new SchemaValidator();
        v.setSchema(schema);
        v.setFillInDefaults(true);
        // 'count' is required but missing — the default (10) should be injected
        v.setConfig({ routes: [{ id: 'r1', uri: '/x', plugins: { 'my-plugin': {} } }] });
        const result = v.validateConfig();
        expect(result.valid).toBe(true);
    });

    it('fails plugin validation when fill-in defaults is disabled and required field is missing', () => {
        const schema: SchemaCatalog = {
            main: {
                route: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        uri: { type: 'string' },
                        plugins: { type: 'object' },
                    },
                    required: ['id', 'uri'],
                    additionalProperties: false,
                },
            },
            plugins: {
                'my-plugin': {
                    schema: {
                        type: 'object',
                        properties: {
                            count: { type: 'integer', default: 10 },
                        },
                        required: ['count'],
                    },
                },
            },
        };

        const v = new SchemaValidator();
        v.setSchema(schema);
        v.setFillInDefaults(false);
        v.setConfig({ routes: [{ id: 'r1', uri: '/x', plugins: { 'my-plugin': {} } }] });
        const result = v.validateConfig();
        expect(result.valid).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Edge cases catalogued from the real APISIX schema (apisix-schema.json) -
// see schema-edge-cases-report.txt for the full construct-by-construct scan.
// ---------------------------------------------------------------------------

describe('SchemaValidator — if/then/else conditional required (e.g. limit-count policy)', () => {
    function makeConditionalSchema(): SchemaCatalog {
        return {
            main: {
                route: {
                    type: 'object',
                    properties: { id: { type: 'string' }, uri: { type: 'string' }, plugins: { type: 'object' } },
                    required: ['id', 'uri'],
                    additionalProperties: false,
                },
            },
            plugins: {
                'redis-plugin': {
                    schema: {
                        type: 'object',
                        properties: {
                            policy: { type: 'string' },
                            redis_host: { type: 'string' },
                            redis_cluster_nodes: { type: 'array' },
                        },
                        if: { properties: { policy: { enum: ['redis'] } } },
                        then: { required: ['redis_host'] },
                        else: { required: ['redis_cluster_nodes'] },
                    },
                },
            },
        };
    }

    it('requires redis_host when policy=redis', () => {
        const v = new SchemaValidator();
        v.setSchema(makeConditionalSchema());
        v.setConfig({ routes: [{ id: 'r1', uri: '/x', plugins: { 'redis-plugin': { policy: 'redis' } } }] });
        expect(v.validateConfig().valid).toBe(false);
    });

    it('passes when policy=redis and redis_host is present', () => {
        const v = new SchemaValidator();
        v.setSchema(makeConditionalSchema());
        v.setConfig({ routes: [{ id: 'r1', uri: '/x', plugins: { 'redis-plugin': { policy: 'redis', redis_host: 'localhost' } } }] });
        expect(v.validateConfig().valid).toBe(true);
    });

    it('requires redis_cluster_nodes when policy is anything else', () => {
        const v = new SchemaValidator();
        v.setSchema(makeConditionalSchema());
        v.setConfig({ routes: [{ id: 'r1', uri: '/x', plugins: { 'redis-plugin': { policy: 'redis-cluster' } } }] });
        expect(v.validateConfig().valid).toBe(false);
    });

    // Documents a real quirk found in APISIX's own schema: limit-count/limit-conn/limit-req
    // nest "then" *inside* "else" (else: { then: {...} }) instead of using sibling if/then/else.
    // Per JSON Schema semantics, "then" without a sibling "if" in the same subschema is a no-op,
    // so the required fields nested that way are never actually enforced by AJV. This isn't a
    // SchemaValidator bug - it's upstream schema behavior worth knowing about, since it means
    // the redis-cluster branch of those plugins is effectively unvalidated.
    it('does NOT enforce required fields nested as else.then (upstream schema quirk)', () => {
        const schema: SchemaCatalog = {
            main: {
                route: {
                    type: 'object',
                    properties: { id: { type: 'string' }, uri: { type: 'string' }, plugins: { type: 'object' } },
                    required: ['id', 'uri'],
                    additionalProperties: false,
                },
            },
            plugins: {
                'limit-count-like': {
                    schema: {
                        type: 'object',
                        properties: { policy: { type: 'string' } },
                        if: { properties: { policy: { enum: ['redis'] } } },
                        else: { then: { required: ['redis_cluster_nodes'] } },
                    },
                },
            },
        };
        const v = new SchemaValidator();
        v.setSchema(schema);
        // policy is not 'redis' and redis_cluster_nodes is missing - intuitively this
        // should fail, but the else.then shape means the required check never runs.
        v.setConfig({ routes: [{ id: 'r1', uri: '/x', plugins: { 'limit-count-like': { policy: 'redis-cluster' } } }] });
        expect(v.validateConfig().valid).toBe(true);
    });
});

describe('SchemaValidator — consumer_schema fully replaces schema (not merged)', () => {
    function makeDivergentSchema(): SchemaCatalog {
        return {
            main: {
                route: {
                    type: 'object',
                    properties: { id: { type: 'string' }, uri: { type: 'string' }, plugins: { type: 'object' } },
                    required: ['id', 'uri'],
                    additionalProperties: false,
                },
                consumer: {
                    type: 'object',
                    properties: { username: { type: 'string' }, plugins: { type: 'object' } },
                    required: ['username'],
                    additionalProperties: false,
                },
            },
            plugins: {
                'auth-plugin': {
                    // route/plugin_config context: permissive, no additionalProperties restriction
                    schema: {
                        type: 'object',
                        properties: { key: { type: 'string' }, extra_route_only_field: { type: 'string' } },
                    },
                    // consumer context: stricter and different shape entirely
                    consumer_schema: {
                        type: 'object',
                        properties: { key: { type: 'string' } },
                        required: ['key'],
                        additionalProperties: false,
                    },
                },
            },
        };
    }

    it('allows fields under the route schema that consumer_schema would reject', () => {
        const v = new SchemaValidator();
        v.setSchema(makeDivergentSchema());
        v.setConfig({
            routes: [{ id: 'r1', uri: '/x', plugins: { 'auth-plugin': { extra_route_only_field: 'x' } } }],
        });
        expect(v.validateConfig().valid).toBe(true);
    });

    it('rejects the same config under a consumer, using consumer_schema wholesale', () => {
        const v = new SchemaValidator();
        v.setSchema(makeDivergentSchema());
        v.setConfig({
            consumers: [{ username: 'alice', plugins: { 'auth-plugin': { extra_route_only_field: 'x' } } }],
        });
        const result = v.validateConfig();
        expect(result.valid).toBe(false);
        const pluginError = result.errorCollections.find(c => c.parent === 'auth-plugin');
        expect(pluginError).toBeDefined();
        // both the missing 'key' and the disallowed extra field should show up -
        // proof that consumer_schema replaces the route schema rather than merging with it
        const keywords = pluginError!.sourceErrors.map(e => e.keyword);
        expect(keywords).toContain('required');
        expect(keywords).toContain('additionalProperties');
    });
});

describe('SchemaValidator — additionalProperties: validateConfig vs validateCategory diverge', () => {
    it('validateConfig demotes additionalProperties to warnings (already covered above)', () => {
        const v = new SchemaValidator();
        v.setSchema(makeSchema());
        v.setConfig({ routes: [{ id: 'r1', uri: '/x', unknownField: true }] });
        const result = v.validateConfig();
        expect(result.valid).toBe(true);
        expect(result.warningErrors.length).toBeGreaterThan(0);
    });

    // validateCategory (used by the per-category Designer forms) has no equivalent warning
    // split - the same additionalProperties violation comes back as a blocking error instead.
    it('validateCategory treats the identical violation as a blocking error, not a warning', () => {
        const v = new SchemaValidator();
        v.setSchema(makeSchema());
        const errors = v.validateCategory('route', { id: 'r1', uri: '/x', unknownField: true });
        expect(errors.length).toBeGreaterThan(0);
        const hasAdditionalPropError = errors.some(c =>
            c.sourceErrors.some(e => e.keyword === 'additionalProperties')
        );
        expect(hasAdditionalPropError).toBe(true);
    });
});

describe('SchemaValidator — template placeholders bypass keyword validation', () => {
    function makePlaceholderSchema(): SchemaCatalog {
        return {
            main: {
                route: {
                    type: 'object',
                    properties: { id: { type: 'string' }, uri: { type: 'string' }, plugins: { type: 'object' } },
                    required: ['id', 'uri'],
                    additionalProperties: false,
                },
            },
            plugins: {
                'placeholder-plugin': {
                    schema: {
                        type: 'object',
                        properties: {
                            scheme: { type: 'string', enum: ['http', 'https'] },
                            host: { type: 'string', pattern: '^[a-z0-9.-]+$' },
                            count: { type: 'integer' },
                        },
                    },
                },
            },
        };
    }

    it('accepts a ${{ VAR }} placeholder in an enum-constrained field', () => {
        const v = new SchemaValidator();
        v.setSchema(makePlaceholderSchema());
        v.setConfig({
            routes: [{ id: 'r1', uri: '/x', plugins: { 'placeholder-plugin': { scheme: '${{ SCHEME }}' } } }],
        });
        expect(v.validateConfig().valid).toBe(true);
    });

    it('accepts a ${{ VAR }} placeholder in a pattern-constrained field', () => {
        const v = new SchemaValidator();
        v.setSchema(makePlaceholderSchema());
        v.setConfig({
            routes: [{ id: 'r1', uri: '/x', plugins: { 'placeholder-plugin': { host: '${{ REDIS_HOST }}' } } }],
        });
        expect(v.validateConfig().valid).toBe(true);
    });

    it('accepts a ${{ VAR }} placeholder in an integer-typed field', () => {
        const v = new SchemaValidator();
        v.setSchema(makePlaceholderSchema());
        v.setConfig({
            routes: [{ id: 'r1', uri: '/x', plugins: { 'placeholder-plugin': { count: '${{ COUNT }}' } } }],
        });
        expect(v.validateConfig().valid).toBe(true);
    });

    it('still rejects a plain invalid value that is not a placeholder', () => {
        const v = new SchemaValidator();
        v.setSchema(makePlaceholderSchema());
        v.setConfig({
            routes: [{ id: 'r1', uri: '/x', plugins: { 'placeholder-plugin': { scheme: 'not-a-valid-scheme' } } }],
        });
        expect(v.validateConfig().valid).toBe(false);
    });

    // Mirrors the real APISIX ssl schema, where client.ca carries minLength 128 - long enough
    // that no placeholder can ever satisfy it before substitution.
    function makeSslSchema(): SchemaCatalog {
        return {
            main: {
                ssl: {
                    type: 'object',
                    properties: {
                        client: {
                            type: 'object',
                            properties: { ca: { type: 'string', minLength: 128, maxLength: 65536 } },
                            required: ['ca'],
                        },
                    },
                },
            },
            plugins: {},
        };
    }

    function validateCa(ca: string): boolean {
        const v = new SchemaValidator();
        v.setSchema(makeSslSchema());
        v.setConfig({ ssls: [{ client: { ca } }] });
        return v.validateConfig().valid;
    }

    it('accepts several placeholders in one value, as a "|" block scalar produces', () => {
        expect(validateCa('${{IBABS_CERT}}\n${{DJUMA_CERT}}\n${{CENTRIC_CERT}}\n${{CLIENT_CA_CERT}}\n')).toBe(true);
    });

    // "ca: |" is clip chomping, so even a single placeholder arrives with a trailing newline.
    it('accepts a single placeholder carrying the trailing newline of a "|" block scalar', () => {
        expect(validateCa('${{CLIENT_CA_CERT}}\n')).toBe(true);
    });

    it('accepts a placeholder surrounded by literal text', () => {
        expect(validateCa('-----BEGIN CERTIFICATE-----\n${{CLIENT_CA_CERT}}\n-----END CERTIFICATE-----')).toBe(true);
    });

    it('still rejects a too-short literal ca with no placeholder', () => {
        expect(validateCa('-----BEGIN CERTIFICATE-----\nnot-long-enough\n')).toBe(false);
    });
});

describe('SchemaValidator — not + dependencies conflict (upstream.tls mutually exclusive fields)', () => {
    function makeTlsSchema(): SchemaCatalog {
        return {
            main: {
                upstream: {
                    type: 'object',
                    properties: {
                        tls: {
                            type: 'object',
                            properties: {
                                client_cert: { type: 'string' },
                                client_key: { type: 'string' },
                                client_cert_id: { type: 'string' },
                            },
                            dependencies: {
                                client_cert_id: { not: { required: ['client_cert', 'client_key'] } },
                            },
                        },
                    },
                },
            },
            plugins: {},
        };
    }

    it('allows client_cert_id alone', () => {
        const v = new SchemaValidator();
        v.setSchema(makeTlsSchema());
        v.setConfig({ upstreams: [{ tls: { client_cert_id: 'a' } }] });
        expect(v.validateConfig().valid).toBe(true);
    });

    it('allows client_cert + client_key alone', () => {
        const v = new SchemaValidator();
        v.setSchema(makeTlsSchema());
        v.setConfig({ upstreams: [{ tls: { client_cert: 'a', client_key: 'b' } }] });
        expect(v.validateConfig().valid).toBe(true);
    });

    it('rejects client_cert_id combined with client_cert + client_key', () => {
        const v = new SchemaValidator();
        v.setSchema(makeTlsSchema());
        v.setConfig({ upstreams: [{ tls: { client_cert_id: 'a', client_cert: 'b', client_key: 'c' } }] });
        expect(v.validateConfig().valid).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Chained/nested combinations - two or more of the above constructs interacting
// in the same config. These catch bugs that only surface when mechanisms combine,
// not when each is tested alone.
// ---------------------------------------------------------------------------

describe('SchemaValidator — chained: additionalProperties + if/then/else at plugin level', () => {
    // A self-contradicting plugin schema: additionalProperties:false only knows about
    // 'policy', but the 'then' branch conditionally requires 'redis_host', which is never
    // declared in the base 'properties'. Supplying redis_host trips additionalProperties;
    // omitting it trips required - there is no config that satisfies both. Verified against
    // raw AJV first: this is a real trap, not a misunderstanding of the keywords.
    function makeImpossibleSchema(): SchemaCatalog {
        return {
            main: {
                route: {
                    type: 'object',
                    properties: { id: { type: 'string' }, uri: { type: 'string' }, plugins: { type: 'object' } },
                    required: ['id', 'uri'],
                    additionalProperties: false,
                },
            },
            plugins: {
                'redis-plugin': {
                    schema: {
                        type: 'object',
                        properties: { policy: { type: 'string' } },
                        additionalProperties: false,
                        if: { properties: { policy: { enum: ['redis'] } } },
                        then: { required: ['redis_host'] },
                    },
                },
            },
        };
    }

    it('rejects when the conditionally-required field is supplied (additionalProperties wins)', () => {
        const v = new SchemaValidator();
        v.setSchema(makeImpossibleSchema());
        v.setConfig({ routes: [{ id: 'r1', uri: '/x', plugins: { 'redis-plugin': { policy: 'redis', redis_host: 'x' } } }] });
        expect(v.validateConfig().valid).toBe(false);
    });

    it('also rejects when the conditionally-required field is omitted (required wins)', () => {
        const v = new SchemaValidator();
        v.setSchema(makeImpossibleSchema());
        v.setConfig({ routes: [{ id: 'r1', uri: '/x', plugins: { 'redis-plugin': { policy: 'redis' } } }] });
        expect(v.validateConfig().valid).toBe(false);
    });

    // Contrast with root-level additionalProperties: at the route/category level, an unknown
    // field is demoted to a warning (see the describe block above). At the plugin level,
    // validatePluginConfig compiles and checks the plugin schema on its own and pushes ALL
    // its errors - including additionalProperties - straight into errorCollections. There is
    // no warning demotion for plugin-level additionalProperties violations.
    it('plugin-level additionalProperties is a blocking error, unlike route-level additionalProperties', () => {
        const v = new SchemaValidator();
        v.setSchema(makeImpossibleSchema());
        v.setConfig({ routes: [{ id: 'r1', uri: '/x', plugins: { 'redis-plugin': { policy: 'redis', redis_host: 'x' } } }] });
        const result = v.validateConfig();
        expect(result.valid).toBe(false);
        const pluginError = result.errorCollections.find(c => c.parent === 'redis-plugin');
        expect(pluginError).toBeDefined();
        expect(pluginError!.sourceErrors.some(e => e.keyword === 'additionalProperties')).toBe(true);
        // and it did NOT get routed into warningErrors the way route-level ones do
        expect(result.warningErrors.some(e => e.keyword === 'additionalProperties')).toBe(false);
    });
});

describe('SchemaValidator — chained: if/then/else differs between schema and consumer_schema', () => {
    function makeContextSensitiveConditional(): SchemaCatalog {
        return {
            main: {
                route: {
                    type: 'object',
                    properties: { id: { type: 'string' }, uri: { type: 'string' }, plugins: { type: 'object' } },
                    required: ['id', 'uri'],
                    additionalProperties: false,
                },
                consumer: {
                    type: 'object',
                    properties: { username: { type: 'string' }, plugins: { type: 'object' } },
                    required: ['username'],
                    additionalProperties: false,
                },
            },
            plugins: {
                'auth-plugin': {
                    // route context: redis policy requires redis_host
                    schema: {
                        type: 'object',
                        properties: { policy: { type: 'string' }, redis_host: { type: 'string' }, token_secret: { type: 'string' } },
                        if: { properties: { policy: { enum: ['redis'] } } },
                        then: { required: ['redis_host'] },
                    },
                    // consumer context: an entirely different condition - token_secret required
                    // whenever policy is 'jwt', with no mention of redis_host at all
                    consumer_schema: {
                        type: 'object',
                        properties: { policy: { type: 'string' }, token_secret: { type: 'string' } },
                        if: { properties: { policy: { enum: ['jwt'] } } },
                        then: { required: ['token_secret'] },
                    },
                },
            },
        };
    }

    it('route context requires redis_host under policy=redis', () => {
        const v = new SchemaValidator();
        v.setSchema(makeContextSensitiveConditional());
        v.setConfig({ routes: [{ id: 'r1', uri: '/x', plugins: { 'auth-plugin': { policy: 'redis' } } }] });
        expect(v.validateConfig().valid).toBe(false);
    });

    it('consumer context ignores the redis condition entirely (different schema selected)', () => {
        const v = new SchemaValidator();
        v.setSchema(makeContextSensitiveConditional());
        // policy=redis under a consumer - the consumer_schema doesn't know about redis_host at
        // all, so this passes even though it would fail under a route
        v.setConfig({ consumers: [{ username: 'alice', plugins: { 'auth-plugin': { policy: 'redis' } } }] });
        expect(v.validateConfig().valid).toBe(true);
    });

    it('consumer context requires token_secret under policy=jwt', () => {
        const v = new SchemaValidator();
        v.setSchema(makeContextSensitiveConditional());
        v.setConfig({ consumers: [{ username: 'alice', plugins: { 'auth-plugin': { policy: 'jwt' } } }] });
        expect(v.validateConfig().valid).toBe(false);
    });
});

describe('SchemaValidator — chained: template placeholders do NOT rescue indirectly-caused errors', () => {
    // filterTemplateErrors only inspects the value living at the FAILING error's own
    // instancePath. When a placeholder drives an if/then/else branch or a dependencies/not
    // conflict, the resulting required/not error's instancePath points at a *different*
    // field (or the parent object), so the placeholder on the triggering field does not
    // rescue it. This is a real limitation for parameterized configs, worth knowing about.

    it('a placeholder in the branch-selector field does not rescue the resulting required error', () => {
        const schema: SchemaCatalog = {
            main: {
                route: {
                    type: 'object',
                    properties: { id: { type: 'string' }, uri: { type: 'string' }, plugins: { type: 'object' } },
                    required: ['id', 'uri'],
                    additionalProperties: false,
                },
            },
            plugins: {
                'redis-plugin': {
                    schema: {
                        type: 'object',
                        properties: { policy: { type: 'string' }, redis_cluster_nodes: { type: 'array' } },
                        if: { properties: { policy: { enum: ['redis'] } } },
                        then: {},
                        else: { required: ['redis_cluster_nodes'] },
                    },
                },
            },
        };
        const v = new SchemaValidator();
        v.setSchema(schema);
        // policy is parameterized (not literally 'redis'), so AJV takes the 'else' branch
        // and requires redis_cluster_nodes - the placeholder does not communicate "unknown,
        // skip this check" to the validator.
        v.setConfig({ routes: [{ id: 'r1', uri: '/x', plugins: { 'redis-plugin': { policy: '${{ POLICY }}' } } }] });
        expect(v.validateConfig().valid).toBe(false);
    });

    it('a placeholder on one side of a tls not+dependencies conflict does not rescue it', () => {
        const schema: SchemaCatalog = {
            main: {
                upstream: {
                    type: 'object',
                    properties: {
                        tls: {
                            type: 'object',
                            properties: {
                                client_cert: { type: 'string' },
                                client_key: { type: 'string' },
                                client_cert_id: { type: 'string' },
                            },
                            dependencies: {
                                client_cert_id: { not: { required: ['client_cert', 'client_key'] } },
                            },
                        },
                    },
                },
            },
            plugins: {},
        };
        const v = new SchemaValidator();
        v.setSchema(schema);
        // client_cert_id is a placeholder (could resolve to anything at deploy time), but
        // client_cert/client_key are concretely set alongside it - still flagged as a conflict.
        v.setConfig({ upstreams: [{ tls: { client_cert_id: '${{ CERT_ID }}', client_cert: 'b', client_key: 'c' } }] });
        expect(v.validateConfig().valid).toBe(false);
    });
});
