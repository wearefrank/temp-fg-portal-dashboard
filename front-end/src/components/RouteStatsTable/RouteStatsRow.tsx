import { RouteLiveDot } from './RouteLiveDot';
import { DASH, NO_ROUTE_LABEL, breakdown, ratePercent } from './routeStatsFormat';
import type { RouteStats } from './types';
import styles from './RouteStatsTable.module.css';

interface RouteStatsRowProps {
    route: RouteStats;
    picked: boolean;
    onPick: () => void;
}

export const RouteStatsRow = ({ route, picked, onPick }: RouteStatsRowProps) => (
    <tr
        className={`${styles.pickable} ${picked ? styles.pickedRow : ''}`}
        onClick={onPick}
        title={picked
            ? 'Show all routes again'
            : 'Break this route down by status code, and filter the log to it'}
    >
        <td><RouteName route={route} /></td>
        <td><RouteLiveDot live={route.live} /></td>
        <td className={styles.right} title={breakdown(route.byStatus) || undefined}>
            {route.total.toLocaleString()}
        </td>
        <CountCell value={route.success} className="text-success" tooltip={breakdown(route.byStatus, '2')} />
        <CountCell value={route.clientError} className={styles.clientError} tooltip={breakdown(route.byStatus, '4')} />
        <CountCell value={route.serverError} className="text-error" tooltip={breakdown(route.byStatus, '5')} />
        <td className={styles.right}>
            <span className={route.serverError > 0 ? 'text-error' : 'text-muted'}>
                {ratePercent(route.errorRatePercent, route.serverError)}
            </span>
        </td>
        <LatencyCell value={route.avgLatencyMs} />
    </tr>
);

const RouteName = ({ route }: { route: RouteStats }) => (
    <>
        {route.routeId === ''
            ? <span className="text-muted" title="Requests that matched no route">{NO_ROUTE_LABEL}</span>
            : <code>{route.routeName ?? route.routeId}</code>}
        {route.uri && <span className={`text-muted text-small ${styles.uri}`}>{route.uri}</span>}
        {!route.configured && route.routeId !== '' && (
            <span
                className={`text-muted text-small ${styles.uri}`}
                title="Traffic for a route that is not in the running config"
            >
                not configured
            </span>
        )}
    </>
);

/** A count, coloured when it is not zero - a column of zeroes should stay quiet. */
const CountCell = ({
    value,
    className,
    tooltip,
}: { value: number; className: string; tooltip: string }) => (
    <td className={styles.right}>
        {value > 0
            ? <span className={className} title={tooltip || undefined}>{value.toLocaleString()}</span>
            : <span className="text-muted">{DASH}</span>}
    </td>
);

const LatencyCell = ({ value }: { value: number | null }) => {
    if (value != null) return <td className={styles.right}>{value.toLocaleString()} ms</td>;
    return (
        <td className={styles.right}>
            <span className="text-muted" title="Nothing in this window reached an upstream">{DASH}</span>
        </td>
    );
};
