import { rangeKey, type TimeRange } from '../TimeRangePicker/timeRange';

export interface ApplyToLogsState {
    show: boolean;
    disabled: boolean;
    label: string;
    /** button's tooltip. */
    title: string;
}

/** Whether two windows describe the same span. */
export function sameRange(a: TimeRange | null, b: TimeRange | null): boolean {
    if (!a || !b) return false;
    return rangeKey(a) === rangeKey(b);
}

export function applyToLogsState(
    chartRange: TimeRange,
    appliedRange: TimeRange | null,
): ApplyToLogsState {
    return {
        show: true,
        disabled: sameRange(chartRange, appliedRange),
        label: 'Narrow log below',
        title: 'Narrow the log below to this window',
    };
}
