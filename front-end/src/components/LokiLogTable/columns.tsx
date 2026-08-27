import { createColumnHelper } from '@tanstack/react-table';
import type { LogEntry, LogKind } from './types';
import type { logTableFeatures } from './features';
import styles from './LokiLogTable.module.css';

const formatTime = (iso: string): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
};

const dash = <span className={styles.muted}>—</span>;

// nginx's levels, worst first. Anything above warn is coloured; info and debug are the
// normal case and would only add noise as a badge.
const levelClass = (level: string): string | undefined => {
    if (/^(EMERG|ALERT|CRIT|ERROR)$/.test(level)) return styles.levelError;
    if (level === 'WARN') return styles.levelWarn;
    return undefined;
};

const columnHelper = createColumnHelper<typeof logTableFeatures, LogEntry>();

/**
 * Column definitions - the union of what both kinds of line carry.
 *
 * One set rather than one per kind because the two overlap heavily: an access record and an
 * error line both name a method, a path, a host, a caller and an upstream. What differs is
 * which of them are worth showing, and that is column visibility rather than a second table
 * - see DEFAULT_HIDDEN_COLUMNS below.
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
        // Next to Time because it is provenance rather than content: with the console pinned
        // to several namespaces the rows arrive merged, and this is the only thing telling
        // them apart. Pinned to one it reads the same all the way down - hide it from the
        // visibility menu.
        columnHelper.accessor('namespace', {
            header: 'Namespace',
            cell: info => <span className={styles.muted}>{info.getValue() ?? '—'}</span>,
            meta: { label: 'Namespace' },
        }),
        columnHelper.accessor('level', {
            header: 'Level',
            cell: info => {
                const level = info.getValue();
                if (level == null) return dash;
                const severity = levelClass(level);
                return severity
                    ? <span className={`${styles.levelBadge} ${severity}`}>{level}</span>
                    : <span className={styles.muted}>{level}</span>;
            },
            meta: { label: 'Level' },
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
            cell: info => {
                const path = info.getValue();
                // No raw fallback any more: a line that parses as neither shape now keeps
                // its text in message, so an empty path here really means the line had none.
                return path == null ? dash : <span className={styles.pathCell}><code>{path}</code></span>;
            },
            meta: { label: 'Path' },
        }),
        columnHelper.accessor('module', {
            header: 'Module',
            cell: info => <span className={styles.muted}>{info.getValue() ?? '—'}</span>,
            meta: { label: 'Module' },
        }),
        columnHelper.accessor('message', {
            header: 'Message',
            // The widest column, and the one the error table is really for. Clipped rather
            // than wrapped so a Lua traceback cannot make one row as tall as the panel -
            // expanding the row shows it in full.
            cell: info => {
                const message = info.getValue();
                return message == null ? dash : <span className={styles.messageCell}>{message}</span>;
            },
            meta: { label: 'Message' },
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
            header: 'Client',
            cell: info => <span className={styles.muted}>{info.getValue() ?? '—'}</span>,
            meta: { label: 'Client' },
        }),
        columnHelper.accessor('upstream', {
            header: 'Upstream',
            cell: info => <span className={styles.muted}>{info.getValue() ?? '—'}</span>,
            meta: { label: 'Upstream' },
        }),
        columnHelper.accessor('requestId', {
            header: 'Request ID',
            cell: info => {
                const id = info.getValue();
                return id == null ? dash : <code className={styles.muted}>{id}</code>;
            },
            meta: { label: 'Request ID' },
        }),
        columnHelper.accessor('gemeenteCode', {
            header: 'Gemeente',
            cell: info => <span className={styles.muted}>{info.getValue() ?? '—'}</span>,
            meta: { label: 'Gemeente' },
        }),
    ]);

/**
 * Columns hidden on first load, per kind.
 *
 * Mostly this is the other kind's columns, which would be a row of dashes - but not only:
 * Host, Upstream and Gemeente are filled on an access record and still start hidden,
 * because fifteen columns is more than fits and those are the ones you go looking for
 * rather than scan. The visibility menu brings any of them back.
 *
 * Level is hidden on the audit table because the plugin writes a constant "INFO" there.
 */
export const DEFAULT_HIDDEN_COLUMNS: Record<LogKind, Record<string, boolean>> = {
    audit: {
        level: false, module: false, message: false, requestId: false,
        host: false, source: false, upstream: false, gemeenteCode: false,
    },
    error: {
        route: false, method: false, status: false, latencyMs: false,
        host: false, source: false, upstream: false, gemeenteCode: false,
    },
};
