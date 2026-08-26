import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { flexRender, useTable } from '@tanstack/react-table';
import type { PaginationState, SortingState, ColumnVisibilityState } from '@tanstack/react-table';
import { useFetch } from '../../hooks/useFetch';
import { RangeToggle, buildCodeMaps, RANGE_OPTIONS } from '../PromLineChart/PromLineChart';
import type { RangeLabel } from '../PromLineChart/PromLineChart';
import { logTableFeatures } from './features';
import { buildColumns, DEFAULT_HIDDEN_COLUMNS } from './columns';
import type { LogPage } from './types';
import styles from './LokiLogTable.module.css';

export type { LogEntry, LogPage } from './types';

const PAGE_SIZES = [25, 50, 100];

interface LokiLogTableProps {
    title: string;
    // LogQL selector. Left out, the backend falls back to {app_name="apisix"}.
    query?: string;
    defaultPageSize?: number;
    defaultRange?: RangeLabel;
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

// Stable identity for the empty case, so `data` going undefined does not hand the table a
// fresh array and invalidate everything memoised off it.
const NO_ENTRIES: never[] = [];

export const LokiLogTable: React.FC<LokiLogTableProps> = ({
    title,
    query,
    defaultPageSize = 25,
    defaultRange,
    refreshKey,
}) => {
    const [rangeLabel, setRangeLabel] = useState<RangeLabel>(defaultRange ?? '1h');
    const [searchInput, setSearchInput] = useState('');
    // Debounced separately from the input so typing does not fire a Loki query per keystroke.
    const [search, setSearch] = useState('');
    const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);

    // Table state, owned here and handed to the table - the single copy. Reading page or
    // sort order anywhere below goes through the table instance rather than a parallel
    // useState, which is what stops the two drifting apart.
    const [pagination, setPagination] = useState<PaginationState>({
        pageIndex: 0,
        pageSize: defaultPageSize,
    });
    // Time descending is newest-first, which is Loki's `direction=backward`.
    const [sorting, setSorting] = useState<SortingState>([{ id: 'timestamp', desc: true }]);
    const [columnVisibility, setColumnVisibility] =
        useState<ColumnVisibilityState>(DEFAULT_HIDDEN_COLUMNS);

    /**
     * The instant the current run of pages is cut from. Held so that paging does not shift
     * under new arrivals: without it, lines logged between clicking 1 and 2 push everything
     * down and page 2 repeats rows page 1 already showed.
     */
    const [anchor, setAnchor] = useState<string | null>(null);

    const selectedRange = RANGE_OPTIONS.find(r => r.label === rangeLabel)!;
    const sortDesc = sorting[0]?.desc ?? true;

    useEffect(() => {
        const timer = setTimeout(() => setSearch(searchInput), 300);
        return () => clearTimeout(timer);
    }, [searchInput]);

    /**
     * Identifies a result set. Any change to it invalidates the page number and the anchor,
     * because they describe a different set of lines - and refreshKey belongs in it too: the
     * dashboard tick is meant to pull in newly arrived lines, which means letting go of the
     * pinned snapshot and returning to the newest page.
     *
     * Adjusted during render rather than in an effect. An effect would render once with the
     * stale page, then again after correcting it, and fire a throwaway request in between.
     */
    const resetKey = `${query ?? ''}|${search}|${selectedRange.label}|${sortDesc}|${refreshKey}`;
    const [seenResetKey, setSeenResetKey] = useState(resetKey);
    if (seenResetKey !== resetKey) {
        setSeenResetKey(resetKey);
        setPagination(p => ({ ...p, pageIndex: 0 }));
        setAnchor(null);
    }

    const endpoint = useMemo(() => {
        // A duration, not an absolute start: the backend hangs both ends of the window off
        // the anchor, so every page covers the same span. Reading the clock here instead
        // would let the window drift between one page click and the next - and Date.now()
        // during render is impure anyway. 0 means the whole retention window.
        const windowSeconds = selectedRange.startOffset ?? 0;
        const p = new URLSearchParams({
            windowSeconds: String(windowSeconds),
            page: String(pagination.pageIndex + 1),
            pageSize: String(pagination.pageSize),
            // The Time column's sort direction, resolved by Loki rather than in the browser.
            direction: sortDesc ? 'backward' : 'forward',
        });
        if (query) p.set('query', query);
        if (search) p.set('search', search);
        if (anchor) p.set('anchor', anchor);
        return `/logs/page?${p}`;
    }, [query, search, selectedRange.startOffset, pagination, sortDesc, anchor]);

    const pageFetch = useFetch<LogPage>(endpoint);
    const data = pageFetch.data;

    const entries = useMemo(() => data?.entries ?? NO_ENTRIES, [data?.entries]);
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

    const columns = useMemo(() => buildColumns(colorMap), [colorMap]);

    const table = useTable({
        features: logTableFeatures,
        columns,
        data: entries,
        // Every one of these is manual because the rows here are a single page of a log that
        // lives in Loki. Left automatic, the table would page and sort the twenty-five rows
        // in the browser and present that as if it had done so across the whole window.
        manualPagination: true,
        manualSorting: true,
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
        if (!anchor && data?.anchor) setAnchor(data.anchor);
    }, [anchor, data]);

    const goToPage = useCallback((oneBased: number) => {
        pinAnchor();
        table.setPageIndex(oneBased - 1);
    }, [pinAnchor, table]);

    const pageCount = table.getPageCount();
    const currentPage = pagination.pageIndex + 1;

    let subtitle: string;
    if (pageFetch.loading && !data) subtitle = 'Loading…';
    else if (pageFetch.error) subtitle = 'Loki unavailable';
    else if (totalCount === 0 && search) subtitle = `No lines match "${search}" in this window`;
    else if (totalCount === 0) subtitle = 'No log lines yet — send requests through APISIX to populate this table';
    else {
        const window = rangeLabel === 'All' ? 'the retention window' : `the last ${rangeLabel}`;
        const filter = search ? ` matching "${search}"` : '';
        const first = (data!.page - 1) * data!.pageSize + 1;
        const last = first + entries.length - 1;
        const order = sortDesc ? 'newest first' : 'oldest first';
        subtitle = `${first.toLocaleString()}–${last.toLocaleString()} of ${totalCount.toLocaleString()} lines${filter} in ${window} · ${order}`;
    }

    const visibleColumnCount = table.getVisibleLeafColumns().length;

    return (
        <div className={`card ${styles.fullWidthCard}`}>
            <div className="card-header">{title}</div>

            <div className={styles.controls}>
                <RangeToggle value={rangeLabel} onChange={setRangeLabel} />
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
                        className={styles.pageBtn}
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

            <div className={styles.tableArea}>
                {entries.length > 0 && (
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
                                                        title="Sort by time (resolved by Loki)"
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
                        disabled={!table.getCanPreviousPage() || pageFetch.loading}
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
                                disabled={pageFetch.loading}
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
                        disabled={!table.getCanNextPage() || pageFetch.loading}
                        aria-label="Next page"
                    >
                        ›
                    </button>
                    {data?.depthCapped && (
                        <span className={styles.pagerNote}>
                            paging reaches the newest {(pageCount * pagination.pageSize).toLocaleString()} —
                            narrow the range or search to see older lines
                        </span>
                    )}
                </nav>
            )}
        </div>
    );
};
