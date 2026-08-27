import type { ReactNode } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { LogEntry, LogFieldDescriptor, LogFieldType } from './types';
import type { logTableFeatures } from './features';
import styles from './LokiLogTable.module.css';

// withDate is set for windows that can cross midnight, where a time of day on its own does
// not say which day the line is from.
const formatTime = (iso: string, withDate: boolean): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    if (!withDate) return time;
    return `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
};

const dash = <span className={styles.muted}>—</span>;

// nginx's levels, worst first. Anything above warn is coloured; info and debug are the
// normal case and would only add noise as a badge.
const levelClass = (level: string): string | undefined => {
    if (/^(EMERG|ALERT|CRIT|ERROR)$/.test(level)) return styles.levelError;
    if (level === 'WARN') return styles.levelWarn;
    return undefined;
};

/**
 * What every generated column's accessor returns.
 *
 * One type across all of them on purpose. columnHelper.columns() preserves each column's own
 * value type through a variadic tuple, and a heterogeneous array widens them to a union that
 * the table's `columns` option (typed at TValue = unknown) then rejects. Generated columns
 * cannot be a tuple - there are as many as the server says - so they share a TValue instead,
 * and the renderer narrows it by the field's type. Which it can: the type is the same thing
 * the server coerced the value by.
 */
type LogFieldValue = string | number | null;

/**
 * How each kind of value is drawn, keyed by what it means rather than by which field it is.
 *
 * This is what lets a field added to the gateway's log format show up as a column with no
 * change here: it arrives with a LogFieldType, and that names a renderer that already exists.
 *
 * `colorMap` is the palette for status pills, derived from whichever codes are on the page
 * being rendered - data, not configuration, which is why these are built per render.
 */
const buildRenderers = (colorMap: Record<string, string>): Record<LogFieldType, (value: LogFieldValue) => ReactNode> => ({
    TEXT: value => value ?? dash,

    MUTED: value => <span className={styles.muted}>{value ?? '—'}</span>,

    CODE: value => (value == null ? dash : <code className={styles.muted}>{value}</code>),

    // No raw fallback any more: a line that parses as neither shape keeps its text in
    // message, so an empty path really means the line had none.
    PATH: value => (value == null ? dash : <span className={styles.pathCell}><code>{value}</code></span>),

    // The widest column, and the one the error table is really for. Clipped rather than
    // wrapped so a Lua traceback cannot make one row as tall as the panel - expanding the
    // row shows it in full.
    MESSAGE: value => (value == null ? dash : <span className={styles.messageCell}>{value}</span>),

    LEVEL: value => {
        if (value == null) return dash;
        const severity = levelClass(String(value));
        return severity
            ? <span className={`${styles.levelBadge} ${severity}`}>{value}</span>
            : <span className={styles.muted}>{value}</span>;
    },

    STATUS: value => (value == null ? dash : (
        <span className={styles.statusBadge} style={{ background: colorMap[String(value)] }}>
            {value}
        </span>
    )),

    DURATION: value => (value == null ? dash : `${Number(value).toFixed(0)} ms`),

    ROUTE: value => value ?? dash,
});

/**
 * A field's value off a row. Everything reads its own id except ROUTE, which is two fields:
 * a route without a name still has an id, and an unnamed route is more use identified than
 * blank. The server keeps them apart on the record and says here that they are one column.
 */
const valueOf = (row: LogEntry, field: LogFieldDescriptor): LogFieldValue =>
    field.type === 'ROUTE'
        ? row.routeName ?? row.routeId
        : (row[field.id] as LogFieldValue);

const columnHelper = createColumnHelper<typeof logTableFeatures, LogEntry>();

/**
 * The table's columns, built from what the server says the log holds.
 *
 * `fields` is GET /logs/fields?type=, in order - see LogFields on the back end, which is the
 * single place the log's shape is written down. Declaring the columns here as well is what
 * used to make a change to the gateway's log format a four-file edit, and a rename of one of
 * its keys a column that quietly filled with dashes.
 *
 * The three ahead of them are structural rather than log-format-derived, so they stay
 * declared: the expander is not a field at all, and Time and Namespace come off the Loki
 * stream rather than out of the line.
 *
 * `meta.label` is the human name for the column-visibility menu, which otherwise has only
 * the column id to show. `meta.align` moves numeric alignment onto the cell itself instead
 * of every cell wrapping its own span.
 *
 * Every column here sorts, and none of them sorts locally: the sort state is handed to the
 * server as `sort` and `direction`, and what comes back is a page of the window in that
 * order. The expander is the one exception, and it gets that for free - it has no accessor,
 * and TanStack does not offer to sort a display column.
 */
export const buildColumns = (
    fields: LogFieldDescriptor[],
    colorMap: Record<string, string>,
    showDate = false,
) => {
    const renderers = buildRenderers(colorMap);
    // columnHelper.columns() rather than a plain array: it preserves each column's own value
    // type through a variadic tuple. A bare array widens them to a union that the table's
    // `columns` option (typed at TValue = unknown) then rejects. The generated columns spread
    // into the tail of that tuple, which is what the shared LogFieldValue above is for.
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
            // The default sort, and the only one Loki resolves itself - the others are
            // ordered by the backend over the window before it cuts the page.
            enableSorting: true,
            sortDescFirst: true,
            cell: info => <span className={styles.muted}>{formatTime(info.getValue(), showDate)}</span>,
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
        ...fields.map(field => columnHelper.accessor(row => valueOf(row, field), {
            id: field.id,
            header: field.label,
            // Falls back rather than indexing straight in. TypeScript reads `renderers` as
            // total over LogFieldType, but the type on the wire is whatever the server sent
            // - the fetch asserts the shape, it does not check it. A LogFieldType added on
            // the Java side and not mirrored here would otherwise be `undefined(value)`,
            // which takes the whole table down with a TypeError. Plain text until someone
            // gives the new type a renderer is the better failure.
            cell: info => (renderers[field.type] ?? renderers.MUTED)(info.getValue()),
            meta: { label: field.label, align: field.align ?? undefined },
        })),
    ]);
};

/**
 * Which columns start open, for one kind - the shape the table's columnVisibility state
 * takes. Absent from the map means visible, so only the hidden ones are named.
 *
 * Off the server's descriptors rather than a list here. Mostly what it hides is the other
 * kind's columns, which would be a row of dashes, but not only: Host, Client, Upstream and
 * Gemeente are filled on an access record and still start hidden, because fifteen columns is
 * more than fits and those are the ones you go looking for rather than scan. The visibility
 * menu brings any of them back.
 */
export const defaultVisibility = (fields: LogFieldDescriptor[]): Record<string, boolean> =>
    Object.fromEntries(fields.filter(f => !f.defaultVisible).map(f => [f.id, false]));
