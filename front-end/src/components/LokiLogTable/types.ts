// Which of the gateway's two log streams a table reads.
export type LogKind = 'audit' | 'error';

/**
 * Mirrors LogEntryDto. Two shapes share it - the loki-logger plugin's access record and a
 * line off nginx's error log - told apart by `type`, so everything but type, timestamp,
 * tsNanos and raw is nullable. Each table shows the columns its own kind fills; see
 * DEFAULT_HIDDEN_COLUMNS in columns.tsx.
 */
export interface LogEntry {
    type: LogKind;
    // The Loki stream's namespace label, null if it carries none. Filled whether or not the
    // console is pinned to a namespace; it earns its column when the pin names several and
    // this table is showing them merged.
    namespace: string | null;
    timestamp: string;
    // Nanosecond timestamp, kept as a string. Never Number() this - nanoseconds are past
    // the point where a JS number stays exact, and a rounded value breaks paging.
    tsNanos: string;
    level: string | null;
    routeName: string | null;
    routeId: string | null;
    method: string | null;
    path: string | null;
    host: string | null;
    status: number | null;
    latencyMs: number | null;
    // The caller: the audit record's source, the error line's `client:`.
    source: string | null;
    upstream: string | null;
    // error only
    requestId: string | null;
    module: string | null;
    message: string | null;
    // audit only
    gemeenteCode: string | null;
    raw: string;
}

// Mirrors LogPageDto.
export interface LogPage {
    entries: LogEntry[];
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
    anchor: string;
    depthCapped: boolean;
}
