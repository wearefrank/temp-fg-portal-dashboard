import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flexRender, useTable } from '@tanstack/react-table';
import type { PaginationState, SortingState, ColumnVisibilityState } from '@tanstack/react-table';
import { useFetch } from '../../hooks/useFetch';
import { buildCodeMaps } from '../PromLineChart/PromLineChart';
import { TimeRangePicker } from '../TimeRangePicker/TimeRangePicker';
import {
    DEFAULT_RANGE,
    describeRange,
    loadRange,
    rangeKey,
    rangeToQuery,
    saveRange,
    spansMoreThanADay,
    type TimeRange,
} from '../TimeRangePicker/timeRange';
import { logTableFeatures } from './features';
import { buildColumns, defaultVisibility } from './columns';
import { NewLinesBadge } from './NewLinesBadge';
import type { LogFieldDescriptor, LogKind, LogPage } from './types';
import styles from './LokiLogTable.module.css';

export type { LogEntry, LogKind, LogPage } from './types';

const PAGE_SIZES = [25, 50, 100];

// Shimmer rows shown while the first page loads.
const SKELETON_ROWS = 8;

// What an empty result means, per kind. An empty error log is good news and should not read
// like something is misconfigured; an empty access log usually means no traffic yet.
const EMPTY_HINT: Record<LogKind, string> = {
    audit: 'No log lines yet — send requests through APISIX to populate this table',
    error: 'No errors logged in this window',
};

interface LokiLogTableProps {
    title: string;
    /**
     * Which of the gateway's two streams to read. Picks the selector server-side
     * (log_type="audit" or log_type="error") and the column set shown by default - the two
     * kinds of line share a row shape but almost none of the same columns are worth seeing.
     */
    kind: LogKind;
    // LogQL selector, overriding the one the kind would pick. Rarely wanted: a query names
    // its own stream, so passing one here makes `kind` cosmetic.
    query?: string;
    defaultPageSize?: number;
    // Only used the first time - after that the reader's own choice is restored from storage.
    defaultRange?: TimeRange;
    refreshKey: number;
}

// Pretty-prints the plugin's JSON so an expanded row is readable; a line that is not JSON
// is shown exactly as it arrived.
const formatRaw = (raw: string): string => {
    try {
        return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
        return raw;
    }
};

/**
 * Page numbers to draw: always the first and last, the current page and its neighbours,
 * and an ellipsis for the runs left out. Rendering all of them is unusable once a window
 * holds a few thousand lines.
 */
function pageItems(current: number, total: number): (number | '…')[] {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = new Set([1, total, current, current - 1, current + 1]);
    const sorted = [...pages].filter(p => p >= 1 && p <= total).sort((a, b) => a - b);
    const out: (number | '…')[] = [];
    sorted.forEach((p, i) => {
        if (i > 0 && p - sorted[i - 1] > 1) out.push('…');
        out.push(p);
    });
    return out;
}

// Stable identities for the empty case, so `data` going undefined does not hand the table a
// fresh array and invalidate everything memoised off it.
const NO_ENTRIES: never[] = [];
const NO_FIELDS: never[] = [];

// "no namespace filter". The empty string rather than a sentinel word, so it is also the
// falsy check and cannot collide with a real namespace called "all".
const ALL_NAMESPACES = '';

