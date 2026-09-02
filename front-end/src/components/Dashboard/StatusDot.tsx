import type { ConnectionStatus } from './dashboardTypes';
import styles from './Dashboard.module.css';

const DOT_CLASS: Record<ConnectionStatus, string> = {
    online: styles.statusDotOnline,
    offline: styles.statusDotOffline,
    checking: styles.statusDotChecking,
};

export const StatusDot = ({ status }: { status: ConnectionStatus }) => (
    <span className={`${styles.statusDot} ${DOT_CLASS[status]}`} />
);
