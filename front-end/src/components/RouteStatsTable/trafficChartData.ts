import { buildCodeMaps, buildGenericMaps } from '../chart/palette';
import type { RouteSeries, RouteStatsResult } from './types';

/**
 * How the same buckets are coloured. "status" answers what broke and when; "route" answers
 * what went quiet. Both are folds of one response, so switching costs a re-render, not a query.
 */
export type View = 'status' | 'route';

/** Where a code with no class of its own is counted, so the stack always sums to the total. */
const OTHER = 'other';

/** One colour per class, matching the family each palette in buildCodeMaps starts with. */
const CLASS_COLORS: Record<string, string> = {
    '1xx': '#94a3b8',
    '2xx': '#22c55e',
    '3xx': '#3b82f6',
    '4xx': '#f97316',
    '5xx': '#ef4444',
    [OTHER]: '#64748b',
};

// Errors at the bottom, against the axis, where their height is readable rather than riding on
// whatever is piled under them. Fixed, so a stack does not reorder itself between refreshes.
const CLASS_ORDER = ['5xx', '4xx', OTHER, '1xx', '3xx', '2xx'];

/**
 * Bars to aim for when one route is picked. A bucket is split between the classes standing in
 * it, so the budget is bars rather than buckets - ~168 raw buckets times a bar each is a sliver.
 */
const TARGET_BARS = 96;

/** Never fold past this many columns, or the shape over time goes with them. */
const MIN_BUCKETS = 24;

export interface TrafficChartData {
    keys: string[];
    rows: Record<string, string | number>[];
    colorMap: Record<string, string>;
    /** Series sharing an id stack into one bar; different ids stand side by side. */
    stackIds: Record<string, string>;
    /** Bucket end times after folding, for translating a drag back into a window. */
    foldedTimes: number[];
    foldedStep: number;
}

interface BuildOptions {
    view: View;
    /** Route id to drill into, or null for the overview. "" is the no-route bucket. */
    selectedRoute: string | null;
    withDate: boolean;
}

/**
 * The series folded the way this view wants them, plus one row per bucket.
 *
 * Every series arrives full width and zero-filled from the server, so this is a sum per bucket
 * with no gap handling of its own - see RouteSeriesDto.
 */
export function buildTrafficChart(
    result: RouteStatsResult,
    { view, selectedRoute, withDate }: BuildOptions,
): TrafficChartData | null {
    const { bucketTimes, series, routes, stepSeconds } = result;
    if (bucketTimes.length === 0) return null;

    const drilling = selectedRoute !== null;
    const relevant = drilling ? series.filter(s => s.routeId === selectedRoute) : series;

    // Keyed up front because how far the grid folds depends on how many bars share a bucket.
    const nameOf = routeNamer(routes);
    const keyed = relevant.map(entry => ({
        key: seriesKey(entry, view, drilling, nameOf),
        counts: entry.counts,
    }));

    // Drilled in, the grid folds down to bars you can tell apart. The buckets tile the window,
    // so summing adjacent ones is exact - a coarser bucket, not a resample.
    const bars = new Set(keyed.map(entry => stackIdFor(entry.key, drilling))).size;
    const fold = drilling ? foldFactor(bucketTimes.length, bars) : 1;
    const foldedTimes = foldBucketTimes(bucketTimes, fold);

    const totals = new Map<string, number[]>();
    for (const { key, counts: source } of keyed) {
        let counts = totals.get(key);
        if (!counts) {
            counts = new Array<number>(foldedTimes.length).fill(0);
            totals.set(key, counts);
        }
        source.forEach((count, i) => { counts[Math.floor(i / fold)] += count; });
    }

    const foldedStep = stepSeconds * fold;
    const keys = sortKeys([...totals.keys()], totals, view, drilling);
    const rows = foldedTimes.map((ts, i) => {
        const row: Record<string, string | number> = {
            time: formatBucket(ts, { withDate, withSeconds: foldedStep < 60 }),
        };
        for (const key of keys) row[key] = totals.get(key)![i];
        return row;
    });

    return {
        keys,
        rows,
        colorMap: colorsFor(keys, view, drilling),
        stackIds: Object.fromEntries(keys.map(key => [key, stackIdFor(key, drilling)])),
        foldedTimes,
        foldedStep,
    };
}

