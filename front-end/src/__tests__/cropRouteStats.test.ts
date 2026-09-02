import { describe, expect, it } from 'vitest';
import { cropRouteStats } from '../components/RouteStatsTable/cropRouteStats';
import type { RouteSeries, RouteStats, RouteStatsResult } from '../components/RouteStatsTable/types';
import type { TimeRange } from '../components/TimeRangePicker/timeRange';

/**
 * A grid of four 15s buckets ending at ANCHOR, matching what the server builds - see
 * RouteStatsService. A bucket named t covers (t - 15, t].
 */
const ANCHOR = 1_700_000_000;
const STEP = 15;
const BUCKETS = [ANCHOR - 45, ANCHOR - 30, ANCHOR - 15, ANCHOR];

function series(routeId: string, status: string, counts: number[]): RouteSeries {
    return { routeId, status, counts };
}

function route(routeId: string, over: Partial<RouteStats> = {}): RouteStats {
    return {
        routeId,
        routeName: routeId,
        uri: `/${routeId}`,
        live: true,
        configured: true,
        total: 0,
        informational: 0,
        success: 0,
        redirect: 0,
        clientError: 0,
        serverError: 0,
        errorRatePercent: null,
        clientErrorRatePercent: null,
        avgLatencyMs: 12.5,
        byStatus: {},
        ...over,
    };
}

function result(over: Partial<RouteStatsResult> = {}): RouteStatsResult {
    return {
        routes: [route('centric', { total: 40, success: 40, byStatus: { '200': 40 } })],
        bucketTimes: BUCKETS,
        stepSeconds: STEP,
        series: [series('centric', '200', [10, 10, 10, 10])],
        windowSeconds: 60,
        countQuery: 'sum by (route_id, route_name, status) (...)',
        latencyQuery: 'avg_over_time(...)',
        routesUnavailable: false,
        ...over,
    };
}

/** The last two buckets: (ANCHOR-30, ANCHOR]. */
const LAST_TWO: TimeRange = {
    kind: 'absolute',
    fromMs: (ANCHOR - 30) * 1000,
    toMs: ANCHOR * 1000,
};

describe('cropRouteStats', () => {
    /**
     * A relative window is resolved against the server's clock, so comparing it to one here
     * would shave a bucket off every window through drift alone - and a zoom never produces
     * one anyway.
     */
    it('leaves a relative range alone', () => {
        const full = result();
        const cropped = cropRouteStats(full, { kind: 'relative', seconds: 60 });

        expect(cropped.provisional).toBe(false);
        expect(cropped.result).toBe(full);
    });

    it('leaves a range that covers everything alone', () => {
        const full = result();
        const cropped = cropRouteStats(full, {
            kind: 'absolute',
            fromMs: (ANCHOR - 60) * 1000,
            toMs: ANCHOR * 1000,
        });

        expect(cropped.provisional).toBe(false);
        expect(cropped.result).toBe(full);
    });

    it('keeps only the buckets inside the window', () => {
        const cropped = cropRouteStats(result(), LAST_TWO);

        expect(cropped.provisional).toBe(true);
        expect(cropped.result.bucketTimes).toEqual([ANCHOR - 15, ANCHOR]);
        expect(cropped.result.windowSeconds).toBe(30);
        expect(cropped.result.series[0].counts).toEqual([10, 10]);
    });

    /**
     * The fold itself is exact arithmetic on the buckets in hand. Whether those agree with
     * the refetch is a separate question, and they need not: see the note on cropRouteStats.
     */
    it('recounts the table from the buckets it kept', () => {
        const cropped = cropRouteStats(result({
            routes: [route('centric', { total: 40 })],
            series: [
                series('centric', '200', [10, 10, 7, 3]),
                series('centric', '500', [0, 0, 1, 9]),
            ],
        }), LAST_TWO);

        const row = cropped.result.routes[0];
        expect(row.total).toBe(20);
        expect(row.success).toBe(10);
        expect(row.serverError).toBe(10);
        expect(row.byStatus).toEqual({ '200': 10, '500': 10 });
        expect(row.errorRatePercent).toBe(50);
    });

    /**
     * A bucket straddling the edge carries traffic from outside the window, and a total that
     * is nearly right is worse than one blank bucket at the edge.
     */
    it('drops a bucket that only partly falls inside', () => {
        const cropped = cropRouteStats(result(), {
            kind: 'absolute',
            // Starts mid-way through the third bucket, which therefore does not count.
            fromMs: (ANCHOR - 20) * 1000,
            toMs: ANCHOR * 1000,
        });

        expect(cropped.result.bucketTimes).toEqual([ANCHOR]);
        expect(cropped.result.routes[0].total).toBe(10);
    });

    /**
     * Latency comes from its own query and cannot be folded out of counts. Showing the wider
     * window's figure beside the narrower window's traffic would make it the one number on
     * the panel that is quietly wrong.
     */
    it('withholds latency rather than carrying the old window forward', () => {
        const cropped = cropRouteStats(result(), LAST_TWO);

        expect(cropped.result.routes[0].avgLatencyMs).toBeNull();
    });

    it('keeps what the config said about a route', () => {
        const cropped = cropRouteStats(result({
            routes: [route('centric', { routeName: 'named', uri: '/clo', live: false })],
        }), LAST_TWO);

        const row = cropped.result.routes[0];
        expect(row.routeName).toBe('named');
        expect(row.uri).toBe('/clo');
        expect(row.live).toBe(false);
        expect(row.configured).toBe(true);
    });

    /** A configured route keeps its row at zero, the same as it does in a full response. */
    it('keeps a route that has nothing left in the window', () => {
        const cropped = cropRouteStats(result({
            routes: [route('centric'), route('quiet')],
            series: [series('centric', '200', [10, 10, 10, 10])],
        }), LAST_TWO);

        const quiet = cropped.result.routes.find(r => r.routeId === 'quiet');
        expect(quiet?.total).toBe(0);
        expect(quiet?.errorRatePercent).toBeNull();
        expect(cropped.result.series).toHaveLength(1);
    });

    /** An all-zero series would put a flat line in the legend with nothing behind it. */
    it('drops a series that is empty across the kept buckets', () => {
        const cropped = cropRouteStats(result({
            series: [
                series('centric', '200', [10, 10, 10, 10]),
                series('centric', '503', [5, 5, 0, 0]),
            ],
        }), LAST_TWO);

        expect(cropped.result.series.map(s => s.status)).toEqual(['200']);
        expect(cropped.result.routes[0].byStatus).toEqual({ '200': 20 });
    });

    /** Traffic for a route the response had no row for still has to reach the table. */
    it('adds a row for a route that only exists in the series', () => {
        const cropped = cropRouteStats(result({
            routes: [],
            series: [series('gone', '200', [1, 2, 3, 4])],
        }), LAST_TWO);

        const row = cropped.result.routes[0];
        expect(row.routeId).toBe('gone');
        expect(row.total).toBe(7);
        expect(row.configured).toBe(false);
        expect(row.live).toBeNull();
    });

    /** Same rule the server folds by: an unclassified code still reaches the total. */
    it('counts a status outside the classes towards the total', () => {
        const cropped = cropRouteStats(result({
            series: [
                series('centric', '200', [0, 0, 3, 0]),
                series('centric', '', [0, 0, 2, 0]),
            ],
        }), LAST_TWO);

        const row = cropped.result.routes[0];
        expect(row.total).toBe(5);
        expect(row.success).toBe(3);
    });
});
