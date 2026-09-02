/** Mirrors RouteStatsDto - one route's traffic over the window. */
export interface RouteStats {
    // "" for traffic that matched no route at all.
    routeId: string;
    routeName: string | null;
    uri: string | null;
    // null means unknown - either not in the config, or the control API was unreachable.
    live: boolean | null;
    configured: boolean;
    total: number;
    informational: number;
    success: number;
    redirect: number;
    clientError: number;
    serverError: number;
    errorRatePercent: number | null;
    clientErrorRatePercent: number | null;
    // Mean upstream time, over the requests that reached an upstream - not over `total`.
    avgLatencyMs: number | null;
    byStatus: Record<string, number>;
}

/** Mirrors RouteSeriesDto - one route's traffic in one status code, bucketed over time. */
export interface RouteSeries {
    routeId: string;
    status: string;
    // Already zero-filled to the width of bucketTimes, so a gap is a real zero. Never
    // reindex or interpolate these; the server has done it.
    counts: number[];
}

/** Mirrors RouteStatsResultDto. */
export interface RouteStatsResult {
    routes: RouteStats[];
    // Epoch seconds, oldest first. A bucket covers (t - stepSeconds, t].
    bucketTimes: number[];
    stepSeconds: number;
    series: RouteSeries[];
    // The span actually covered - rounded up to whole buckets, so it can slightly exceed
    // what the picker asked for.
    windowSeconds: number;
    countQuery: string;
    latencyQuery: string;
    routesUnavailable: boolean;
}
