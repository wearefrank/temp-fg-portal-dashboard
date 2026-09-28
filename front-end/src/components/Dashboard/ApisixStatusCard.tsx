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
    /** LOKI_ENABLED on the backend; off means the log panels are not on the page at all. */
    lokiEnabled: boolean;
    /** First load; a refresh keeps the verdict Loki last gave. */
    lokiChecking: boolean;
    lokiFailed: boolean;
}

export const ApisixStatusCard = ({
    status,
    config,
    lokiEnabled,
    lokiChecking,
    lokiFailed,
}: ApisixStatusCardProps) => {
    const loki = lokiState(lokiEnabled, lokiChecking, lokiFailed);

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

interface LokiState {
    text: string;
    tone: string;
}

function lokiState(enabled: boolean, checking: boolean, failed: boolean): LokiState {
    if (!enabled) return { text: 'Disabled', tone: '' };
    if (checking) return { text: 'Checking', tone: '' };
    if (failed) return { text: 'Inactive', tone: 'text-error' };
    return { text: 'Active', tone: 'text-success' };
}
