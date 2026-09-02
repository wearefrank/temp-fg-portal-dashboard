import { useCallback, useState } from 'react';
import { useFetch } from '../../hooks/useFetch';
import { LokiLogTable } from '../LokiLogTable/LokiLogTable';
import { MessagesCounter } from '../MessagesCounter/MessagesCounter';
import { RouteStatsTable } from '../RouteStatsTable/RouteStatsTable';
import type { RouteStats } from '../RouteStatsTable/RouteStatsTable';
import type { TimeRange } from '../TimeRangePicker/timeRange';
import { ApisixStatusCard } from './ApisixStatusCard';
import { LiveCard } from './LiveCard';
import { LiveRouteItem } from './LiveRouteItem';
import { LiveServiceItem } from './LiveServiceItem';
import { LiveUpstreamItem } from './LiveUpstreamItem';
import { RefreshIndicator } from './RefreshIndicator';
import { useControlStatus } from './useControlStatus';
import { useDashboardRefresh } from './useDashboardRefresh';
import type { ConnectionConfig, LiveRoute, LiveService, LiveUpstream } from './dashboardTypes';
import styles from './Dashboard.module.css';

export const Dashboard = () => {
    const refreshKey = useDashboardRefresh();

    const configFetch = useFetch<ConnectionConfig>('/config', refreshKey);
    const routesFetch = useFetch<LiveRoute[]>('/metrics/routes', refreshKey);
    const upstreamsFetch = useFetch<LiveUpstream[]>('/metrics/upstreams', refreshKey);
    const servicesFetch = useFetch<LiveService[]>('/metrics/services', refreshKey);
    const lokiHealthFetch = useFetch<unknown[]>('/logs/recent?limit=1&startTime=0', refreshKey);

    const controlStatus = useControlStatus(configFetch.data != null);

    const [selectedRoute, setSelectedRoute] = useState<RouteStats | null>(null);

    // used for applying the table range to log range
    const [logRange, setLogRange] = useState<TimeRange | null>(null);
    const applyRangeToLogs = useCallback((range: TimeRange) => setLogRange({ ...range }), []);

    const refreshing = configFetch.loading || routesFetch.loading || upstreamsFetch.loading
        || servicesFetch.loading || lokiHealthFetch.loading;

    return (
        <div className="container">
            <h1>
                Dashboard
                <RefreshIndicator refreshing={refreshing} refreshKey={refreshKey} />
            </h1>

            <div className={styles.grid}>
                <MessagesCounter title="Messages Handled" refreshKey={refreshKey} />

                <ApisixStatusCard
                    status={controlStatus}
                    config={configFetch.data}
                    lokiChecking={lokiHealthFetch.loading && lokiHealthFetch.data == null && !lokiHealthFetch.error}
                    lokiFailed={lokiHealthFetch.error != null}
                />

                <LiveCard
                    title="Live Routes"
                    state={routesFetch}
                    emptyText="No routes loaded"
                    renderItem={route => <LiveRouteItem key={route.key} route={route} />}
                />

                <LiveCard
                    title="Live Upstreams"
                    state={upstreamsFetch}
                    emptyText="No upstreams loaded"
                    renderItem={upstream => <LiveUpstreamItem key={upstream.key} upstream={upstream} />}
                />

                <LiveCard
                    title="Live Services"
                    state={servicesFetch}
                    emptyText="No services loaded"
                    renderItem={service => <LiveServiceItem key={service.key} service={service} />}
                />

                <RouteStatsTable
                    title="Traffic per Route"
                    selectedRoute={selectedRoute}
                    onSelectRoute={setSelectedRoute}
                    appliedLogRange={logRange}
                    onApplyRangeToLogs={applyRangeToLogs}
                    refreshKey={refreshKey}
                />

                <LokiLogTable
                    title="Messages Log"
                    kind="audit"
                    defaultPageSize={25}
                    search={selectedRoute?.routeId || ''}
                    range={logRange ?? undefined}
                    refreshKey={refreshKey}
                />
            </div>
        </div>
    );
};
