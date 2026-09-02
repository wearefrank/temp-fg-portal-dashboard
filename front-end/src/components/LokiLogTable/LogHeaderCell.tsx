import { flexRender } from '@tanstack/react-table';
import type { LogTableHeader } from './tableTypes';
import styles from './LokiLogTable.module.css';

interface LogHeaderCellProps {
    header: LogTableHeader;
    /** Pins the snapshot before the sort changes, so rows do not shift under the reader. */
    onSort: () => void;
}

export const LogHeaderCell = ({ header, onSort }: LogHeaderCellProps) => (
    <th className={header.column.columnDef.meta?.align === 'right' ? styles.numeric : undefined}>
        <HeaderLabel header={header} onSort={onSort} />
    </th>
);

const HeaderLabel = ({ header, onSort }: LogHeaderCellProps) => {
    if (header.isPlaceholder) return null;

    const { column } = header;
    const label = flexRender(column.columnDef.header, header.getContext());
    if (!column.getCanSort()) return <>{label}</>;

    return (
        <button
            type="button"
            className={styles.sortHeader}
            onClick={() => {
                onSort();
                column.toggleSorting();
            }}
            title={column.id === 'timestamp'
                ? 'Sort by time (resolved by Loki)'
                : 'Sort the whole window by this column'}
        >
            {label}
            <span className={styles.sortIndicator}>{sortArrow(column.getIsSorted())}</span>
        </button>
    );
};

function sortArrow(sorted: false | 'asc' | 'desc'): string {
    if (sorted === 'desc') return '↓';
    if (sorted === 'asc') return '↑';
    return '↕';
}
