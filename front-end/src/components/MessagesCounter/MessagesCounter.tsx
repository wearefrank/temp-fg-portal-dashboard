import React, { useMemo } from 'react';
import { useFetch } from '../../hooks/useFetch';
import styles from './MessagesCounter.module.css';

interface PromVectorResponse {
    status: string;
    data: {
        resultType: string;
        result: { metric: Record<string, string>; value: [number, string] }[];
    };
}

interface MessagesCounterProps {
    title: string;
    /**
     * PromQL label selector narrowing which traffic counts, e.g.
     * '{route=~"centric-to-djuma-route|djuma-to-centric-route"}'. Empty counts every
     * routed request, which is what "messages" means once the local test routes are
     * gone from the config.
     */
    selector?: string;
    refreshKey: number;
}

const promQuery = (query: string) => '/metrics/prom-query?query=' + encodeURIComponent(query);

// An instant query on a sum() returns one element; anything else means no data.
function scalarOf(response: PromVectorResponse | null): number | null {
    const raw = response?.data?.result?.[0]?.value?.[1];
    if (raw == null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}

/**
 * Total requests the gateway actually routed.
 *
 * Counted from apisix_http_status, NOT apisix_http_requests_total. The latter is an
 * nginx-level count of every request the process handled, so Prometheus scraping the
 * metrics endpoint every 5s inflates it - it climbs on a gateway that is proxying
 * nothing at all. apisix_http_status only increments for a request that matched a route.
 *
 * The headline is an instant sum, so it is exact but resets when the gateway restarts:
 * it is "since APISIX started", which is what the caption says. Deliberately not
 * increase(...[365d]) - that extrapolates wildly over a window far longer than the data,
 * and last_over_time over the same window sums stale series from earlier container runs
 * on top of the live ones.
 */
export const MessagesCounter: React.FC<MessagesCounterProps> = ({ title, selector = '', refreshKey }) => {
    const totalEndpoint = useMemo(
        () => promQuery(`sum(apisix_http_status${selector})`),
        // refreshKey re-runs the fetch on the dashboard's 30s tick
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [selector, refreshKey],
    );
    // A one-hour window is short enough that increase()'s edge extrapolation stays small,
    // unlike the multi-month windows the older panels use.
    const lastHourEndpoint = useMemo(
        () => promQuery(`round(sum(increase(apisix_http_status${selector}[1h])))`),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [selector, refreshKey],
    );

    const totalFetch = useFetch<PromVectorResponse>(totalEndpoint);
    const lastHourFetch = useFetch<PromVectorResponse>(lastHourEndpoint);

    const total = scalarOf(totalFetch.data);
    const lastHour = scalarOf(lastHourFetch.data);

    let display: string;
    if (totalFetch.loading) display = '—';
    else if (totalFetch.error) display = '—';
    else if (total == null) display = '0';
    else display = Math.round(total).toLocaleString();

    let caption: string;
    if (totalFetch.loading) caption = 'Loading…';
    else if (totalFetch.error) caption = 'Prometheus unavailable';
    else if (total == null) caption = 'No data yet — send requests through APISIX';
    else caption = 'routed requests since the gateway started';

    return (
        <div className="card">
            <div className="card-header">{title}</div>
            <div className={`${styles.value} ${total == null ? styles.valueMuted : ''}`}>{display}</div>
            <div className={styles.caption}>{caption}</div>
            <div className={styles.secondary}>
                <span className={styles.caption}>Last hour</span>
                <span className={styles.secondaryValue}>
                    {lastHourFetch.loading || lastHourFetch.error || lastHour == null
                        ? '—'
                        : Math.round(lastHour).toLocaleString()}
                </span>
            </div>
        </div>
    );
};
