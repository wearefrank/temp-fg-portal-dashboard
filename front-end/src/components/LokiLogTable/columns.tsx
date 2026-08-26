import { createColumnHelper } from '@tanstack/react-table';
import type { LogEntry } from './types';
import type { logTableFeatures } from './features';
import styles from './LokiLogTable.module.css';

const formatTime = (iso: string): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
};

const dash = <span className={styles.muted}>—</span>;

const columnHelper = createColumnHelper<typeof logTableFeatures, LogEntry>();

/**
 * Column definitions.
 *
 * Built from a factory rather than declared as a constant because the status cell needs the
 * palette, and that is derived from whichever codes are on the page being rendered - data,
 * not configuration.
 *
 * `meta.label` is the human name for the column-visibility menu, which otherwise has only
 * the column id to show. `meta.align` moves numeric alignment onto the cell itself instead
 * of every cell wrapping its own span.
 *
 * Only Time is sortable, and its sort is Loki's `direction` rather than a local reorder.
 */
export const buildColumns = (colorMap: Record<string, string>) =>
    // columnHelper.columns() rather than a plain array: it preserves each column's own
    // value type through a variadic tuple. A bare array widens them to a union that the
    // table's `columns` option (typed at TValue = unknown) then rejects.
    columnHelper.columns([
        columnHelper.display({
            id: 'expander',
            header: () => null,
            cell: ({ row }) => (
                <span className={styles.expandCell}>{row.getIsExpanded() ? '▾' : '▸'}</span>
            ),
            meta: { label: 'Expand' },
        }),
        columnHelper.accessor('timestamp', {
            header: 'Time',
            // The one sortable column. Ordering by anything else would mean reordering the
            // whole log, and Loki only offers time order.
            enableSorting: true,
            cell: info => <span className={styles.muted}>{formatTime(info.getValue())}</span>,
            meta: { label: 'Time' },
        }),
        // Falls back to the id because a route without a name still has one, and an unnamed
        // route is more useful identified than blank.
        columnHelper.accessor(row => row.routeName ?? row.routeId, {
            id: 'route',
            header: 'Route',
            cell: info => info.getValue() ?? dash,
            meta: { label: 'Route' },
        }),
        columnHelper.accessor('method', {
            header: 'Method',
            cell: info => info.getValue() ?? dash,
            meta: { label: 'Method' },
        }),
        columnHelper.accessor('path', {
            header: 'Path',
            cell: ({ row, getValue }) => (
                // A line that never parsed has no path; showing its raw text keeps the row
                // meaningful instead of rendering an empty cell.
                <span className={styles.pathCell}><code>{getValue() ?? row.original.raw}</code></span>
            ),
            meta: { label: 'Path' },
        }),
        columnHelper.accessor('status', {
            header: 'Status',
            cell: info => {
                const status = info.getValue();
                if (status == null) return dash;
                return (
                    <span className={styles.statusBadge} style={{ background: colorMap[String(status)] }}>
                        {status}
                    </span>
                );
            },
            meta: { label: 'Status' },
        }),
        columnHelper.accessor('latencyMs', {
            header: 'Latency',
            cell: info => {
                const ms = info.getValue();
                return ms == null ? dash : `${ms.toFixed(0)} ms`;
            },
            meta: { align: 'right', label: 'Latency' },
        }),
        columnHelper.accessor('host', {
            header: 'Host',
            cell: info => <span className={styles.muted}>{info.getValue() ?? '—'}</span>,
            meta: { label: 'Host' },
        }),
        columnHelper.accessor('source', {
            header: 'Source',
            cell: info => <span className={styles.muted}>{info.getValue() ?? '—'}</span>,
            meta: { label: 'Source' },
        }),
        columnHelper.accessor('upstream', {
            header: 'Upstream',
            cell: info => <span className={styles.muted}>{info.getValue() ?? '—'}</span>,
            meta: { label: 'Upstream' },
        }),
    ]);

/**
 * Columns hidden on first load. Ten columns is more than fits comfortably, and these are the
 * ones you go looking for rather than scan - the visibility menu brings them back.
 */
export const DEFAULT_HIDDEN_COLUMNS = { host: false, source: false, upstream: false };
