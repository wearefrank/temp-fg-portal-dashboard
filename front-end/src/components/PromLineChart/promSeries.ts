/** One series out of a Prometheus range query. */
export interface PromRangeSeries {
    metric: Record<string, string>;
    values: [number, string][];
}

export interface PromRangeResponse {
    status: string;
    data: {
        resultType: string;
        result: PromRangeSeries[];
    };
}

/** The series names present, sorted so colours stay put between refreshes. */
export function seriesKeys(result: PromRangeSeries[], seriesKey: string): string[] {
    return [...new Set(result.map(series => series.metric[seriesKey] ?? '(none)'))].sort();
}

/**
 * The response as recharts wants it: one row per timestamp, every key present.
 * Missing points become 0 so a row's shape never varies.
 */
export function toChartRows(
    result: PromRangeSeries[],
    seriesKey: string,
    keys: string[],
): Record<string, unknown>[] {
    const rowsByTime = new Map<number, Record<string, number>>();

    for (const series of result) {
        const key = series.metric[seriesKey] ?? '(none)';
        for (const [ts, value] of series.values) {
            let row = rowsByTime.get(ts);
            if (!row) {
                row = { ts };
                rowsByTime.set(ts, row);
            }
            row[key] = Number(value);
        }
    }

    return [...rowsByTime.values()]
        .sort((a, b) => a.ts - b.ts)
        .map(row => ({
            ...Object.fromEntries(keys.map(key => [key, row[key] ?? 0])),
            time: formatTime(row.ts),
        }));
}

function formatTime(epochSeconds: number): string {
    return new Date(epochSeconds * 1000)
        .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
