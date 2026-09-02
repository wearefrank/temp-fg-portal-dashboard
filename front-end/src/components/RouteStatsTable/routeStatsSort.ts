import type { RouteStats } from './types';

export type SortKey =
    | 'route' | 'live' | 'total' | 'success'
    | 'clientError' | 'serverError' | 'errorRatePercent' | 'avgLatencyMs';

export interface Sort {
    key: SortKey;
    desc: boolean;
}

export const DEFAULT_SORT: Sort = { key: 'total', desc: true };

/** A number is most interesting at its largest, a name at its first letter. */
export function nextSort(current: Sort, key: SortKey): Sort {
    if (current.key === key) return { key, desc: !current.desc };
    return { key, desc: key !== 'route' };
}

export function sortRoutes(routes: RouteStats[], sort: Sort): RouteStats[] {
    return [...routes].sort((a, b) => {
        const left = sortValue(a, sort.key);
        const right = sortValue(b, sort.key);
        const order = typeof left === 'string' && typeof right === 'string'
            ? left.localeCompare(right)
            : Number(left) - Number(right);
        return sort.desc ? -order : order;
    });
}

function sortValue(row: RouteStats, key: SortKey): string | number {
    switch (key) {
        case 'route':
            return (row.routeName ?? row.routeId).toLowerCase();
        // Unknown sorts with the disabled rather than the enabled - it is not a yes.
        case 'live':
            return row.live === true ? 1 : 0;
        // Nothing recorded sorts last however the column is turned: there is no number to
        // rank it by.
        case 'avgLatencyMs':
            return row.avgLatencyMs ?? -1;
        case 'errorRatePercent':
            return row.errorRatePercent ?? -1;
        default:
            return row[key];
    }
}
