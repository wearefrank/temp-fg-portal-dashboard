/** An elided run of page numbers. */
export const GAP = '…';

export type PageItem = number | typeof GAP;

/**
 * Page numbers to draw: the first, the last, the current and its neighbours, with a gap for
 * the runs left out. Drawing all of them is unusable once a window holds a few thousand lines.
 */
export function pageItems(current: number, total: number): PageItem[] {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const wanted = new Set([1, total, current, current - 1, current + 1]);
    const pages = [...wanted].filter(page => page >= 1 && page <= total).sort((a, b) => a - b);

    const items: PageItem[] = [];
    pages.forEach((page, i) => {
        if (i > 0 && page - pages[i - 1] > 1) items.push(GAP);
        items.push(page);
    });
    return items;
}
