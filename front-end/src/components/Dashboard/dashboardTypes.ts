/** Shape of GET /config - where the console talks to APISIX. */
export interface ConnectionConfig {
    host: string;
    controlPort: number;
}

export type ConnectionStatus = 'checking' | 'online' | 'offline';

/** One backend behind an upstream. */
export interface LiveNode {
    host: string;
    port: number;
    weight: number;
}

/** APISIX accepts both an array of nodes and a {"host:port": weight} map. */
export type LiveNodes = LiveNode[] | Record<string, number>;

/** An upstream a route or service declares in place, instead of pointing at one by id. */
export interface LiveInlineUpstream {
    id?: string | number;
    name?: string;
    type?: string;
    scheme?: string;
    nodes?: LiveNodes;
    [key: string]: unknown;
}

/**
 * The records below mirror what the APISIX control API returns, key plus value.
 * The index signature is deliberate: APISIX sends more fields than we model, and the
 * topology builder reads entries as plain records.
 */
export interface LiveRoute {
    key: string;
    value: {
        id: string;
        uri?: string;
        uris?: string[];
        name?: string;
        desc?: string;
        status: number;
        plugins?: Record<string, unknown>;
        upstream_id?: string | number;
        upstream?: LiveInlineUpstream;
        service_id?: string | number;
        plugin_config_id?: string | number;
        [key: string]: unknown;
    };
}

export interface LiveUpstream {
    key: string;
    value: {
        id: string;
        type: string;
        name?: string;
        desc?: string;
        scheme?: string;
        nodes?: LiveNodes;
        [key: string]: unknown;
    };
}

export interface LiveService {
    key: string;
    value: {
        id: string;
        name?: string;
        desc?: string;
        upstream_id?: string | number;
        upstream?: LiveInlineUpstream;
        plugins?: Record<string, unknown>;
        [key: string]: unknown;
    };
}
