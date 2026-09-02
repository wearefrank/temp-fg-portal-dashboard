import { memo } from 'react';
import { useTable } from '@tanstack/react-table';
import { TimeRangePicker } from '../TimeRangePicker/TimeRangePicker';
import type { TimeRange } from '../TimeRangePicker/timeRange';
import { logTableFeatures } from './features';
import { useLogPage } from './useLogPage';
import { useLogColumns } from './useLogColumns';
import { useNamespaceFilter } from './useNamespaceFilter';
import { describeOrder, logSubtitle } from './logSubtitle';
import { NamespaceFilter } from './NamespaceFilter';
import { LogSearchBox } from './LogSearchBox';
import { SearchScope, type SearchScopeOption } from './SearchScope';
import { ColumnsMenu, type ColumnToggle } from './ColumnsMenu';
import { PageSizeSelect } from './PageSizeSelect';
import { MatchCount } from './MatchCount';
import { LogTable } from './LogTable';
import { LogPager } from './LogPager';
import { NewLinesBadge } from './NewLinesBadge';
import type { LogKind } from './types';
import styles from './LokiLogTable.module.css';

export type { LogEntry, LogKind, LogPage } from './types';

interface LokiLogTableProps {
    title: string;
    /** Which of the gateway's two streams to read: it picks the selector and the columns. */
    kind: LogKind;
    /** A LogQL selector overriding the one `kind` would pick. */
    query?: string;
    defaultPageSize?: number;
    defaultRange?: TimeRange;
    search?: string;
    range?: TimeRange;
    refreshKey: number;
}

/**
 * A page of one of the gateway's Loki log streams, with a time range, a search, a namespace
 * filter and sortable columns. Everything but the namespace filter is resolved server-side.
 */
