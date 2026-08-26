import {
    columnVisibilityFeature,
    createCoreRowModel,
    createExpandedRowModel,
    rowExpandingFeature,
    rowPaginationFeature,
    rowSortingFeature,
    tableFeatures,
} from '@tanstack/react-table';

/**
 * TanStack Table v9 is opt-in per feature: nothing beyond the core is bundled unless it is
 * named here, which is what keeps the shipped code to the features this table actually uses.
 *
 * Declared at module scope on purpose - the helper's docs call for it, and rebuilding the
 * feature set on every render would hand the table a new identity each time.
 *
 * Both pagination and sorting run in manual mode. The rows in the browser are one page of a
 * log that lives in Loki, so letting either operate on them locally would produce controls
 * that silently only apply to the page you happen to be looking at. Sorting maps to Loki's
 * `direction`; paging maps to the numbered page endpoint.
 *
 * Deliberately absent: columnFilteringFeature and globalFilteringFeature. Filtering is the
 * search box, and that is LogQL running server-side over the whole window.
 */
export const logTableFeatures = tableFeatures({
    rowExpandingFeature,
    rowPaginationFeature,
    rowSortingFeature,
    columnVisibilityFeature,
    coreRowModel: createCoreRowModel(),
    expandedRowModel: createExpandedRowModel(),
    // Declares the per-column meta this table uses, without global declaration merging.
    // The value is phantom - only its type survives.
    columnMeta: {} as { align?: 'right'; label?: string },
});
