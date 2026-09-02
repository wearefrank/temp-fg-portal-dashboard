import type { RouteStats } from './types';

/** Nothing to show reads better than a zero. */
export const DASH = '—';

export const NO_ROUTE_LABEL = '(no route)';

/** What to call a route in prose: its name, else its id, else what it plainly is. */
export function routeLabel(route: RouteStats): string {
    if (route.routeId === '') return NO_ROUTE_LABEL;
    return route.routeName ?? route.routeId;
}

/**
 * A rate, to a tenth. A handful of failures in a hundred thousand rounds to 0.0%, which next
 * to a non-zero count reads as a contradiction - so it is shown as below the resolution.
 */
export function ratePercent(rate: number | null, count: number): string {
    if (rate === null) return DASH;
    if (rate === 0 && count > 0) return '<0.1%';
    return `${rate}%`;
}

/**
 * The status codes behind a cell, as "401 × 42, 403 × 3", for its tooltip. Without a digit it
 * lists all of them - which is what Total wants, since 1xx and 3xx have no column of their own.
 */
export function breakdown(byStatus: Record<string, number>, leadingDigit?: string): string {
    const codes = Object.keys(byStatus)
        .filter(code => leadingDigit === undefined || code.startsWith(leadingDigit))
        .sort();
    return codes.map(code => `${code} × ${byStatus[code].toLocaleString()}`).join(', ');
}