const LokiLogTablePanel = ({
    title,
    kind,
    query,
    defaultPageSize = 25,
    defaultRange,
    search: searchProp,
    range: rangeProp,
    refreshKey,
}: LokiLogTableProps) => {
    const log = useLogPage({
        kind,
        query,
        defaultPageSize,
        defaultRange,
        searchProp,
        rangeProp,
        refreshKey,
    });
    const namespaces = useNamespaceFilter(log.entries);
    const { fields, fieldsError, columns, columnVisibility, setColumnVisibility } =
        useLogColumns(kind, log.entries, log.range);

    const table = useTable({
        features: logTableFeatures,
        columns,
        data: namespaces.visibleEntries,
        // Manual, because the rows here are one page of a log that lives in Loki. Left
        // automatic, the table would page and sort twenty-five rows and present that as if it
        // had done so across the whole window.
        manualPagination: true,
        manualSorting: true,
        // The server orders by a single `sort`, so a second sort key is a control it cannot
        // honour, and clearing the sort would only fall back to time anyway.
        enableMultiSort: false,
        enableSortingRemoval: false,
        pageCount: log.serverPageCount,
        rowCount: log.totalCount,
        state: { pagination: log.pagination, sorting: log.sorting, columnVisibility },
        onPaginationChange: log.setPagination,
        onSortingChange: log.setSorting,
        onColumnVisibilityChange: setColumnVisibility,
        getRowCanExpand: () => true,
        // tsNanos is unique per line in practice; the index keeps the id stable for the rare
        // pair that shares a nanosecond.
        getRowId: (row, index) => `${row.tsNanos}-${index}`,
    });

    const currentPage = log.pagination.pageIndex + 1;
    const pageCount = table.getPageCount();

    // Every navigation pins the snapshot first, so lines arriving mid-session cannot shift
    // rows between pages.
    const goToPage = (page: number) => {
        log.pinAnchor();
        table.setPageIndex(page - 1);
    };

    const changePageSize = (size: number) => {
        log.pinAnchor();
        table.setPageSize(size);
    };

    // Drops the pin and follows the log again.
    const goToNewest = () => {
        log.dropAnchor();
        table.setPageIndex(0);
    };

    const columnToggles: ColumnToggle[] = table.getAllLeafColumns()
        // The expander is structural, not a column anyone chooses.
        .filter(column => column.id !== 'expander')
        .map(column => ({
            id: column.id,
            label: column.columnDef.meta?.label ?? column.id,
            visible: column.getIsVisible(),
            toggle: () => column.toggleVisibility(),
        }));

    const searchColumns: SearchScopeOption[] = columnToggles
        .filter(column => column.id !== 'timestamp')
        .map(({ id, label }) => ({ id, label }));

    const searchedColumn = searchColumns.find(column => column.id === log.searchField);

    const subtitle = logSubtitle({
        kind,
        range: log.range,
        search: log.search,
        searchColumn: searchedColumn?.label ?? '',
        fieldsFailed: fieldsError != null,
        loading: log.loading,
        failed: log.error != null,
        hasData: log.data != null,
        totalCount: log.totalCount,
        page: log.data?.page ?? 1,
        pageSize: log.data?.pageSize ?? log.pagination.pageSize,
        rowsOnPage: log.entries.length,
        order: describeOrder(
            log.sortId,
            log.sortDesc,
            table.getColumn(log.sortId)?.columnDef.meta?.label ?? log.sortId,
        ),
        namespace: namespaces.namespace,
        namespaceCount: namespaces.visibleEntries.length,
    });

    // Waits on the descriptors as well as the rows: the columns come from them, so drawing
    // early means a three-column table widening under the reader a moment later.
    const showTable = fields != null && (log.entries.length > 0 || log.loading);
    // Only where the table has stopped following the log: a relative window, past page 1.
    const showNewLines = log.range.kind === 'relative' && log.anchor != null && currentPage !== 1;

    return (
        <div className={`card ${styles.fullWidthCard}`}>
            <div className="card-header">{title}</div>
            {/* Always rendered, so switching it on costs no layout shift. The only visible
                sign of a background refresh. */}
            <div
                className={`${styles.progressBar} ${log.loading ? styles.progressBarActive : ''}`}
                aria-hidden="true"
            />

            <div className={styles.controls}>
                <TimeRangePicker value={log.range} onChange={log.changeRange} />
                <NamespaceFilter
                    namespaces={namespaces.known}
                    value={namespaces.namespace}
                    onChange={namespaces.setNamespace}
                />
                <SearchScope
                    columns={searchColumns}
                    value={log.searchField}
                    onChange={log.setSearchField}
                />
                <LogSearchBox value={log.searchInput} onChange={log.setSearchInput} />
                <ColumnsMenu columns={columnToggles} />
                <PageSizeSelect value={log.pagination.pageSize} onChange={changePageSize} />
                <MatchCount
                    count={log.totalCount}
                    firstLoad={log.loading && log.data == null}
                    failed={log.error != null}
                    hasData={log.data != null}
                />
            </div>

            <div className={`text-small text-muted ${styles.emptyHint}`}>{subtitle}</div>

            <div
                className={`${styles.tableArea} ${log.userBusy ? styles.tableAreaBusy : ''}`}
                aria-busy={log.loading}
            >
                {showTable && (
                    <LogTable
                        table={table}
                        showSkeleton={log.entries.length === 0}
                        onSort={log.pinAnchor}
                    />
                )}
            </div>

            {pageCount > 1 && (
                <LogPager
                    currentPage={currentPage}
                    pageCount={pageCount}
                    pageSize={log.pagination.pageSize}
                    busy={log.userBusy}
                    onGoTo={goToPage}
                    depthCapped={log.data?.depthCapped ?? false}
                    sortedByTime={log.sortId === 'timestamp'}
                    badge={showNewLines && (
                        <NewLinesBadge
                            kind={kind}
                            query={query}
                            search={log.search}
                            searchField={log.searchField}
                            anchor={log.anchor!}
                            refreshKey={refreshKey}
                            onJump={goToNewest}
                        />
                    )}
                />
            )}
        </div>
    );
};

export const LokiLogTable = memo(LokiLogTablePanel);