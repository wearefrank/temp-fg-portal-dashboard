import { StatusDot } from './StatusDot';
import type { ConnectionConfig, ConnectionStatus } from './dashboardTypes';
import styles from './Dashboard.module.css';

const STATUS_TEXT: Record<ConnectionStatus, string> = {
    checking: 'Checking...',
    online: 'Online',
    offline: 'Offline',
};

interface ApisixStatusCardProps {
    status: ConnectionStatus;
    config: ConnectionConfig | null;
    /** First load; a refresh keeps the verdict Loki last gave. */
    lokiChecking: boolean;
    lokiFailed: boolean;
}

export const ApisixStatusCard = ({
    status,
    config,
    lokiChecking,
    lokiFailed,
}: ApisixStatusCardProps) => {
    const loki = lokiState(lokiChecking, lokiFailed);

    return (
        <div className="card">
            <div className="card-header">APISIX Status</div>
            <div className={styles.statusRow}>
                <StatusDot status={status} />
                {STATUS_TEXT[status]}
            </div>
            {config && (
                <div className={styles.endpoint}>{config.host}:{config.controlPort}</div>
            )}
            <div className={styles.statsList}>
                <div className={`${styles.statRow} ${loki.tone}`}>
                    <span>Loki</span>
                    <strong>{loki.text}</strong>
                </div>
            </div>
        </div>
    );
};

function lokiState(checking: boolean, failed: boolean): { text: string; tone: string } {
    if (checking) return { text: 'Checking', tone: '' };
    if (failed) return { text: 'Inactive', tone: 'text-error' };
    return { text: 'Active', tone: 'text-success' };
}
