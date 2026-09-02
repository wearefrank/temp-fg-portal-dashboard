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
 * TanStack Table v9 is opt-in per feature, so only what this table uses is bundled. Declared
 * at module scope - rebuilding it per render would hand the table a new identity each time.
 *
 * No filtering features: the search box is LogQL running server-side over the whole window.
 */
export const logTableFeatures = tableFeatures({
    rowExpandingFeature,
    rowPaginationFeature,
    rowSortingFeature,
    columnVisibilityFeature,
    coreRowModel: createCoreRowModel(),
    expandedRowModel: createExpandedRowModel(),
    // Declares the per-column meta this table uses. The value is phantom - only its type
    // survives.
    columnMeta: {} as { align?: 'right'; label?: string },
});