/** Buckets summed into one, held between "wide enough to see" and "still a time series". */
function foldFactor(buckets: number, seriesCount: number): number {
    const forWidth = Math.ceil((buckets * Math.max(1, seriesCount)) / TARGET_BARS);
    return Math.max(1, Math.min(forWidth, Math.floor(buckets / MIN_BUCKETS)));
}

// A folded bucket ends where its last original one did, since a bucket is named by the
// instant it ends at.
function foldBucketTimes(bucketTimes: number[], fold: number): number[] {
    const count = Math.ceil(bucketTimes.length / fold);
    return Array.from({ length: count }, (_, i) =>
        bucketTimes[Math.min((i + 1) * fold - 1, bucketTimes.length - 1)]);
}

/** Display names for the route view, so a row reads as its name rather than its id. */
function routeNamer(routes: RouteStatsResult['routes']): (routeId: string) => string {
    const byId = new Map(routes.map(r => [r.routeId, r.routeName ?? r.uri ?? r.routeId]));
    return routeId => byId.get(routeId) ?? routeId;
}

function seriesKey(
    entry: RouteSeries,
    view: View,
    drilling: boolean,
    nameOf: (routeId: string) => string,
): string {
    if (drilling) return entry.status || '(none)';
    if (view === 'status') return statusClass(entry.status);
    if (entry.routeId === '') return '(no route)';
    return nameOf(entry.routeId);
}

/**
 * Which bar a series belongs in. Drilled in that is its class, so the exact codes stack inside
 * one bar per class and the classes stand beside each other - a 404 is read against the other
 * 4xx it came with, and against the axis, rather than against the 2xx pile under it.
 */
function stackIdFor(key: string, drilling: boolean): string {
    return drilling ? statusClass(key) : 'traffic';
}

/** The class a status code belongs to: "401" -> "4xx", anything unrecognised -> other. */
function statusClass(status: string): string {
    const digit = status.charAt(0);
    return digit >= '1' && digit <= '5' ? `${digit}xx` : OTHER;
}

function sortKeys(
    keys: string[],
    totals: Map<string, number[]>,
    view: View,
    drilling: boolean,
): string[] {
    // Every status code is three characters wide, so ordering them as text orders them as
    // numbers: the classes stand left to right the way they climb, and so do the codes in each.
    if (drilling) return [...keys].sort((a, b) => a.localeCompare(b));
    if (view === 'status') return [...keys].sort((a, b) => CLASS_ORDER.indexOf(a) - CLASS_ORDER.indexOf(b));
    // Busiest first, so the legend order matches the table underneath it.
    return [...keys].sort((a, b) => sum(totals.get(b)!) - sum(totals.get(a)!));
}

function colorsFor(keys: string[], view: View, drilling: boolean): Record<string, string> {
    // buildCodeMaps gives each family its own ramp, so 500/502/503/504 arrive as four
    // distinguishable reds rather than four arbitrary colours.
    if (drilling) return buildCodeMaps(keys).colorMap;
    if (view === 'status') {
        return Object.fromEntries(keys.map(key => [key, CLASS_COLORS[key] ?? CLASS_COLORS[OTHER]]));
    }
    return buildGenericMaps(keys).colorMap;
}

/**
 * The label a bucket is drawn under, which is also its identity on the category axis - two
 * rows sharing one label collapse into a single tick, and the points then sit somewhere the
 * cursor and the drag band do not.
 *
 * So a window wider than a day carries the date - "09:00" alone is six points in a week - and
 * buckets shorter than a minute carry the seconds.
 */
function formatBucket(
    epochSeconds: number,
    { withDate, withSeconds }: { withDate: boolean; withSeconds: boolean },
): string {
    const date = new Date(epochSeconds * 1000);
    const time = date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: withSeconds ? '2-digit' : undefined,
        hour12: false,
    });
    if (!withDate) return time;
    return `${date.toLocaleDateString([], { day: '2-digit', month: 'short' })} ${time}`;
}

function sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
}
