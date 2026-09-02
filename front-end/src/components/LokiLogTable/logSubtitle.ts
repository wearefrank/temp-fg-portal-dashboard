import { describeRange, type TimeRange } from '../TimeRangePicker/timeRange';
import { ALL_NAMESPACES } from './useNamespaceFilter';
import type { LogKind } from './types';

// What an empty result means, per kind. An empty error log is good news and should not read
// like something is misconfigured.
const EMPTY_HINT: Record<LogKind, string> = {
    audit: 'No log lines yet — send requests through APISIX to populate this table',
    error: 'No errors logged in this window',
};

export interface LogSubtitleInput {
    kind: LogKind;
    range: TimeRange;
    search: string;
    /** Label of the column the search is confined to, empty for the whole line. */
    searchColumn: string;
    /** The columns fetch failed, so the table cannot be drawn at all. */
    fieldsFailed: boolean;
    loading: boolean;
    failed: boolean;
    hasData: boolean;
    totalCount: number;
    /** One-based, as the server reports it. */
    page: number;
    pageSize: number;
    rowsOnPage: number;
    order: string;
    namespace: string;
    namespaceCount: number;
}

/** How the sort reads in prose. Time is an age; anything else is a column and an arrow. */
export function describeOrder(sortId: string, sortDesc: boolean, columnLabel: string): string {
    if (sortId === 'timestamp') return sortDesc ? 'newest first' : 'oldest first';
    return `by ${columnLabel} ${sortDesc ? '↓' : '↑'}`;
}

/** The line under the toolbar: what is on screen, out of what, over which window. */
export function logSubtitle(input: LogSubtitleInput): string {
    // First, because the table is gated on the descriptors - an empty card saying "no lines"
    // would blame Loki for a column problem.
    if (input.fieldsFailed) return 'Columns unavailable — cannot draw the table';
    if (input.loading && !input.hasData) return 'Loading…';
    if (input.failed) return 'Loki unavailable';
    if (input.totalCount === 0 && input.search) {
        return `No lines match "${input.search}"${describeScope(input)} in this window`;
    }
    if (input.totalCount === 0) return EMPTY_HINT[input.kind];

    const first = (input.page - 1) * input.pageSize + 1;
    const last = first + input.rowsOnPage - 1;
    const filter = input.search ? ` matching "${input.search}"${describeScope(input)}` : '';

    return `${first.toLocaleString()}–${last.toLocaleString()} of ${input.totalCount.toLocaleString()}`
        + ` lines${filter} in ${describeRange(input.range)} · ${input.order}${namespaceNote(input)}`;
}

/** Which column the term was looked for in, when it was not the whole line. */
function describeScope(input: LogSubtitleInput): string {
    return input.searchColumn ? ` in ${input.searchColumn}` : '';
}

/**
 * The count and the span are the server's, and the namespace picker does not reach them - it
 * only hides rows of this page. Said out loud, or the total reads as disagreeing with the rows.
 */
function namespaceNote(input: LogSubtitleInput): string {
    if (input.namespace === ALL_NAMESPACES) return '';
    return ` · showing the ${input.namespaceCount.toLocaleString()} from ${input.namespace}`;
}
