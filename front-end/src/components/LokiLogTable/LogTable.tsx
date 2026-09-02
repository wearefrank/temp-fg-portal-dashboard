import { LogHeaderCell } from './LogHeaderCell';
import { LogRow } from './LogRow';
import type { LogTableInstance } from './tableTypes';
import styles from './LokiLogTable.module.css';

// Shimmer rows shown while the first page loads, so the card does not jump when they land.
const SKELETON_ROWS = 8;

interface LogTableProps {
    table: LogTableInstance;
    showSkeleton: boolean;
    /** Pins the snapshot before a header changes the sort. */
    onSort: () => void;
}

export const LogTable = ({ table, showSkeleton, onSort }: LogTableProps) => {
    const columnCount = table.getVisibleLeafColumns().length;

    return (
        <table className={styles.logTable}>
            <thead>
                {table.getHeaderGroups().map(headerGroup => (
                    <tr key={headerGroup.id}>
                        {headerGroup.headers.map(header => (
                            <LogHeaderCell key={header.id} header={header} onSort={onSort} />
                        ))}
                    </tr>
                ))}
            </thead>
            <tbody>
                {showSkeleton && <SkeletonRows columnCount={columnCount} />}
                {table.getRowModel().rows.map(row => (
                    <LogRow key={row.id} row={row} columnCount={columnCount} />
                ))}
            </tbody>
        </table>
    );
};

const SkeletonRows = ({ columnCount }: { columnCount: number }) => (
    <>
        {Array.from({ length: SKELETON_ROWS }, (_, rowIndex) => (
            <tr key={`skeleton-${rowIndex}`}>
                {Array.from({ length: columnCount }, (_, cellIndex) => (
                    <td key={cellIndex}><span className={styles.skeletonCell} /></td>
                ))}
            </tr>
        ))}
    </>
);