export const LokiLogTable: React.FC<LokiLogTableProps> = ({
    title,
    kind,
    query,
    defaultPageSize = 25,
    defaultRange,
    refreshKey,
}) => {
    const [range, setRange] = useState<TimeRange>(() => loadRange(kind) ?? defaultRange ?? DEFAULT_RANGE);
    const [searchInput, setSearchInput] = useState('');
    // Debounced separately from the input so typing does not fire a Loki query per keystroke.
    const [search, setSearch] = useState('');
    const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
    /**
     * Namespace to narrow to, or ALL_NAMESPACES for no narrowing.
     *
     * This one filters in the browser: it hides rows of the page already fetched rather than
     * asking Loki for a narrower set. So it costs no round trip and reacts instantly, but it
     * cannot reach lines that are not on this page - the row count, the page count and the
     * pager all still describe the unfiltered result. The subtitle says so when it is on.
     */
    const [namespace, setNamespace] = useState<string>(ALL_NAMESPACES);

    // Table state, owned here and handed to the table - the single copy. Reading page or
    // sort order anywhere below goes through the table instance rather than a parallel
    // useState, which is what stops the two drifting apart.
    const [pagination, setPagination] = useState<PaginationState>({
        pageIndex: 0,
        pageSize: defaultPageSize,
    });
    // Time descending is newest-first, which is Loki's `direction=backward`.
    const [sorting, setSorting] = useState<SortingState>([{ id: 'timestamp', desc: true }]);
    /**
     * The columns this table has, and which of them start open - see LogFields on the back
     * end, which is where the log's shape is declared. Fetched rather than hard-coded so that
     * a field added to the gateway's log format shows up here on its own.
     */
    const fieldsFetch = useFetch<LogFieldDescriptor[]>(`/logs/fields?type=${kind}`);
    const fields = fieldsFetch.data;

    // Seeded from the descriptors, then owned by the user - the visibility menu is theirs to
    // change and a later render must not push their choices back to the defaults.
    //
    // Seeded during render rather than in an effect, for the same reason as the reset block
    // below: an effect runs after the paint, so the table would show every column for a frame
    // and then collapse to the default set under the reader. Once per kind, not once per
    // arrival of `fields` - a refetch hands back an equal-but-new array, and re-seeding on
    // that would throw away whatever the reader had chosen in the menu.
    const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({});
    const [seededKind, setSeededKind] = useState<LogKind | null>(null);
    if (fields && seededKind !== kind) {
        setSeededKind(kind);
        setColumnVisibility(defaultVisibility(fields));
    }

    /**
     * The instant the current run of pages is cut from. Held so that paging does not shift
     * under new arrivals: without it, lines logged between clicking 1 and 2 push everything
     * down and page 2 repeats rows page 1 already showed.
     */
    const [anchor, setAnchor] = useState<string | null>(null);

    const { windowSeconds, anchor: rangeAnchor } = rangeToQuery(range);
    // Both halves of the sort, and both go to the server. Reading only `desc` here is what
    // used to make every header sort by time: whichever column was clicked, the id was
    // dropped and only its direction survived.
    const sortId = sorting[0]?.id ?? 'timestamp';
    const sortDesc = sorting[0]?.desc ?? true;

    const changeRange = useCallback((next: TimeRange) => {
        setRange(next);
        saveRange(kind, next);
    }, [kind]);

    useEffect(() => {
        const timer = setTimeout(() => setSearch(searchInput), 300);
        return () => clearTimeout(timer);
    }, [searchInput]);

    /**
     * Identifies a result set. Any change to it invalidates the page number and the anchor,
     * because they describe a different set of lines. refreshKey is deliberately not part of
     * it - a tick asks for newer lines, not a different result set. See the block below.
     *
     * Adjusted during render rather than in an effect. An effect would render once with the
     * stale page, then again after correcting it, and fire a throwaway request in between.
     */
    const resetKey = `${kind}|${query ?? ''}|${search}|${rangeKey(range)}|${sortId}|${sortDesc}`;
    const [seenResetKey, setSeenResetKey] = useState(resetKey);
    if (seenResetKey !== resetKey) {
        setSeenResetKey(resetKey);
        setPagination(p => ({ ...p, pageIndex: 0 }));
        setAnchor(null);
    }

    /**
     * A dashboard tick pulls in new lines only on page 1: dropping the pin changes the
     * endpoint, and with no pin the counter below asks for the same URL again.
     *
     * Past page 1 it does nothing - that page is pinned so rows do not move under the reader,
     * and NewLinesBadge says what is waiting. An absolute range ignores ticks entirely,
     * because nothing new can land inside a window that has already ended.
     */
    const [seenRefreshKey, setSeenRefreshKey] = useState(refreshKey);
    const [pendingRefetch, setPendingRefetch] = useState(0);
    if (seenRefreshKey !== refreshKey) {
        setSeenRefreshKey(refreshKey);
        if (range.kind === 'relative' && pagination.pageIndex === 0) {
            if (anchor) setAnchor(null);
            else setPendingRefetch(n => n + 1);
        }
    }

    const endpoint = useMemo(() => {
        // A duration plus the instant it ends at, because the backend hangs both ends of the
        // window off the anchor - so every page covers the same span. An absolute range
        // brings its own end; a relative one is pinned on the first page click instead.
        const p = new URLSearchParams({
            type: kind,
            windowSeconds: String(windowSeconds),
            page: String(pagination.pageIndex + 1),
            pageSize: String(pagination.pageSize),
            // The sort, resolved server-side rather than in the browser: Time becomes Loki's
            // own `direction`, any other column is ordered over the window before the page
            // is cut from it. "forward" is ascending either way.
            sort: sortId,
            direction: sortDesc ? 'backward' : 'forward',
        });
        if (query) p.set('query', query);
        if (search) p.set('search', search);
        const end = rangeAnchor ?? anchor;
        if (end) p.set('anchor', end);
        return `/logs/page?${p}`;
    }, [kind, query, search, windowSeconds, rangeAnchor, pagination, sortId, sortDesc, anchor]);

    const pageFetch = useFetch<LogPage>(endpoint);
    const data = pageFetch.data;

    // True while the reader is waiting on a page they asked for: the shown page no longer
    // matches the requested one. A tick asks for the page already shown, so it stays quiet.
    const userBusy = pageFetch.loading && data != null && (
        data.page !== pagination.pageIndex + 1
        || data.pageSize !== pagination.pageSize
    );

    // In a ref so the effect can depend on the counter alone - refetch is new every render.
    const refetchRef = useRef(pageFetch.refetch);
    useEffect(() => {
        refetchRef.current = pageFetch.refetch;
    });

    // useFetch keys off the endpoint string, so an unchanged URL has to be asked for by hand.
    useEffect(() => {
        if (pendingRefetch === 0) return;
        refetchRef.current();
    }, [pendingRefetch]);

    const entries = useMemo(() => data?.entries ?? NO_ENTRIES, [data?.entries]);

    /**
     * The namespaces offered in the picker, accumulated across the pages seen rather than
     * taken from the current one. A page holding only one namespace would otherwise shrink
     * the menu to that one and drop the reader's own selection out of it while they page.
     */
    const [knownNamespaces, setKnownNamespaces] = useState<string[]>([]);
    useEffect(() => {
        const onThisPage = entries
            .map(e => e.namespace)
            .filter((ns): ns is string => ns != null);
        setKnownNamespaces(prev => {
            const merged = [...new Set([...prev, ...onThisPage])].sort();
            // Same identity when nothing is new - merged is always a superset of prev, so
            // the lengths agreeing means they are equal. Without this the set is a fresh
            // array every time and the effect re-triggers itself.
            return merged.length === prev.length ? prev : merged;
        });
    }, [entries]);

    // The rows actually drawn. Filtering here rather than in the query is what makes the
    // picker instant; see the note on `namespace` for what it costs.
    const visibleEntries = useMemo(
        () => (namespace === ALL_NAMESPACES ? entries : entries.filter(e => e.namespace === namespace)),
        [entries, namespace],
    );

    const totalCount = data?.totalCount ?? 0;
    // The server decides how deep paging can go (Loki caps a query at 5000 entries), so its
    // page count wins over anything derived from the row count alone.
    const serverPageCount = data?.totalPages ?? 1;

    // Colour statuses off the same palette the HTTP status panels use, so a 502 is the
    // same red everywhere on the dashboard.
    const colorMap = useMemo(() => {
        const codes = [...new Set(
            entries.map(e => (e.status == null ? null : String(e.status)))
                   .filter((c): c is string => c !== null),
        )];
        return buildCodeMaps(codes).colorMap;
    }, [entries]);

    // A window that can cross midnight needs the date in the Time column - a time of day on
    // its own says nothing about which day it was.
    const showDate = spansMoreThanADay(range);
    const columns = useMemo(
        () => buildColumns(fields ?? NO_FIELDS, colorMap, showDate),
        [fields, colorMap, showDate],
    );

    const table = useTable({
        features: logTableFeatures,
        columns,
        data: visibleEntries,
        // Every one of these is manual because the rows here are a single page of a log that
        // lives in Loki. Left automatic, the table would page and sort the twenty-five rows
        // in the browser and present that as if it had done so across the whole window.
        manualPagination: true,
        manualSorting: true,
        // One column at a time, and always one: the server orders by a single `sort`, so a
        // shift-click building a second key would be a control the backend cannot honour,
        // and clicking through to "no sort" would only mean falling back to time anyway.
        enableMultiSort: false,
        enableSortingRemoval: false,
        pageCount: serverPageCount,
        rowCount: totalCount,
        state: { pagination, sorting, columnVisibility },
        onPaginationChange: setPagination,
        onSortingChange: setSorting,
        onColumnVisibilityChange: setColumnVisibility,
        getRowCanExpand: () => true,
        // tsNanos is unique per line in practice; the index keeps the id stable for the
        // rare pair that shares a nanosecond.
        getRowId: (row, index) => `${row.tsNanos}-${index}`,
    });

    /**
     * Pins the snapshot the moment the user first navigates, adopting the anchor the backend
     * chose for page 1. From here on every page is cut from that same instant, so lines
     * arriving mid-session cannot shift rows between pages.
     */
    const pinAnchor = useCallback(() => {
        // An absolute range already ends at a fixed instant, so there is nothing to pin.
        if (range.kind === 'absolute') return;
        if (!anchor && data?.anchor) setAnchor(data.anchor);
    }, [range.kind, anchor, data]);

    const goToPage = useCallback((oneBased: number) => {
        pinAnchor();
        table.setPageIndex(oneBased - 1);
    }, [pinAnchor, table]);

    const pageCount = table.getPageCount();
    const currentPage = pagination.pageIndex + 1;

    let subtitle: string;
    // First, because the table is gated on the descriptors: without them nothing is drawn at
    // all, and an empty card that says "no lines" would blame Loki for a column problem.
    if (fieldsFetch.error) subtitle = 'Columns unavailable — cannot draw the table';
    else if (pageFetch.loading && !data) subtitle = 'Loading…';
    else if (pageFetch.error) subtitle = 'Loki unavailable';
    else if (totalCount === 0 && search) subtitle = `No lines match "${search}" in this window`;
    else if (totalCount === 0) subtitle = EMPTY_HINT[kind];
    else {
        const window = describeRange(range);
        const filter = search ? ` matching "${search}"` : '';
        const first = (data!.page - 1) * data!.pageSize + 1;
        const last = first + entries.length - 1;
        // Time reads as an age, everything else as a column and an arrow - "oldest first"
        // has an obvious meaning that "Status, ascending" does not.
        const order = sortId === 'timestamp'
            ? (sortDesc ? 'newest first' : 'oldest first')
            : `by ${table.getColumn(sortId)?.columnDef.meta?.label ?? sortId} ${sortDesc ? '↓' : '↑'}`;
        // The span and the total are the server's, and the namespace picker does not reach
        // them - it only hides rows of this page. Said out loud, because otherwise it reads
        // as the count disagreeing with what is on screen.
        const ns = namespace === ALL_NAMESPACES
            ? ''
            : ` · showing the ${visibleEntries.length.toLocaleString()} from ${namespace}`;
        subtitle = `${first.toLocaleString()}–${last.toLocaleString()} of ${totalCount.toLocaleString()} lines${filter} in ${window} · ${order}${ns}`;
    }

    const visibleColumnCount = table.getVisibleLeafColumns().length;

    return (
        <div className={`card ${styles.fullWidthCard}`}>
            <div className="card-header">{title}</div>
            {/* Always rendered, so switching it on costs no layout shift. The only visible
                sign of a background refresh. */}
            <div
                className={`${styles.progressBar} ${pageFetch.loading ? styles.progressBarActive : ''}`}
                aria-hidden="true"
            />

            <div className={styles.controls}>
                <TimeRangePicker value={range} onChange={changeRange} />
                {/* Narrows to one namespace in the browser - see the `namespace` state. One
                    button each rather than a dropdown: there are only ever a handful, and
                    switching between them is a click instead of open-then-pick. Always shown,
                    even with a single namespace, so "which am I looking at" has an answer
                    rather than the control simply being absent. */}
                <div className={styles.namespaceFilter} role="group" aria-label="Filter by namespace">
                    {/* Without this the row is a pair of buttons reading "All" and a bare
                        name, which says nothing about what they narrow. */}
                    <span className={styles.namespaceLabel}>Namespace</span>
                    <button
                        type="button"
                        className={`${styles.toolbarBtn} ${namespace === ALL_NAMESPACES ? styles.toolbarBtnActive : ''}`}
                        onClick={() => setNamespace(ALL_NAMESPACES)}
                        aria-pressed={namespace === ALL_NAMESPACES}
                    >
                        All
                    </button>
                    {knownNamespaces.map(ns => (
                        <button
                            key={ns}
                            type="button"
                            className={`${styles.toolbarBtn} ${namespace === ns ? styles.toolbarBtnActive : ''}`}
                            onClick={() => setNamespace(ns)}
                            aria-pressed={namespace === ns}
                        >
                            {ns}
                        </button>
                    ))}
                </div>
                <div className={styles.searchWrap}>
                    <input
                        className={styles.search}
                        type="search"
                        placeholder="Search log lines…"
                        value={searchInput}
                        onChange={e => setSearchInput(e.target.value)}
                        aria-label="Search log lines"
                    />
                    {searchInput && (
                        <button
                            className={styles.clearSearch}
                            onClick={() => setSearchInput('')}
                            aria-label="Clear search"
                            type="button"
                        >
                            ×
                        </button>
                    )}
                </div>

                <div className={styles.columnsMenuWrap}>
                    <button
                        className={styles.toolbarBtn}
                        type="button"
                        onClick={() => setColumnsMenuOpen(o => !o)}
                        aria-expanded={columnsMenuOpen}
                    >
                        Columns ▾
                    </button>
                    {columnsMenuOpen && (
                        <div className={styles.columnsMenu}>
                            {table.getAllLeafColumns()
                                // The expander is structural, not a column anyone chooses.
                                .filter(column => column.id !== 'expander')
                                .map(column => (
                                    <label key={column.id} className={styles.columnsMenuItem}>
                                        <input
                                            type="checkbox"
                                            checked={column.getIsVisible()}
                                            onChange={column.getToggleVisibilityHandler()}
                                        />
                                        {column.columnDef.meta?.label ?? column.id}
                                    </label>
                                ))}
                        </div>
                    )}
                </div>

                <select
                    className={styles.pageSize}
                    value={pagination.pageSize}
                    onChange={e => {
                        pinAnchor();
                        table.setPageSize(Number(e.target.value));
                    }}
                    aria-label="Rows per page"
                >
                    {PAGE_SIZES.map(size => <option key={size} value={size}>{size} / page</option>)}
                </select>

                <div className={styles.count}>
                    {pageFetch.loading && !data && 'Counting…'}
                    {pageFetch.error && 'Count unavailable'}
                    {data && (<><span className={styles.countValue}>{totalCount.toLocaleString()}</span> matching</>)}
                </div>
            </div>

            <div className={`text-small text-muted ${styles.emptyHint}`}>{subtitle}</div>

            <div
                className={`${styles.tableArea} ${userBusy ? styles.tableAreaBusy : ''}`}
                aria-busy={pageFetch.loading}
            >
                {/* Waits on the descriptors as well as the rows: the columns come from them,
                    so drawing before they land means a three-column table widening under the
                    reader a moment later. */}
                {fields != null && (entries.length > 0 || pageFetch.loading) && (
                    <table className={styles.logTable}>
                        <thead>
                            {table.getHeaderGroups().map(headerGroup => (
                                <tr key={headerGroup.id}>
                                    {headerGroup.headers.map(header => {
                                        const canSort = header.column.getCanSort();
                                        const sorted = header.column.getIsSorted();
                                        return (
                                            <th
                                                key={header.id}
                                                className={header.column.columnDef.meta?.align === 'right'
                                                    ? styles.numeric : undefined}
                                            >
                                                {header.isPlaceholder ? null : canSort ? (
                                                    <button
                                                        type="button"
                                                        className={styles.sortHeader}
                                                        onClick={() => {
                                                            pinAnchor();
                                                            header.column.toggleSorting();
                                                        }}
                                                        title={header.column.id === 'timestamp'
                                                            ? 'Sort by time (resolved by Loki)'
                                                            : 'Sort the whole window by this column'}
                                                    >
                                                        {flexRender(header.column.columnDef.header, header.getContext())}
                                                        <span className={styles.sortIndicator}>
                                                            {sorted === 'desc' ? '↓' : sorted === 'asc' ? '↑' : '↕'}
                                                        </span>
                                                    </button>
                                                ) : (
                                                    flexRender(header.column.columnDef.header, header.getContext())
                                                )}
                                            </th>
                                        );
                                    })}
                                </tr>
                            ))}
                        </thead>
                        <tbody>
                            {/* Shimmer rows while the first page loads, so the card does not
                                jump when the real rows land. */}
                            {entries.length === 0 && Array.from({ length: SKELETON_ROWS }, (_, i) => (
                                <tr key={`skeleton-${i}`}>
                                    {Array.from({ length: visibleColumnCount }, (_, cell) => (
                                        <td key={cell}><span className={styles.skeletonCell} /></td>
                                    ))}
                                </tr>
                            ))}
                            {table.getRowModel().rows.map(row => (
                                <React.Fragment key={row.id}>
                                    <tr className={styles.clickableRow} onClick={() => row.toggleExpanded()}>
                                        {row.getVisibleCells().map(cell => (
                                            <td
                                                key={cell.id}
                                                className={cell.column.columnDef.meta?.align === 'right'
                                                    ? styles.numeric : undefined}
                                            >
                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                            </td>
                                        ))}
                                    </tr>
                                    {row.getIsExpanded() && (
                                        <tr className={styles.rawRow}>
                                            <td className={styles.rawCell} colSpan={visibleColumnCount}>
                                                {formatRaw(row.original.raw)}
                                                <div>
                                                    <button
                                                        className={styles.copyButton}
                                                        type="button"
                                                        onClick={e => {
                                                            e.stopPropagation();
                                                            navigator.clipboard?.writeText(row.original.raw);
                                                        }}
                                                    >
                                                        Copy raw line
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {pageCount > 1 && (
                <nav className={styles.pager} aria-label="Log pages">
                    <button
                        className={styles.pageBtn}
                        type="button"
                        onClick={() => { pinAnchor(); table.previousPage(); }}
                        disabled={!table.getCanPreviousPage() || userBusy}
                        aria-label="Previous page"
                    >
                        ‹
                    </button>
                    {pageItems(currentPage, pageCount).map((item, i) =>
                        item === '…' ? (
                            <span key={`gap-${i}`} className={styles.pageGap}>…</span>
                        ) : (
                            <button
                                key={item}
                                type="button"
                                className={`${styles.pageBtn} ${item === currentPage ? styles.pageBtnActive : ''}`}
                                onClick={() => goToPage(item)}
                                disabled={userBusy}
                                aria-current={item === currentPage ? 'page' : undefined}
                            >
                                {item}
                            </button>
                        ),
                    )}
                    <button
                        className={styles.pageBtn}
                        type="button"
                        onClick={() => { pinAnchor(); table.nextPage(); }}
                        disabled={!table.getCanNextPage() || userBusy}
                        aria-label="Next page"
                    >
                        ›
                    </button>
                    {/* Only where the table has stopped following the log: a relative window,
                        past page 1, with a snapshot pinned. */}
                    {range.kind === 'relative' && anchor && pagination.pageIndex !== 0 && (
                        <NewLinesBadge
                            kind={kind}
                            query={query}
                            search={search}
                            anchor={anchor}
                            refreshKey={refreshKey}
                            onJump={() => { setAnchor(null); table.setPageIndex(0); }}
                        />
                    )}
                    {data?.depthCapped && (
                        <span className={styles.pagerNote}>
                            {/* Said differently under a column sort, because the ceiling
                                stops being only about how deep you can page: the ordering
                                is over the lines paging can reach, so the highest status in
                                the window may sit below the cut and never appear. */}
                            {sortId === 'timestamp'
                                ? `paging reaches the newest ${(pageCount * pagination.pageSize).toLocaleString()} — narrow the range or search to see older lines`
                                : `sorted over the newest ${(pageCount * pagination.pageSize).toLocaleString()} — narrow the range or search to sort them all`}
                        </span>
                    )}
                </nav>
            )}
        </div>
    );
};
