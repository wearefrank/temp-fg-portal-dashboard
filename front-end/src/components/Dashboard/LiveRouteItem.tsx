import { StatusDot } from './StatusDot';
import type { LiveRoute } from './dashboardTypes';
import styles from './Dashboard.module.css';

export const LiveRouteItem = ({ route }: { route: LiveRoute }) => (
    <div className={styles.statsList}>
        <div className={styles.statRow}>
            <span>
                {/* APISIX reports an enabled route as status 1. */}
                <StatusDot status={route.value.status === 1 ? 'online' : 'offline'} />
                <code>{route.value.uri}</code>
            </span>
            <span className="text-muted text-small">id: {route.value.id}</span>
        </div>
    </div>
);
