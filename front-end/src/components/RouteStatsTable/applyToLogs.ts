import { rangeKey } from '../TimeRangePicker/timeRange';
import type { LogFilter } from './types';

export interface ApplyToLogsState {
    disabled: boolean;
    label: string;
    /** button's tooltip. */
    title: string;
}

/**
 * Whether two filters describe the same window and the same route. Routes compare by id,
 * not by object - a refetch hands back new RouteStats for the same route.
 */
export function sameFilter(a: LogFilter | null, b: LogFilter | null): boolean {
    if (!a || !b) return false;
    if (rangeKey(a.range) !== rangeKey(b.range)) return false;
    return (a.route?.routeId ?? null) === (b.route?.routeId ?? null);
}

export function applyToLogsState(
    current: LogFilter,
    applied: LogFilter | null,
    synced: boolean,
): ApplyToLogsState {
    if (synced) {
        return {
            disabled: true,
            label: 'Filter syncing to logs',
            title: ''
        };
    }

    return {
        disabled: sameFilter(current, applied),
        label: 'Narrow log below',
        title: 'Narrow the log below to this window',
    };
}
