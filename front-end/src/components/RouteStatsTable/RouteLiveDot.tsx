import styles from './RouteStatsTable.module.css';

/** null is unknown - either not in the config, or the control API was unreachable. */
interface RouteLiveDotProps {
    live: boolean | null;
}

export const RouteLiveDot = ({ live }: RouteLiveDotProps) => {
    const { className, title } = liveState(live);
    return <span className={`${styles.statusDot} ${className}`} title={title} />;
};

function liveState(live: boolean | null): { className: string; title: string } {
    if (live === true) return { className: styles.statusDotOnline, title: 'Enabled in APISIX' };
    if (live === false) return { className: styles.statusDotOffline, title: 'Disabled in APISIX' };
    return { className: styles.statusDotUnknown, title: 'Unknown — not in the running config' };
}
