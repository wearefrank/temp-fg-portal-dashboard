// Mirrors LogEntryDto. Everything but timestamp, tsNanos and raw is nullable: Loki returns
// whatever was pushed to it, and a line that is not one of the plugin's JSON records still
// gets a row.
export interface LogEntry {
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
    source: string | null;
    upstream: string | null;
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
