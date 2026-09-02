import type { ReactNode } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { textOn } from '../chart/palette';
import type { LogEntry, LogFieldDescriptor, LogFieldType } from './types';
import type { logTableFeatures } from './features';
import styles from './LokiLogTable.module.css';

// withDate is set for windows that can cross midnight, where a time of day does not say
// which day the line is from.
const formatTime = (iso: string, withDate: boolean): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    if (!withDate) return time;
    return `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
};

const dash = <span className={styles.muted}>—</span>;

// nginx's levels. Only warn and worse are coloured; info and debug are the normal case.
const levelClass = (level: string): string | undefined => {
    if (/^(EMERG|ALERT|CRIT|ERROR)$/.test(level)) return styles.levelError;
    if (level === 'WARN') return styles.levelWarn;
    return undefined;
};

/**
 * What every generated column's accessor returns. One shared type on purpose: the generated
 * columns cannot be a tuple, so a per-column value type would widen to a union the table
 * rejects. The renderer narrows it by the field's type instead.
 */
type LogFieldValue = string | number | null;

/**
 * How each kind of value is drawn, keyed by what it means rather than by which field it is.
 * This is what lets a field added to the gateway's log format show up with no change here.
 */
const buildRenderers = (colorMap: Record<string, string>): Record<LogFieldType, (value: LogFieldValue) => ReactNode> => ({
    TEXT: value => value ?? dash,

    MUTED: value => <span className={styles.muted}>{value ?? '—'}</span>,

    CODE: value => (value == null ? dash : <code className={styles.muted}>{value}</code>),

    PATH: value => (value == null ? dash : <span className={styles.pathCell}><code>{value}</code></span>),

    // Clipped rather than wrapped, so a Lua traceback cannot make one row as tall as the
    // panel - expanding the row shows it in full.
    MESSAGE: value => (value == null ? dash : <span className={styles.messageCell}>{value}</span>),

    LEVEL: value => {
        if (value == null) return dash;
        const severity = levelClass(String(value));
        if (!severity) return <span className={styles.muted}>{value}</span>;
        return <span className={`${styles.levelBadge} ${severity}`}>{value}</span>;
    },

    STATUS: value => (value == null ? dash : (
        <span
            className={styles.statusBadge}
            style={{ background: colorMap[String(value)], color: textOn(colorMap[String(value)]) }}
        >
            {value}
        </span>
    )),

    DURATION: value => (value == null ? dash : `${Number(value).toFixed(0)} ms`),

    ROUTE: value => value ?? dash,
});

// ROUTE is the one column reading two fields: an unnamed route is more use identified by id
// than left blank.
const valueOf = (row: LogEntry, field: LogFieldDescriptor): LogFieldValue =>
    field.type === 'ROUTE'
        ? row.routeName ?? row.routeId
        : (row[field.id] as LogFieldValue);

const columnHelper = createColumnHelper<typeof logTableFeatures, LogEntry>();

/**
 * The table's columns, built from GET /logs/fields?type= - see LogFields on the back end,
 * the single place the log's shape is written down.
 *
 * The first three are structural rather than log-format-derived: the expander is not a field,
 * and Time and Namespace come off the Loki stream rather than out of the line.
 *
 * Every column sorts, and none sorts locally - the sort goes to the server as `sort` and
 * `direction`. The expander is exempt for free, having no accessor.
 */
export const buildColumns = (
    fields: LogFieldDescriptor[],
    colorMap: Record<string, string>,
    showDate = false,
) => {
    const renderers = buildRenderers(colorMap);
    // columnHelper.columns() rather than a plain array: it preserves each column's own value
    // type through a variadic tuple, which the table's `columns` option requires.
    return columnHelper.columns([
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
            enableSorting: true,
            sortDescFirst: true,
            cell: info => <span className={styles.muted}>{formatTime(info.getValue(), showDate)}</span>,
            meta: { label: 'Time' },
        }),
        // Provenance rather than content: with the console pinned to several namespaces the
        // rows arrive merged, and this is the only thing telling them apart.
        columnHelper.accessor('namespace', {
            header: 'Namespace',
            cell: info => <span className={styles.muted}>{info.getValue() ?? '—'}</span>,
            meta: { label: 'Namespace' },
        }),
        ...fields.map(field => columnHelper.accessor(row => valueOf(row, field), {
            id: field.id,
            header: field.label,
            // Falls back rather than indexing straight in: a LogFieldType added on the Java
            // side and not mirrored here would otherwise take the whole table down.
            cell: info => (renderers[field.type] ?? renderers.MUTED)(info.getValue()),
            meta: { label: field.label, align: field.align ?? undefined },
        })),
    ]);
};

/**
 * Which columns start open. Absent from the map means visible, so only the hidden ones are
 * named. Off the server's descriptors, which hide the other kind's columns plus the few that
 * are filled but too rarely wanted to spend width on.
 */
export const defaultVisibility = (fields: LogFieldDescriptor[]): Record<string, boolean> =>
    Object.fromEntries(fields.filter(f => !f.defaultVisible).map(f => [f.id, false]));
