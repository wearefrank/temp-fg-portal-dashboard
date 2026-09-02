import { useCallback, useEffect, useState } from 'react';
import type { TimeRange } from '../TimeRangePicker/timeRange';
import type { TrafficChartData } from './trafficChartData';

/** The half of recharts' mouse-handler argument this chart reads. */
export interface ChartMouseState {
    activeTooltipIndex?: number | string | null;
}

export interface ChartZoomOptions {
    /** Told when a drag opens and closes, so the panel can hold its data still meanwhile. */
    onDragChange?: (dragging: boolean) => void;
}

/**
 * Dragging across the plot narrows the window rather than magnifying the picture: the span
 * becomes an absolute TimeRange, which refetches onto a finer step from the server's ladder.
 * So an hour pulled out of a week arrives as 30s buckets, not four fat hourly ones stretched.
 *
 * A click is the same move over a single bucket - the usual way in is "that spike, closer",
 * and aiming a drag at one bar to ask that is work the picture does not need.
 *
 * Both ends are held as bucket end times, not as row indices: the dashboard's refresh can
 * rebuild the rows mid-drag, and an index would then name whatever bucket had moved into it.
 */
export function useChartZoom(
    chart: TrafficChartData | null,
    onZoom: (range: TimeRange) => void,
    { onDragChange }: ChartZoomOptions = {},
) {
    const [from, setFrom] = useState<number | null>(null);
    const [to, setTo] = useState<number | null>(null);
    const dragging = from !== null;

    const cancel = useCallback(() => {
        setFrom(null);
        setTo(null);
        onDragChange?.(false);
    }, [onDragChange]);

    const begin = useCallback((state: ChartMouseState) => {
        const time = bucketTime(chart, state);
        if (time === null) return;
        setFrom(time);
        setTo(time);
        onDragChange?.(true);
    }, [chart, onDragChange]);

    const extend = useCallback((state: ChartMouseState) => {
        if (!dragging) return;
        const time = bucketTime(chart, state);
        if (time !== null) setTo(time);
    }, [chart, dragging]);

    /**
     * The release is watched on the window rather than on the plot, because the plot is not
     * where a drag necessarily ends: the cursor wanders past the axis, or a card above the
     * panel grows on the dashboard's refresh and slides the chart out from under it. Both used
     * to read as "left the chart, abandon it", which threw away a selection mid-drag.
     *
     * So leaving the plot only stops the band growing. Only the mouse coming up ends the drag,
     * wherever it happens, and Escape is the way out without zooming.
     */
    useEffect(() => {
        if (!dragging) return;

        const commit = () => {
            // A press that never moved ends on the bucket it started on, so first and last are
            // the same one and the window becomes that single bucket.
            if (to !== null && chart) {
                const [first, last] = from < to ? [from, to] : [to, from];

                // A bucket named t covers (t - step, t], so the selection starts one step
                // before the first bucket's name and ends on the last one's.
                onZoom({
                    kind: 'absolute',
                    fromMs: (first - chart.foldedStep) * 1000,
                    toMs: last * 1000,
                });
            }
            // Closed after the zoom, not before: the panel holds a tick that lands mid-drag
            // and runs it when the drag closes, and a drag that moved the window has already
            // answered that tick by refetching.
            cancel();
        };

        const abandon = (event: KeyboardEvent) => {
            if (event.key === 'Escape') cancel();
        };

        window.addEventListener('mouseup', commit);
        window.addEventListener('keydown', abandon);
        return () => {
            window.removeEventListener('mouseup', commit);
            window.removeEventListener('keydown', abandon);
        };
    }, [dragging, from, to, chart, onZoom, cancel]);

    // A chart that goes away mid-drag must not leave the panel believing one is still open -
    // it would then hold every refresh from here on. Closing twice does nothing.
    useEffect(() => {
        if (!dragging) return;
        return () => onDragChange?.(false);
    }, [dragging, onDragChange]);

    return {
        band: dragBand(chart, from, to),
        handlers: {
            onMouseDown: begin,
            onMouseMove: extend,
        },
    };
}

/** The highlighted span as the row labels recharts draws it between, or null when idle. */
function dragBand(
    chart: TrafficChartData | null,
    from: number | null,
    to: number | null,
): { x1: string; x2: string } | null {
    if (!chart || from === null || to === null || from === to) return null;

    const first = nearestRow(chart.foldedTimes, Math.min(from, to));
    const last = nearestRow(chart.foldedTimes, Math.max(from, to));
    if (first < 0 || last < 0) return null;

    return { x1: String(chart.rows[first].time), x2: String(chart.rows[last].time) };
}

/** The row for a bucket time - nearest, not exact, since a refresh can move the grid. */
function nearestRow(times: number[], time: number): number {
    let best = -1;
    let bestGap = Infinity;
    times.forEach((bucket, index) => {
        const gap = Math.abs(bucket - time);
        if (gap < bestGap) {
            bestGap = gap;
            best = index;
        }
    });
    return best;
}

/** The end time of the bucket under the cursor, or null when it is not over one. */
function bucketTime(chart: TrafficChartData | null, state: ChartMouseState): number | null {
    const index = bucketIndex(state);
    if (index === null || !chart) return null;
    return chart.foldedTimes[index] ?? null;
}

/**
 * The bucket under the cursor. Recharts types this loosely - a string index for chart kinds
 * with no numeric one - so anything that is not a real position reads as "not over a bucket".
 */
function bucketIndex(state: ChartMouseState | null | undefined): number | null {
    const raw = state?.activeTooltipIndex;
    const index = typeof raw === 'string' ? Number(raw) : raw;
    return typeof index === 'number' && Number.isInteger(index) ? index : null;
}
