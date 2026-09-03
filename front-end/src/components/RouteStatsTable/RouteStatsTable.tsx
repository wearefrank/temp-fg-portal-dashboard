import { memo, useEffect, useState } from 'react';
import { usePersistedState } from '../../hooks/usePersistedState';
import { TimeRangePicker } from '../TimeRangePicker/TimeRangePicker';
import type { TimeRange } from '../TimeRangePicker/timeRange';
import { applyToLogsState, sameFilter } from './applyToLogs';
import { RouteTrafficChart } from './RouteTrafficChart';
import { RouteStatsRow } from './RouteStatsRow';
import { SelectionChip } from './SelectionChip';
import { SortableHeader } from './SortableHeader';
import { SyncToggle } from './SyncToggle';
import { TrafficViewToggle } from './TrafficViewToggle';
import { routeStatsSubtitle } from './routeStatsSubtitle';
import { useRouteStats } from './useRouteStats';
import { NO_ROUTE_LABEL } from './routeStatsFormat';
import type { View } from './trafficChartData';
import type { LogFilter, RouteStats } from './types';
import styles from './RouteStatsTable.module.css';

export type { LogFilter, RouteSeries, RouteStats, RouteStatsResult } from './types';

const COLUMN_COUNT = 8;
const SKELETON_ROWS = 4;
const SYNC_STORAGE_KEY = 'routeStats:synced';

interface RouteStatsTableProps {
    title: string;
    selectedRoute: RouteStats | null;
    onSelectRoute: (route: RouteStats | null) => void;
    appliedLogFilter: LogFilter | null;
    onApplyRangeToLogs: (range: TimeRange, route: RouteStats | null) => void;
    refreshKey: number;
}

/**
 * Traffic per route, out of the gateway's access log
 */
const RouteStatsPanel = ({
    title,
    selectedRoute,
    onSelectRoute,
    appliedLogFilter,
    onApplyRangeToLogs,
    refreshKey,
}: RouteStatsTableProps) => {


    const stats = useRouteStats(refreshKey);
    const [view, setView] = useState<View>('status');

    const [synced, setSynced] = usePersistedState(SYNC_STORAGE_KEY, false);

    // What a click would push down - compared against what is already applied.
    const currentFilter: LogFilter = { range: stats.range, route: selectedRoute };
    const applyToLogs = applyToLogsState(currentFilter, appliedLogFilter, synced);

    // While synced, any window or route change pushes itself down. The guard stops the loop:
    // every push hands back a new filter object, equal to this one but not identical.
    useEffect(() => {
        if (!synced) return;
        if (sameFilter({ range: stats.range, route: selectedRoute }, appliedLogFilter)) return;
        onApplyRangeToLogs(stats.range, selectedRoute);
    }, [synced, stats.range, selectedRoute, appliedLogFilter, onApplyRangeToLogs]);

    // Clicking the row that is already picked clears it, so the table is its own way back.
    const pickRoute = (route: RouteStats) => {
        onSelectRoute(selectedRoute?.routeId === route.routeId ? null : route);
    };

    const subtitle = routeStatsSubtitle({
        loading: stats.loading,
        error: stats.error,
        routesUnavailable: stats.result?.routesUnavailable ?? false,
        range: stats.range,
        view,
        drilling: selectedRoute !== null,
    });

    return (
        <div className={`card ${styles.fullWidthCard}`}>
            <div className={styles.headerRow}>
                <div className="card-header">{title}</div>
                <div className={styles.headerControls}>
                    <SyncToggle checked={synced} onChange={setSynced} />
                    <button
                        type="button"
                        className={styles.applyToLogsBtn}
                        onClick={() => onApplyRangeToLogs(currentFilter.range, currentFilter.route)}
                        disabled={applyToLogs.disabled}
                        title={applyToLogs.title}
                    >
                        {applyToLogs.label}
                    </button>
                    {stats.canZoomOut && (
                        <button
                            type="button"
                            className={styles.zoomOutBtn}
                            onClick={stats.zoomOut}
                            title="Back to the full window"
                        >
                            ↩ Zoom out
                        </button>
                    )}
                    <TimeRangePicker value={stats.range} onChange={stats.pickRange} />
                </div>
            </div>
            <div className={`text-small text-muted ${styles.subtitle}`}>{subtitle}</div>

            {selectedRoute && (
                <SelectionChip route={selectedRoute} onClear={() => onSelectRoute(null)} />
            )}

            <TrafficViewToggle value={view} onChange={setView} disabled={selectedRoute !== null} />

            {stats.loading && <ChartSkeleton />}

            {stats.result && (
                <RouteTrafficChart
                    result={stats.result}
                    range={stats.range}
                    view={view}
                    selectedRoute={selectedRoute?.routeId ?? null}
                    onZoom={stats.zoomTo}
                    onDragChange={stats.setDragging}
                />
            )}

            <div className={styles.tableArea}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <SortableHeader sortKey="route" label="Route" sort={stats.sort} onSort={stats.toggleSort} />
                            <SortableHeader sortKey="live" label="Live" sort={stats.sort} onSort={stats.toggleSort} />
                            <SortableHeader sortKey="total" label="Total" sort={stats.sort} onSort={stats.toggleSort} align="right" />
                            <SortableHeader sortKey="success" label="2xx" sort={stats.sort} onSort={stats.toggleSort} align="right" />
                            <SortableHeader sortKey="clientError" label="4xx" sort={stats.sort} onSort={stats.toggleSort} align="right" />
                            <SortableHeader sortKey="serverError" label="5xx" sort={stats.sort} onSort={stats.toggleSort} align="right" />
                            <SortableHeader sortKey="errorRatePercent" label="Errors" sort={stats.sort} onSort={stats.toggleSort} align="right" />
                            <th
                                className={styles.right}
                                title="Mean upstream response time, over the requests that reached an upstream"
                            >
                                Avg latency
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {stats.loading && <SkeletonRows />}

                        {!stats.loading && stats.rows.map(route => (
                            <RouteStatsRow
                                key={route.routeId || NO_ROUTE_LABEL}
                                route={route}
                                picked={selectedRoute?.routeId === route.routeId}
                                onPick={() => pickRoute(route)}
                            />
                        ))}

                        {!stats.loading && stats.rows.length === 0 && (
                            <tr>
                                <td colSpan={COLUMN_COUNT} className={`text-small text-muted ${styles.empty}`}>
                                    {stats.error ? 'Unavailable' : 'No routes and no traffic in this window'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// The dashboard re-renders as each of its own cards loads. Rebuilding the recharts tree for
// that is the expensive part of the page, and none of this panel's props move with it.
export const RouteStatsTable = memo(RouteStatsPanel);

/** Holds the chart's height and says the window is being counted, rather than going blank. */
const ChartSkeleton = () => (
    <div className={styles.chartArea}>
        <div className={styles.chartSkeleton} role="status" aria-label="Loading traffic">
            <span className="text-small text-muted">Counting…</span>
        </div>
    </div>
);

const SkeletonRows = () => (
    <>
        {Array.from({ length: SKELETON_ROWS }, (_, rowIndex) => (
            <tr key={`skeleton-${rowIndex}`}>
                {Array.from({ length: COLUMN_COUNT }, (_, cellIndex) => (
                    <td key={cellIndex}><span className={styles.skeletonCell} /></td>
                ))}
            </tr>
        ))}
    </>
);
