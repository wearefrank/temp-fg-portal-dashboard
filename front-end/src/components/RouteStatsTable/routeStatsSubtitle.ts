import { describeRange, type TimeRange } from '../TimeRangePicker/timeRange';
import type { View } from './trafficChartData';

export interface RouteStatsSubtitleInput {
    loading: boolean;
    error: string | null;
    routesUnavailable: boolean;
    range: TimeRange;
    view: View;
    drilling: boolean;
}

/** The line under the header: where the numbers came from */
export function routeStatsSubtitle(input: RouteStatsSubtitleInput): string {
    const window = describeRange(input.range);

    if (input.error) return `Loki unavailable — ${input.error}`;
    // Names the window, so a zoom reads as this one arriving rather than the panel stalling.
    if (input.loading) return `Counting ${window}...`;
    if (input.routesUnavailable) {
        return `Counted by Loki over ${window}. APISIX is unreachable, so Live is unknown`
            + ' and routes with no traffic are missing.';
    }

    const counted = `Counted by Loki over ${window}, ${chartShape(input)}`;
    // The header counts down to refreshes this panel will stop taking, so it says so rather
    // than looking stuck. Stated for any fixed window, since whether polling has actually
    // stopped is a question about the clock, which a render may not read.
    if (input.range.kind === 'absolute') {
        return `${counted} A fixed window - polling stops once the log behind it has settled.`;
    }
    return counted;
}

/** How the chart above draws them, so "stacked" is only claimed where it is true. */
function chartShape({ view, drilling }: RouteStatsSubtitleInput): string {
    if (drilling) return 'one bar per status class, with its exact codes stacked inside.';
    if (view === 'status') return 'the full height is total traffic.';
    return 'one line per route.';
}
