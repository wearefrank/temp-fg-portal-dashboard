import { useCallback, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useFetch } from '../../hooks/useFetch';
import { ChartTooltip } from '../chart/ChartTooltip';
import { toTooltipEntries, type TooltipCallbackProps } from '../chart/tooltipData';
import { buildGenericMaps, type SeriesMaps } from '../chart/palette';
import { useSeriesFocus } from '../chart/useSeriesFocus';
import { RangeToggle } from './RangeToggle';
import { findRange, type RangeLabel, type RangeOption } from './promRange';
import { seriesKeys, toChartRows, type PromRangeResponse } from './promSeries';
import styles from './PromLineChart.module.css';

export interface PromLineChartProps {
    title: string;
    /** $RANGE is replaced with the selected option's promRange. */
    queryTemplate: string;
    /** Which metric label separates the series. */
    seriesKey: string;
    seriesDisplay?: (key: string) => string;
    /** Overrides the colour scheme - buildCodeMaps for status codes, say. */
    buildMaps?: (keys: string[]) => SeriesMaps;
    subtitle: (range: RangeOption) => string;
    defaultRange?: RangeLabel;
    refreshKey: number;
}

export const PromLineChart = ({
    title,
    queryTemplate,
    seriesKey,
    seriesDisplay,
    buildMaps,
    subtitle,
    defaultRange = '1h',
    refreshKey,
}: PromLineChartProps) => {
    const [rangeLabel, setRangeLabel] = useState<RangeLabel>(defaultRange);
    const focus = useSeriesFocus();

    const range = findRange(rangeLabel);

    // The tick is the instant it fired, so the window slides forward with it rather than
    // growing from wherever the session started.
    const nowSec = Math.floor(refreshKey / 1000);

    const endpoint = useMemo(() => {
        const startSec = range.startOffset === null ? 0 : nowSec - range.startOffset;
        const query = queryTemplate.replace(/\$RANGE/g, range.promRange);
        const params = new URLSearchParams({ query, startTime: String(startSec), step: range.step });
        return `/metrics/prom-range?${params}`;
    }, [queryTemplate, range.promRange, range.startOffset, range.step, nowSec]);

    // No refreshKey needed: the URL already carries the tick, so it changes by itself.
    const dataFetch = useFetch<PromRangeResponse>(endpoint);

    const chart = useMemo(() => {
        const result = dataFetch.data?.data?.result;
        if (!result?.length) return null;
        const keys = seriesKeys(result, seriesKey);
        const { colorMap, dashMap } = (buildMaps ?? buildGenericMaps)(keys);
        return { keys, colorMap, dashMap, rows: toChartRows(result, seriesKey, keys) };
    }, [dataFetch.data, seriesKey, buildMaps]);

    const display = useMemo(() => seriesDisplay ?? ((key: string) => key), [seriesDisplay]);

    const tooltipContent = useCallback(({ active, payload, label }: TooltipCallbackProps) => (
        <ChartTooltip
            active={active}
            header={String(label ?? '')}
            entries={toTooltipEntries(payload, { display })}
        />
    ), [display]);

    const subtitleText = describeState(dataFetch, () => subtitle(range));

    return (
        <div className={`card ${styles.fullWidthCard}`}>
            <div className="card-header">{title}</div>
            <RangeToggle value={rangeLabel} onChange={setRangeLabel} />
            <div className={`text-small text-muted ${styles.emptyHint}`}>{subtitleText}</div>
            <div className={styles.chartArea}>
                {chart && (
                    <ResponsiveContainer width="100%" height={260}>
                        <LineChart data={chart.rows} margin={{ top: 12, right: 24, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-dim)" />
                            <XAxis dataKey="time" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                            <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} width={48} axisLine={false} tickLine={false} />
                            <Tooltip content={tooltipContent} />
                            <Legend
                                onClick={event => focus.toggle(event.dataKey as string)}
                                onMouseEnter={event => focus.hover(event.dataKey as string)}
                                onMouseLeave={() => focus.hover(null)}
                                wrapperStyle={{ cursor: 'pointer' }}
                            />
                            {chart.keys.map(key => (
                                <Line
                                    key={key}
                                    type="monotone"
                                    dataKey={key}
                                    stroke={chart.colorMap[key]}
                                    strokeDasharray={chart.dashMap[key]}
                                    strokeWidth={focus.isHighlighted(key) ? 3 : 2}
                                    strokeOpacity={focus.isDimmed(key) ? 0.2 : 1}
                                    dot={false}
                                    hide={focus.isHidden(key)}
                                    isAnimationActive={false}
                                />
                            ))}
                        </LineChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
};

/** Only the states the chart itself cannot show. */
function describeState(
    fetch: { loading: boolean; error: string | null; data: PromRangeResponse | null },
    describeData: () => string,
): string {
    if (fetch.loading) return 'Loading…';
    if (fetch.error) return 'Prometheus unavailable';
    if (fetch.data?.data?.result?.length === 0) {
        return 'No data yet — send requests through APISIX to populate this chart';
    }
    return describeData();
}
