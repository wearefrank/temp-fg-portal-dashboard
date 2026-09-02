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

/** The records below mirror what the APISIX control API returns, key plus value. */
export interface LiveRoute {
    key: string;
    value: {
        id: string;
        uri: string;
        status: number;
        plugins?: Record<string, unknown>;
        upstream_id?: number;
    };
}

export interface LiveUpstream {
    key: string;
    value: {
        id: string;
        type: string;
        nodes?: LiveNodes;
    };
}

export interface LiveService {
    key: string;
    value: {
        id: string;
        name?: string;
        desc?: string;
        upstream_id?: string | number;
        upstream?: { nodes?: LiveNodes };
        plugins?: Record<string, unknown>;
    };
}
