import type { TimeRange } from '../TimeRangePicker/timeRange';
import type { RouteSeries, RouteStats, RouteStatsResult } from './types';

/**
 * Narrows a response in hand to a window narrower than the one it was fetched for.
 *
 * A zoom asks Loki for finer buckets, and until that lands the only data here is the wider
 * window's. Cropping it draws the new span immediately instead of a spinner.
 *
 * What it cannot do is invent resolution. Four hours cropped out of a week is four hourly
 * buckets, not the hundred and twenty two-minute ones the refetch will bring; this is the
 * picture held up while that arrives, not a replacement for it.
 *
 * The counts do generally survive it. Both grids are snapped to multiples of their step, so
 * where the coarse step divides the fine one the fold lands on exactly the refetch's numbers
 * - measured against a live Loki, every route agreed to the request. Not every pair on the
 * ladder nests that way though (900 does not divide by 120), and there the two can differ by
 * up to one coarse bucket at each edge. Right enough to read while waiting; the refetch is
 * still the number of record.
 */
export interface CroppedRouteStats {
    result: RouteStatsResult;
    /**
     * True when the numbers were folded here rather than by Loki, so the caller can say so.
     * Counts are exact; latency is withheld - see below.
     */
    provisional: boolean;
}

export function cropRouteStats(result: RouteStatsResult, range: TimeRange): CroppedRouteStats {
    // Only an absolute range is ever narrower than what was fetched for it: a relative one
    // is resolved against the server's "now", and comparing it against a clock here would
    // crop a bucket or two off every window through sheer drift.
    if (range.kind !== 'absolute') {
        return { result, provisional: false };
    }

    const fromSec = Math.floor(range.fromMs / 1000);
    const toSec = Math.floor(range.toMs / 1000);

    // A bucket is kept only when the whole span it counts falls inside the crop. One that
    // straddles an edge would carry traffic from outside the window into the total, and a
    // count that is nearly right is worse than one bucket of blank at the edge.
    const keep: number[] = [];
    result.bucketTimes.forEach((time, index) => {
        if (time - result.stepSeconds >= fromSec && time <= toSec) keep.push(index);
    });

    if (keep.length === result.bucketTimes.length) {
        return { result, provisional: false };
    }

    const series: RouteSeries[] = result.series
        .map(entry => ({ ...entry, counts: keep.map(index => entry.counts[index]) }))
        // A route with nothing left in the window keeps its row, from the config, but has no
        // series to draw - an empty one would put a flat zero in the legend.
        .filter(entry => entry.counts.some(count => count > 0));

    return {
        result: {
            ...result,
            bucketTimes: keep.map(index => result.bucketTimes[index]),
            series,
            windowSeconds: keep.length * result.stepSeconds,
            routes: recount(result.routes, series),
        },
        provisional: true,
    };
}

/**
 * The table's rows, recomputed from the cropped buckets.
 *
 * Counts fold exactly. Latency does not: it comes from its own avg_over_time and cannot be
 * reconstructed from counts, so it is dropped rather than left showing the old window's
 * figure beside the new window's traffic - which would be the one number on the panel that
 * was quietly wrong.
 */
function recount(routes: RouteStats[], series: RouteSeries[]): RouteStats[] {
    const byRoute = new Map<string, RouteSeries[]>();
    for (const entry of series) {
        const existing = byRoute.get(entry.routeId);
        if (existing) existing.push(entry); else byRoute.set(entry.routeId, [entry]);
    }

    // Every row the response had, plus any route that only exists in the series - the same
    // union the server builds, so a cropped view never loses a row the full one showed.
    const ids = [...new Set([...routes.map(r => r.routeId), ...byRoute.keys()])];
    const known = new Map(routes.map(route => [route.routeId, route]));

    return ids.map(routeId => {
        const base = known.get(routeId);
        const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        const byStatus: Record<string, number> = {};
        let total = 0;

        for (const entry of byRoute.get(routeId) ?? []) {
            const count = entry.counts.reduce((sum, value) => sum + value, 0);
            if (count === 0) continue;
            total += count;
            byStatus[entry.status] = (byStatus[entry.status] ?? 0) + count;
            const digit = Number(entry.status.charAt(0));
            // Anything outside 1-5 still reaches the total, so the classes and the total
            // cannot disagree - the same rule the server folds by.
            if (digit >= 1 && digit <= 5) counts[digit as 1 | 2 | 3 | 4 | 5] += count;
        }

        return {
            routeId,
            routeName: base?.routeName ?? null,
            uri: base?.uri ?? null,
            live: base?.live ?? null,
            configured: base?.configured ?? false,
            total,
            informational: counts[1],
            success: counts[2],
            redirect: counts[3],
            clientError: counts[4],
            serverError: counts[5],
            errorRatePercent: percent(counts[5], total),
            clientErrorRatePercent: percent(counts[4], total),
            avgLatencyMs: null,
            byStatus,
        };
    });
}

/** Null rather than 0 when nothing was counted - there is no rate without traffic. */
function percent(part: number, total: number): number | null {
    return total === 0 ? null : Math.round((part * 1000) / total) / 10;
}
