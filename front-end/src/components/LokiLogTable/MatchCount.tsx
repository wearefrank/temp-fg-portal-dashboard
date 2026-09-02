import styles from './LokiLogTable.module.css';

interface MatchCountProps {
    count: number;
    firstLoad: boolean;
    failed: boolean;
    hasData: boolean;
}

/** How many lines the window holds - the server's count, not the rows on screen. */
export const MatchCount = ({ count, firstLoad, failed, hasData }: MatchCountProps) => {
    if (firstLoad) return <div className={styles.count}>Counting…</div>;
    if (failed) return <div className={styles.count}>Count unavailable</div>;
    if (!hasData) return <div className={styles.count} />;

    return (
        <div className={styles.count}>
            <span className={styles.countValue}>{count.toLocaleString()}</span> matching
        </div>
    );
};
