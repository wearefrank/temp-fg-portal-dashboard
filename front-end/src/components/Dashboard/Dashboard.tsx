import React, { useEffect, useState } from 'react';
// import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
// import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from 'recharts';
import { useFetch } from '../../hooks/useFetch';
import { client } from '../../api/client';
import styles from './Dashboard.module.css';
// import { PromLineChart, RangeToggle, ChartTooltip, buildCodeMaps, RANGE_OPTIONS } from '../PromLineChart/PromLineChart';
// import type { RangeLabel } from '../PromLineChart/PromLineChart';
import { LokiLogTable } from '../LokiLogTable/LokiLogTable';
import { MessagesCounter } from '../MessagesCounter/MessagesCounter';

// interface PromResult {
//     metric: Record<string, string>;
//     value: [number, string];
// }

// interface PromQueryResponse {
//     status: string;
//     data: {
//         resultType: string;
//         result: PromResult[];
//     };
// }

interface ConnectionConfig {
    host: string;
    controlPort: number;
}

// interface MetricsDto {
//     totalRequests: number;
//     connections: Record<string, number>;
//     version: string | null;
//     hostname: string | null;
// }

interface LiveNode {
    host: string;
    port: number;
    weight: number;
}

interface LiveRouteValue {
    id: string;
    uri: string;
    status: number;
    plugins?: Record<string, unknown>;
    upstream_id?: number;
}

interface LiveRoute {
    key: string;
    value: LiveRouteValue;
}

interface LiveUpstreamValue {
    id: string;
    type: string;
    nodes: LiveNode[];
}

interface LiveUpstream {
    key: string;
    value: LiveUpstreamValue;
}

interface LiveServiceValue {
    id: string;
    name?: string;
    desc?: string;
    upstream_id?: string | number;
    upstream?: { nodes?: LiveNode[] };
    plugins?: Record<string, unknown>;
}

interface LiveService {
    key: string;
    value: LiveServiceValue;
}

type ConnectionStatus = 'checking' | 'online' | 'offline';

