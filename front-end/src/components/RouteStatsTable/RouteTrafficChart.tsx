import { useCallback, useMemo } from 'react';
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    DefaultZIndexes,
    Legend,
    Line,
    LineChart,
    ReferenceArea,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { ChartTooltip } from '../chart/ChartTooltip';
import { toTooltipEntries, type TooltipCallbackProps } from '../chart/tooltipData';
import { useSeriesFocus } from '../chart/useSeriesFocus';
import { spansMoreThanADay, type TimeRange } from '../TimeRangePicker/timeRange';
import { buildTrafficChart, type View } from './trafficChartData';
import { useChartZoom } from './useChartZoom';
import type { RouteStatsResult } from './types';
import styles from './RouteStatsTable.module.css';

const MARGIN = { top: 12, right: 24, left: 0, bottom: 0 };

// A ReferenceArea defaults to the Area layer, where the stack - declared after it - paints
// straight over the drag band. A selection belongs on top of what it is selecting.
const BAND_Z_INDEX = DefaultZIndexes.activeBar;

interface RouteTrafficChartProps {
    result: RouteStatsResult;
    range: TimeRange;
    /** Owned by the panel, so its toggle stays put while this chart waits for a window. */
    view: View;
    /** Route id to drill into, or null for the overview. "" is the no-route bucket. */
    selectedRoute: string | null;
    /** Narrows the window to a dragged span. */
    onZoom: (range: TimeRange) => void;
    /** Raised while a drag is open, so the panel can stop refetching under it. */
    onDragChange?: (dragging: boolean) => void;
}

export const RouteTrafficChart = ({
    result,
    range,
    view,
    selectedRoute,
    onZoom,
    onDragChange,
}: RouteTrafficChartProps) => {
    const focus = useSeriesFocus();

    const withDate = spansMoreThanADay(range);
    const drilling = selectedRoute !== null;

    const chart = useMemo(
        () => buildTrafficChart(result, { view, selectedRoute, withDate }),
        [result, view, selectedRoute, withDate],
    );

    const zoom = useChartZoom(chart, onZoom, { onDragChange });

    const tooltipContent = useCallback(({ active, payload, label }: TooltipCallbackProps) => (
        <ChartTooltip
            active={active}
            header={String(label ?? '')}
            entries={toTooltipEntries(payload, { skipZero: true, reverse: !drilling })}
        />
    ), [drilling]);

    if (!chart) return null;

    const axes = (
        <>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-dim)" />
            <XAxis
                dataKey="time"
                tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={40}
            />
            <YAxis
                allowDecimals={false}
                tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
                width={48}
                axisLine={false}
                tickLine={false}
            />

            <Tooltip content={tooltipContent} isAnimationActive={false} />
            <Legend
                onClick={event => focus.toggle(event.dataKey as string)}
                wrapperStyle={{ cursor: 'pointer', fontSize: '0.8rem' }}
            />
            {zoom.band && (
                <ReferenceArea
                    x1={zoom.band.x1}
                    x2={zoom.band.x2}
                    zIndex={BAND_Z_INDEX}
                    ifOverflow="visible"
                    fill="var(--accent-color)"
                    fillOpacity={0.2}
                    stroke="var(--accent-color)"
                    strokeOpacity={0.6}
                />
            )}
        </>
    );

    const shared = { data: chart.rows, margin: MARGIN, ...zoom.handlers };

    const renderChart = () => {
        if (drilling) {
            return (
                <BarChart {...shared} barGap={2} barCategoryGap="20%">
                    {axes}
                    {chart.keys.map(key => (
                        <Bar
                            key={key}
                            dataKey={key}
                            stackId={chart.stackIds[key]}
                            fill={chart.colorMap[key]}
                            hide={focus.isHidden(key)}
                            isAnimationActive={false}
                        />
                    ))}
                </BarChart>
            );
        }

        // Stacked, because the question is how the total splits: the band's height is the
        // traffic and its colour is the health, both at once.
        if (view === 'status') {
            return (
                <AreaChart {...shared}>
                    {axes}
                    {chart.keys.map(key => (
                        <Area
                            key={key}
                            type="monotone"
                            dataKey={key}
                            stackId="traffic"
                            stroke="none"
                            fill={chart.colorMap[key]}
                            fillOpacity={0.7}
                            hide={focus.isHidden(key)}
                            isAnimationActive={false}
                        />
                    ))}
                </AreaChart>
            );
        }

        // Lines rather than a stack: a route falling to zero has to be visible as its own line
        // touching the axis, which a stacked band hides behind whatever is piled on top.
        return (
            <LineChart {...shared}>
                {axes}
                {chart.keys.map(key => (
                    <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        stroke={chart.colorMap[key]}
                        strokeWidth={2}
                        dot={false}
                        hide={focus.isHidden(key)}
                        isAnimationActive={false}
                    />
                ))}
            </LineChart>
        );
    };

    return (
        <div className={styles.chartArea}>
            {/* Both dimensions come from .chartArea, so the height lives in one place. */}
            <ResponsiveContainer width="100%" height="100%">
                {renderChart()}
            </ResponsiveContainer>
        </div>
    );
};
