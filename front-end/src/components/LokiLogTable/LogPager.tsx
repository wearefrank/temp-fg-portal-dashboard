import { type ReactNode } from 'react';
import { GAP, pageItems } from './pageItems';
import styles from './LokiLogTable.module.css';

interface LogPagerProps {
    currentPage: number;
    pageCount: number;
    pageSize: number;
    busy: boolean;
    onGoTo: (page: number) => void;
    /** Loki caps a query at 5000 entries, so paging can stop short of the window. */
    depthCapped: boolean;
    sortedByTime: boolean;
    /** NewLinesBadge, when the table has stopped following the log. */
    badge?: ReactNode;
}

export const LogPager = ({
    currentPage,
    pageCount,
    pageSize,
    busy,
    onGoTo,
    depthCapped,
    sortedByTime,
    badge,
}: LogPagerProps) => (
    <nav className={styles.pager} aria-label="Log pages">
        <button
            className={styles.pageBtn}
            type="button"
            onClick={() => onGoTo(currentPage - 1)}
            disabled={currentPage === 1 || busy}
            aria-label="Previous page"
        >
            ‹
        </button>

        {pageItems(currentPage, pageCount).map((item, index) => {
            if (item === GAP) return <span key={`gap-${index}`} className={styles.pageGap}>{GAP}</span>;
            return (
                <button
                    key={item}
                    type="button"
                    className={`${styles.pageBtn} ${item === currentPage ? styles.pageBtnActive : ''}`}
                    onClick={() => onGoTo(item)}
                    disabled={busy}
                    aria-current={item === currentPage ? 'page' : undefined}
                >
                    {item}
                </button>
            );
        })}

        <button
            className={styles.pageBtn}
            type="button"
            onClick={() => onGoTo(currentPage + 1)}
            disabled={currentPage === pageCount || busy}
            aria-label="Next page"
        >
            ›
        </button>

        {badge}

        {depthCapped && (
            <span className={styles.pagerNote}>{depthNote(sortedByTime, pageCount * pageSize)}</span>
        )}
    </nav>
);

/**
 * Said differently under a column sort: the ordering only covers the lines paging can reach,
 * so the highest status in the window may sit below the cut and never appear.
 */
function depthNote(sortedByTime: boolean, reach: number): string {
    const lines = reach.toLocaleString();
    if (sortedByTime) return `paging reaches the newest ${lines} — narrow the range or search to see older lines`;
    return `sorted over the newest ${lines} — narrow the range or search to sort them all`;
}
