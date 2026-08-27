// Which of the gateway's two log streams a table reads.
export type LogKind = 'audit' | 'error';

/**
 * Mirrors LogEntryDto. Two shapes share it - the loki-logger plugin's access record and a
 * line off nginx's error log - told apart by `type`, so everything but type, timestamp,
 * tsNanos and raw is nullable. Each table shows the columns its own kind fills, and which
 * those are comes from the server - see LogFieldDescriptor below.
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

/**
 * Mirrors LogFieldType. What a column's values mean, which is what picks its cell renderer -
 * see RENDERERS in columns.tsx. Deliberately not the field's name: a field added to the
 * gateway's log format arrives here with a type the table already knows how to draw.
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

/**
 * Mirrors LogFieldDto - one column of the table, as GET /logs/fields?type= describes it.
 *
 * The list comes back in column order and is the whole story: the table builds its columns
 * from it rather than declaring them, so the field catalogue on the server is the only place
 * the log's shape is written down. Where a value is read from is not here, because that is
 * the server's business.
 */
export interface LogFieldDescriptor {
    id: keyof LogEntry;
    label: string;
    type: LogFieldType;
    // Whether this column starts open, for the kind that was asked about.
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
}
