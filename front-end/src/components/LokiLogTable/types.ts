// Which of the gateway's two log streams a table reads.
export type LogKind = 'audit' | 'error';

/**
 * Mirrors Java LogEntryDto.
 */
export interface LogEntry {
    type: LogKind;
    // The Loki stream's namespace label. Earns its column when the console is pinned to
    // several namespaces and this table shows them merged.
    namespace: string | null;
    timestamp: string;
    // Nanoseconds, kept as a string. Never Number() this - a rounded value breaks paging.
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

/**
 * Mirrors LogFieldType.
 * see buildRenderers in columns.tsx.
 */
export type LogFieldType =
    | 'TEXT'
    | 'MUTED'
    | 'CODE'
    | 'PATH'
    | 'MESSAGE'
    | 'LEVEL'
    | 'STATUS'
    | 'DURATION'
    | 'ROUTE';

/** Mirrors LogFieldDto - one column, as GET /logs/fields?type= describes it, in column order. */
export interface LogFieldDescriptor {
    id: keyof LogEntry;
    label: string;
    type: LogFieldType;
    defaultVisible: boolean;
    align: 'right' | null;
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
    searchField: string | null;
}
