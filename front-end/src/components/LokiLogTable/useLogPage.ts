import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PaginationState, SortingState } from '@tanstack/react-table';
import { useFetch } from '../../hooks/useFetch';
import { useTickWhile } from '../../hooks/useTickWhile';
import {
    DEFAULT_RANGE,
    loadRange,
    rangeKey,
    rangeToQuery,
    saveRange,
    type TimeRange,
} from '../TimeRangePicker/timeRange';
import type { LogKind, LogPage } from './types';

const SEARCH_DEBOUNCE_MS = 300;

/** Searching every column at once, which is the default and what a term alone has always meant. */
export const ALL_COLUMNS = '';

interface UseLogPageOptions {
    kind: LogKind;
    query?: string;
    defaultPageSize: number;
    defaultRange?: TimeRange;
    /** A term pushed in from outside, e.g. the route picked in the traffic table. */
    searchProp?: string;
    /** A window pushed in from outside, e.g. the span zoomed into on the traffic chart. */
    rangeProp?: TimeRange;
    refreshKey: number;
}

/**
 * One page of a Loki log, and every control that decides which page that is.
 *
 * The awkward part is that the rows live on the server: paging, sorting and searching all
 * become query parameters, and a page has to stay still while new lines arrive underneath.
 */
export function useLogPage({
    kind,
    query,
    defaultPageSize,
    defaultRange,
    searchProp,
    rangeProp,
    refreshKey,
}: UseLogPageOptions) {
    const [range, setRange] = useState<TimeRange>(() => loadRange(kind) ?? defaultRange ?? DEFAULT_RANGE);
    const [searchInput, setSearchInput] = useState(searchProp ?? '');
    // Debounced apart from the input, so typing does not fire a Loki query per keystroke.
    const [search, setSearch] = useState('');
    // Which column the term is looked for in, or ALL_COLUMNS for the whole line. Not
    // debounced - picking one is a single click, not a stream of keystrokes.
    const [searchField, setSearchField] = useState(ALL_COLUMNS);
    const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: defaultPageSize });
    // Time descending is newest-first, which is Loki's `direction=backward`.
    const [sorting, setSorting] = useState<SortingState>([{ id: 'timestamp', desc: true }]);
    /** The instant this run of pages is cut from, so paging does not shift under new lines. */
    const [anchor, setAnchor] = useState<string | null>(null);

    const { windowSeconds, anchor: rangeAnchor } = rangeToQuery(range);
    const sortId = sorting[0]?.id ?? 'timestamp';
    const sortDesc = sorting[0]?.desc ?? true;

    const changeRange = useCallback((next: TimeRange) => {
        setRange(next);
        saveRange(kind, next);
    }, [kind]);

    useEffect(() => {
        const timer = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [searchInput]);

    // A term from outside replaces the box, but only when it actually changes - otherwise
    // every render would overwrite what the reader has typed since.
    const [lastSearchProp, setLastSearchProp] = useState(searchProp);
    if (searchProp !== undefined && searchProp !== lastSearchProp) {
        setLastSearchProp(searchProp);
        setSearchInput(searchProp);
    }

    // Same again for the window. Compared by identity on purpose, so applying the same span
    // twice still lands. Not persisted, so a reload returns to the reader's own window.
    const [lastRangeProp, setLastRangeProp] = useState(rangeProp);
    if (rangeProp !== undefined && rangeProp !== lastRangeProp) {
        setLastRangeProp(rangeProp);
        setRange(rangeProp);
    }

    // Identifies a result set. Changing it invalidates the page number and the anchor, which
    // describe a different set of lines. Adjusted during render so no throwaway request goes
    // out with the stale page.
    const resetKey = `${kind}|${query ?? ''}|${search}|${searchField}|${rangeKey(range)}|${sortId}|${sortDesc}`;
    const [seenResetKey, setSeenResetKey] = useState(resetKey);
    if (seenResetKey !== resetKey) {
        setSeenResetKey(resetKey);
        setPagination(p => ({ ...p, pageIndex: 0 }));
        setAnchor(null);
    }

    // Page 1 of a relative window follows the log; anywhere else the page is pinned and takes
    // no ticks, so rows cannot move under the reader. NewLinesBadge says what is waiting.
    const following = range.kind === 'relative' && pagination.pageIndex === 0;
    const tick = useTickWhile(refreshKey, following);
    if (following && anchor) {
        setAnchor(null);
    }

    const endpoint = useMemo(() => {
        // A duration plus the instant it ends at: the backend hangs both ends of the window
        // off the anchor, so every page covers the same span.
        const params = new URLSearchParams({
            type: kind,
            windowSeconds: String(windowSeconds),
            page: String(pagination.pageIndex + 1),
            pageSize: String(pagination.pageSize),
            // Resolved server-side: Time becomes Loki's own `direction`, any other column is
            // ordered over the window before the page is cut from it.
            sort: sortId,
            direction: sortDesc ? 'backward' : 'forward',
        });
        if (query) params.set('query', query);
        if (search) params.set('search', search);
        // Only ever alongside a term: a column with nothing to look for narrows nothing.
        if (search && searchField) params.set('searchField', searchField);
        const end = rangeAnchor ?? anchor;
        if (end) params.set('anchor', end);
        return `/logs/page?${params}`;
    }, [kind, query, search, searchField, windowSeconds, rangeAnchor, pagination, sortId, sortDesc, anchor]);

    const pageFetch = useFetch<LogPage>(endpoint, tick);
    const data = pageFetch.data;

    // True only while the reader waits on a page they asked for; a tick asks for the page
    // already shown, so it stays quiet.
    const userBusy = pageFetch.loading && data != null
        && (data.page !== pagination.pageIndex + 1 || data.pageSize !== pagination.pageSize);

    /** Pins the snapshot as the reader navigates, adopting the backend's anchor. */
    const pinAnchor = useCallback(() => {
        // An absolute range already ends at a fixed instant, so there is nothing to pin.
        if (range.kind === 'absolute') return;
        if (!anchor && data?.anchor) setAnchor(data.anchor);
    }, [range.kind, anchor, data]);

    /** Unpins, so the next fetch follows the log again. */
    const dropAnchor = useCallback(() => setAnchor(null), []);

    const entries = useMemo(() => data?.entries ?? NO_ENTRIES, [data?.entries]);

    return {
        range,
        changeRange,
        searchInput,
        setSearchInput,
        search,
        searchField,
        setSearchField,
        pagination,
        setPagination,
        sorting,
        setSorting,
        sortId,
        sortDesc,
        anchor,
        pinAnchor,
        dropAnchor,
        data,
        entries,
        loading: pageFetch.loading,
        error: pageFetch.error,
        userBusy,
        totalCount: data?.totalCount ?? 0,
        // The server decides how deep paging can go (Loki caps a query at 5000 entries), so
        // its page count wins over anything derived from the row count.
        serverPageCount: data?.totalPages ?? 1,
    };
}

// A stable identity for the empty case, so `data` going undefined does not hand the table a
// fresh array and invalidate everything memoised off it.
const NO_ENTRIES: never[] = [];
