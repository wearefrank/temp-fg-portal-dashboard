import { flexRender } from '@tanstack/react-table';
import type { LogTableRow } from './tableTypes';
import styles from './LokiLogTable.module.css';

interface LogRowProps {
    row: LogTableRow;
    /** Column span for the expanded raw line underneath. */
    columnCount: number;
}

/** One log line, with the raw record folded out underneath when it is expanded. */
export const LogRow = ({ row, columnCount }: LogRowProps) => (
    <>
        <tr className={styles.clickableRow} onClick={() => row.toggleExpanded()}>
            {row.getVisibleCells().map(cell => (
                <td
                    key={cell.id}
                    className={cell.column.columnDef.meta?.align === 'right' ? styles.numeric : undefined}
                >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
            ))}
        </tr>
        {row.getIsExpanded() && <RawLine raw={row.original.raw} columnCount={columnCount} />}
    </>
);

const RawLine = ({ raw, columnCount }: { raw: string; columnCount: number }) => (
    <tr className={styles.rawRow}>
        <td className={styles.rawCell} colSpan={columnCount}>
            {formatRaw(raw)}
            <div>
                <button
                    className={styles.copyButton}
                    type="button"
                    onClick={event => {
                        event.stopPropagation();
                        navigator.clipboard?.writeText(raw);
                    }}
                >
                    Copy raw line
                </button>
            </div>
        </td>
    </tr>
);

/** Pretty-prints the plugin's JSON; a line that is not JSON is shown as it arrived. */
function formatRaw(raw: string): string {
    try {
        return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
        return raw;
    }
}
