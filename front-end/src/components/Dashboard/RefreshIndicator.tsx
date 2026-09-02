import { useRefreshCountdown } from './useDashboardRefresh';
import styles from './Dashboard.module.css';

interface RefreshIndicatorProps {
    refreshing: boolean;
    /** Restarts the countdown - the tick itself is owned here, not by the dashboard. */
    refreshKey: number;
}

/** The page's single "refreshing now" signal, so no panel has to blank itself to say so. */
export const RefreshIndicator = ({ refreshing, refreshKey }: RefreshIndicatorProps) => {
    const countdown = useRefreshCountdown(refreshKey);

    return (
        <>
            <span
                className={`material-icons text-muted ${styles.syncIcon} ${refreshing ? styles.syncSpinning : ''}`}
                title={refreshing ? 'Refreshing…' : 'Next refresh'}
            >
                sync
            </span>
            <span className={`text-small text-muted ${styles.countdown}`}>{countdown}s</span>
        </>
    );
};