export const Dashboard: React.FC = () => {
    const connectionConfigFetch = useFetch<ConnectionConfig>('/config');
    // const metricsFetch = useFetch<MetricsDto>('/metrics/prometheus');
    const liveRoutesFetch = useFetch<LiveRoute[]>('/metrics/routes');
    const liveUpstreamsFetch = useFetch<LiveUpstream[]>('/metrics/upstreams');
    const liveServicesFetch = useFetch<LiveService[]>('/metrics/services');
    // The metrics above are scraped from the APISIX exporter, which answers whether APISIX is up -
    // not whether Prometheus is. This asks the Prometheus server directly.
    // const prometheusHealthFetch = useFetch<boolean>('/metrics/prometheus/health');
    // One line is enough to answer "is Loki reachable" for the status card; the table
    // below fetches its own window.
    const lokiHealthFetch = useFetch<unknown[]>('/logs/recent?limit=1&startTime=0');
    // const [barRangeLabel, setBarRangeLabel] = useState<RangeLabel>('All');
    // const [routeTableRangeLabel, setRouteTableRangeLabel] = useState<RangeLabel>('All');
    const [refreshKey, setRefreshKey] = useState(0);
    // const selectedBarRange = RANGE_OPTIONS.find(r => r.label === barRangeLabel)!;
    // const selectedRouteTableRange = RANGE_OPTIONS.find(r => r.label === routeTableRangeLabel)!;
    // const barEndpoint = useMemo(() => {
    //     // increase(), not last_over_time(). apisix_http_status is a cumulative counter, so
    //     // last_over_time returns the running total rather than the count for the window -
    //     // "1h" was reporting everything since the gateway started. increase() also handles
    //     // counter resets, so an APISIX restart no longer erases the history, and it does not
    //     // sum the final values of dead series from earlier container runs on top of the live
    //     // ones (that is what inflated the all-time figure ~60x).
    //     const query = `round(sum by (code) (increase(apisix_http_status[${selectedBarRange.barWindow}])))`;
    //     return '/metrics/prom-query?query=' + encodeURIComponent(query);
    // }, [selectedBarRange.barWindow]);
    // const routeTableEndpoint = useMemo(() => {
    //     // Same correction as the bar chart above.
    //     const query = `round(sum by (route, code) (increase(apisix_http_status[${selectedRouteTableRange.barWindow}])))`;
    //     return '/metrics/prom-query?query=' + encodeURIComponent(query);
    // }, [selectedRouteTableRange.barWindow]);
    // const httpStatusFetch = useFetch<PromQueryResponse>(barEndpoint);
    // const routeTableFetch = useFetch<PromQueryResponse>(routeTableEndpoint);

    const [controlStatus, setControlStatus] = useState<ConnectionStatus>('checking');
    const [countdown, setCountdown] = useState<number>(30);

    // const barChartData = useMemo(() => {
    //     if (!httpStatusFetch.data?.data?.result?.length) return null;
    //     const sorted = [...httpStatusFetch.data.data.result]
    //         .sort((a, b) => (a.metric.code ?? '').localeCompare(b.metric.code ?? ''))
    //         .map(r => ({ code: r.metric.code ?? '?', count: Number(r.value[1]) }));
    //     const { colorMap } = buildCodeMaps(sorted.map(d => d.code));
    //     return { sorted, colorMap };
    // }, [httpStatusFetch.data]);

    // const routeTableData = useMemo(() => {
    //     if (!routeTableFetch.data?.data?.result?.length) return null;
    //     const routeMap: Record<string, Record<string, number>> = {};
    //     const allCodes = new Set<string>();
    //     for (const r of routeTableFetch.data.data.result) {
    //         const route = r.metric.route ?? '(none)';
    //         const code = r.metric.code ?? '?';
    //         allCodes.add(code);
    //         if (!routeMap[route]) routeMap[route] = {};
    //         routeMap[route][code] = Number(r.value[1]);
    //     }
    //     const routes = Object.keys(routeMap).sort();
    //     const codes = [...allCodes].sort();
    //     const { colorMap } = buildCodeMaps(codes);
    //     return { routeMap, routes, codes, colorMap };
    // }, [routeTableFetch.data]);

    // const barTooltipContent = useCallback(({ active, payload, label }: { active?: boolean; payload?: ReadonlyArray<{ value?: unknown }>; label?: unknown }) => {
    //     const code = label as string;
    //     const entries = [{ key: code, label: 'requests', color: barChartData?.colorMap[code] ?? '', value: Number(payload?.[0]?.value ?? 0) }];
    //     return <ChartTooltip active={active} header={`HTTP ${code}`} entries={entries} />;
    // }, [barChartData?.colorMap]);

    // const httpStatusRefetchRef = useRef(httpStatusFetch.refetch);
    // useEffect(() => { httpStatusRefetchRef.current = httpStatusFetch.refetch; });
    // const routeTableRefetchRef = useRef(routeTableFetch.refetch);
    // useEffect(() => { routeTableRefetchRef.current = routeTableFetch.refetch; });

    useEffect(() => {
        if (!connectionConfigFetch.data) return;
        client<boolean>('/config/check?api=control', { method: 'GET' })
            .then(ok => setControlStatus(ok ? 'online' : 'offline'))
            .catch(() => setControlStatus('offline'));
    }, [connectionConfigFetch.data]);

    useEffect(() => {
        const refresh = setInterval(() => {
            connectionConfigFetch.refetch();
            // metricsFetch.refetch();
            liveRoutesFetch.refetch();
            liveUpstreamsFetch.refetch();
            liveServicesFetch.refetch();
            // prometheusHealthFetch.refetch();
            lokiHealthFetch.refetch();
            // httpStatusRefetchRef.current();
            // routeTableRefetchRef.current();
            setRefreshKey(k => k + 1);
            setCountdown(30);
        }, 30_000);
        const tick = setInterval(() => {
            setCountdown(prev => (prev <= 1 ? 30 : prev - 1));
        }, 1_000);
        return () => {
            clearInterval(refresh);
            clearInterval(tick);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // useFetch keeps the last successful value on a failed refetch, so the error has to be
    // checked too - otherwise a stale `true` would keep reporting Prometheus as active.
    // const prometheusUp = prometheusHealthFetch.data === true && !prometheusHealthFetch.error;

    // Drives the spinning sync icon - the page's single "refreshing now" signal, so no panel
    // has to announce a refresh by blanking itself out.
    const refreshing = connectionConfigFetch.loading || liveRoutesFetch.loading
        || liveUpstreamsFetch.loading || liveServicesFetch.loading || lokiHealthFetch.loading;

    // "Checking" is the first-load state; a refresh keeps the verdict Loki last gave.
    const lokiChecking = lokiHealthFetch.loading && lokiHealthFetch.data == null && !lokiHealthFetch.error;

    const statusDotClass =
        controlStatus === 'online'  ? styles.statusDotOnline  :
        controlStatus === 'offline' ? styles.statusDotOffline :
        styles.statusDotChecking;

    // let barSubtitle: string;
    // if (httpStatusFetch.loading) barSubtitle = 'Loading…';
    // else if (httpStatusFetch.error) barSubtitle = 'Prometheus unavailable';
    // else if (httpStatusFetch.data?.data?.result?.length === 0) barSubtitle = 'No data yet — send requests through APISIX to populate this chart';
    // else barSubtitle = `via Prometheus: increase(apisix_http_status[${selectedBarRange.barWindow}]) · ${selectedBarRange.label === 'All' ? 'everything Prometheus still retains' : `last ${selectedBarRange.label}`}`;

    // let routeTableSubtitle: string;
    // if (routeTableFetch.loading) routeTableSubtitle = 'Loading…';
    // else if (routeTableFetch.error) routeTableSubtitle = 'Prometheus unavailable';
    // else if (routeTableFetch.data?.data?.result?.length === 0) routeTableSubtitle = 'No data yet — send requests through APISIX to populate this table';
    // else routeTableSubtitle = `via Prometheus: increase(apisix_http_status[${selectedRouteTableRange.barWindow}]) grouped by route and code · ${selectedRouteTableRange.label === 'All' ? 'everything Prometheus still retains' : `last ${selectedRouteTableRange.label}`}`;

    return (
        <div className="container">
            <h1>Dashboard
                <span
                    className={`material-icons text-muted ${refreshing ? styles.syncSpinning : ''}`}
                    style={{ fontSize: '1rem', verticalAlign: 'middle', marginLeft: '4px'  }}
                    title={refreshing ? 'Refreshing…' : 'Next refresh'}
                >sync</span>
                <span className="text-small text-muted" style={{ verticalAlign: 'middle'}}>{countdown}s</span>
            </h1>

            <div className={styles.grid}>
                <MessagesCounter title="Messages Handled" refreshKey={refreshKey} />

                <div className="card">
                    <div className="card-header">APISIX Status</div> {/* Card title */}
                    <div className={styles.statusRow}>
                        <span className={`${styles.statusDot} ${statusDotClass}`} />
                        {controlStatus === 'checking' && 'Checking...'}
                        {controlStatus === 'online'   && 'Online'}
                        {controlStatus === 'offline'  && 'Offline'}
                    </div>
                    {connectionConfigFetch.data && (
                        <div className={styles.endpoint}>
                            {connectionConfigFetch.data.host}:{connectionConfigFetch.data.controlPort}
                        </div>
                    )}
                    <div className={styles.statsList}>
                        {/*
                        <div className={`${styles.statRow} ${prometheusHealthFetch.loading ? '' : prometheusUp ? 'text-success' : 'text-error'}`}>
                            <span>Prometheus</span>
                            <strong>
                                {prometheusHealthFetch.loading ? 'Checking' : prometheusUp ? 'Active' : 'Inactive'}
                            </strong>
                        </div>
                        */}
                        <div className={`${styles.statRow} ${lokiChecking ? '' : lokiHealthFetch.error ? 'text-error' : 'text-success'}`}>
                            <span>Loki</span>
                            <strong>
                                {lokiChecking ? 'Checking' : lokiHealthFetch.error ? 'Inactive' : 'Active'}
                            </strong>
                        </div>
                    </div>
                    {/*
                    {metricsFetch.data && (
                        <div className={styles.statsList}>
                            {metricsFetch.data.version && (
                                <div className={styles.statRow}><span>Version</span><strong>{metricsFetch.data.version}</strong></div>
                            )}
                            {metricsFetch.data.hostname && (
                                <div className={styles.statRow}><span>Hostname</span><strong>{metricsFetch.data.hostname}</strong></div>
                            )}
                            apisix_http_requests_total is nginx-level: it counts every request the
                            process handled, monitoring scrapes included, so it climbs even when the
                            gateway is proxying nothing. Labelled for what it is - the routed count
                            is the "Messages Handled" card.
                            <div className={styles.statRow}>
                                <span>HTTP requests <span className="text-muted">(incl. monitoring)</span></span>
                                <strong>{metricsFetch.data.totalRequests.toLocaleString()}</strong>
                            </div>
                            {Object.entries(metricsFetch.data.connections).map(([state, count]) => (
                                <div key={state} className={styles.statRow}>
                                    <span>Connections ({state})</span><strong>{count}</strong>
                                </div>
                            ))}
                        </div>
                    )}
                    */}
                    <Link to="/config" className={styles.cardLink}>Configure</Link>
                </div>

                <div className="card">
                    <div className="card-header">Live Routes</div> {/* Card title */}
                    {/* loading */}
                    {/* First load only - useFetch keeps the last rows through a refetch, so
                        checking loading alone flashed this above them every tick. */}
                    {liveRoutesFetch.loading && !liveRoutesFetch.data && <div className={`text-small text-muted ${styles.emptyHint}`}>Loading...</div>}
                    {/* Unavailable */}
                    {liveRoutesFetch.error && <div className={`text-small text-muted ${styles.emptyHint}`}>Unavailable</div>}
                    {Array.isArray(liveRoutesFetch.data) && liveRoutesFetch.data.length === 0 && (
                        <div>No routes loaded</div>
                    )}
                    {Array.isArray(liveRoutesFetch.data) && liveRoutesFetch.data.map(r => (
                        <div key={r.key} className={styles.statsList}>
                            <div className={styles.statRow}>
                                <span>
                                    <span className={`${styles.statusDot} ${r.value.status === 1 ? styles.statusDotOnline : styles.statusDotOffline}`} />
                                    <code>{r.value.uri}</code>
                                </span>
                                <span className="text-muted text-small">id: {r.value.id}</span>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="card">
                    <div className="card-header">Live Upstreams</div> {/* Card title */}
                    {liveUpstreamsFetch.loading && !liveUpstreamsFetch.data && <div className={`text-small text-muted ${styles.emptyHint}`}>Loading...</div>}
                    {liveUpstreamsFetch.error && <div className={`text-small text-muted ${styles.emptyHint}`}>Unavailable</div>}
                    {Array.isArray(liveUpstreamsFetch.data) && liveUpstreamsFetch.data.length === 0 && (
                        <div className={`text-small text-muted ${styles.emptyHint}`}>No upstreams loaded</div>
                    )}
                    {Array.isArray(liveUpstreamsFetch.data) && liveUpstreamsFetch.data.map(u => (
                        <div key={u.key} className={styles.statsList}>
                            <div className={styles.statRow}>
                                <strong>Upstream {u.value.id}</strong>
                                <span className="text-muted text-small">{u.value.type}</span>
                            </div>
                            {u.value.nodes?.map(n => (
                                <div key={`${n.host}:${n.port}`} className={styles.statRow}>
                                    <code className="text-small">{n.host}:{n.port}</code>
                                    <span className="text-muted text-small">weight: {n.weight}</span>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>

                <div className="card">
                    <div className="card-header">Live Services</div> {/* Card title */}
                    {liveServicesFetch.loading && !liveServicesFetch.data && <div className={`text-small text-muted ${styles.emptyHint}`}>Loading...</div>}
                    {liveServicesFetch.error && <div className={`text-small text-muted ${styles.emptyHint}`}>Unavailable</div>}
                    {Array.isArray(liveServicesFetch.data) && liveServicesFetch.data.length === 0 && (
                        <div className={`text-small text-muted ${styles.emptyHint}`}>No services loaded</div>
                    )}
                    {Array.isArray(liveServicesFetch.data) && liveServicesFetch.data.map(s => (
                        <div key={s.key} className={styles.statsList}>
                            <div className={styles.statRow}>
                                <strong>{s.value.name ?? `Service ${s.value.id}`}</strong>
                                <span className="text-muted text-small">id: {s.value.id}</span>
                            </div>
                            {s.value.desc && (
                                <div className={`text-small text-muted ${styles.statRow}`}>{s.value.desc}</div>
                            )}
                            {/* A service points at an upstream either by reference or inline - show whichever it uses. */}
                            {s.value.upstream_id != null && (
                                <div className={styles.statRow}>
                                    <span className="text-small">Upstream</span>
                                    <code className="text-small">{s.value.upstream_id}</code>
                                </div>
                            )}
                            {s.value.upstream?.nodes?.map(n => (
                                <div key={`${n.host}:${n.port}`} className={styles.statRow}>
                                    <code className="text-small">{n.host}:{n.port}</code>
                                    <span className="text-muted text-small">weight: {n.weight}</span>
                                </div>
                            ))}
                            {s.value.plugins && Object.keys(s.value.plugins).length > 0 && (
                                <div className={styles.tagList}>
                                    {Object.keys(s.value.plugins).map(p => (
                                        <span key={p} className={styles.tag}>{p}</span>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                {/*
                <div className={`card ${styles.fullWidthCard}`}>
                    <div className="card-header">HTTP Status Codes</div>
                    <RangeToggle value={barRangeLabel} onChange={setBarRangeLabel} />
                    <div className={`text-small text-muted ${styles.emptyHint}`}>{barSubtitle}</div>
                    <div className={styles.chartArea}>
                    {barChartData && (
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={barChartData.sorted} margin={{ top: 12, right: 24, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-dim)" />
                                <XAxis dataKey="code" tick={{ fontSize: 13, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
                                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} width={48} axisLine={false} tickLine={false} />
                                <Tooltip cursor={{ fill: 'var(--border-dim)' }} content={barTooltipContent} />
                                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                                    {barChartData.sorted.map(entry => (
                                        <Cell key={entry.code} fill={barChartData.colorMap[entry.code]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                    </div>
                </div>
                */}
                {/*
                <div className={`card ${styles.fullWidthCard}`}>
                    <div className="card-header">Status Codes per Route</div>
                    <RangeToggle value={routeTableRangeLabel} onChange={setRouteTableRangeLabel} />
                    <div className={`text-small text-muted ${styles.emptyHint}`}>{routeTableSubtitle}</div>
                    <div className={`${styles.chartArea} ${styles.chartAreaTable}`}>
                        {routeTableData && (
                            <table className={styles.routeTable}>
                                <thead>
                                    <tr>
                                        <th>Route</th>
                                        {routeTableData.codes.map(code => <th key={code}>HTTP {code}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {routeTableData.routes.map(route => (
                                        <tr key={route}>
                                            <td><code>{route}</code></td>
                                            {routeTableData.codes.map(code => {
                                                const count = routeTableData.routeMap[route][code] ?? 0;
                                                return (
                                                    <td key={code}>
                                                        {count > 0
                                                            ? <span className={styles.codeBadge} style={{ background: routeTableData.colorMap[code] }}>{count.toLocaleString()}</span>
                                                            : <span className={styles.chartAreaMessage}>—</span>}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
                */}
                {/*<PromLineChart*/}
                {/*    title="HTTP Status Codes"*/}
                {/*    queryTemplate="round(sum by (code) (increase(apisix_http_status[$RANGE])))"*/}
                {/*    seriesKey="code"*/}
                {/*    seriesDisplay={k => `HTTP ${k}`}*/}
                {/*    buildMaps={buildCodeMaps}*/}
                {/*    subtitle={r => `Via Prometheus: increase(apisix_http_status[${r.promRange}]) · ${r.label === 'All' ? 'all time' : `last ${r.label}`} · ${r.promRange} buckets`}*/}
                {/*    refreshKey={refreshKey}*/}
                {/*/>*/}
                {/*<PromLineChart*/}
                {/*    title="Requests by Route"*/}
                {/*    queryTemplate="round(sum by (route) (increase(apisix_http_status[$RANGE])))"*/}
                {/*    seriesKey="route"*/}
                {/*    subtitle={r => `Via Prometheus: increase(apisix_http_status[${r.promRange}]) grouped by route · ${r.label === 'All' ? 'all time' : `last ${r.label}`}`}*/}
                {/*    refreshKey={refreshKey}*/}
                {/*/>*/}
                {/* Two tables rather than one with a type filter: the gateway keeps its
                    access records and its error log in separate Loki streams, and the two
                    have almost no columns in common worth showing side by side. */}
                <LokiLogTable
                    title="Messages Log"
                    kind="audit"
                    defaultPageSize={25}
                    refreshKey={refreshKey}
                />
                {/*<LokiLogTable*/}
                {/*    title="Gateway Error Log"*/}
                {/*    kind="error"*/}
                {/*    defaultPageSize={25}*/}
                {/*    refreshKey={refreshKey}*/}
                {/*/>*/}
                {/*<PromLineChart*/}
                {/*    title="Avg Request Latency by Route (ms)"*/}
                {/*    queryTemplate={`round(sum by (route) (increase(apisix_http_latency_sum{type="request"}[$RANGE])) / clamp_min(sum by (route) (increase(apisix_http_latency_count{type="request"}[$RANGE])), 1))`}*/}
                {/*    seriesKey="route"*/}
                {/*    subtitle={r => `Via Prometheus: avg request latency per route · ${r.promRange} buckets`}*/}
                {/*    refreshKey={refreshKey}*/}
                {/*/>*/}
                {/*<PromLineChart*/}
                {/*    title="Egress Bandwidth by Route (bytes)"*/}
                {/*    queryTemplate={`round(sum by (route) (increase(apisix_bandwidth{type="egress"}[$RANGE])))`}*/}
                {/*    seriesKey="route"*/}
                {/*    subtitle={r => `Via Prometheus: increase(apisix_bandwidth{egress}) · ${r.promRange} buckets`}*/}
                {/*    refreshKey={refreshKey}*/}
                {/*/>*/}
            </div>
        </div>
    );
};