import type { Sort, SortKey } from './routeStatsSort';
import styles from './RouteStatsTable.module.css';

interface SortableHeaderProps {
    sortKey: SortKey;
    label: string;
    sort: Sort;
    onSort: (key: SortKey) => void;
    align?: 'right';
}

export const SortableHeader = ({
    sortKey,
    label,
    sort,
    onSort,
    align,
}: SortableHeaderProps) => (
    <th
        className={`${align === 'right' ? styles.right : ''} ${styles.sortable}`}
        onClick={() => onSort(sortKey)}
        title={`Sort by ${label}`}
    >
        {label}
        <span className={styles.sortMark}>{sortMark(sort, sortKey)}</span>
    </th>
);

function sortMark(sort: Sort, key: SortKey): string {
    if (sort.key !== key) return '';
    return sort.desc ? '▾' : '▴';
}
