import type { ChartTooltipEntry } from './ChartTooltip';

/** The part of recharts' tooltip argument our charts read. */
export interface TooltipCallbackProps {
    active?: boolean;
    payload?: ReadonlyArray<{ dataKey?: unknown; color?: string; value?: unknown }>;
    label?: unknown;
}

interface EntryOptions {
    /** How a series key reads in the tooltip. Defaults to the key itself. */
    display?: (key: string) => string;
    /** Drop zero-valued series, which a stacked chart is otherwise full of. */
    skipZero?: boolean;
    /** Recharts hands a stack over bottom-up; the tooltip reads better top-down. */
    reverse?: boolean;
}

/** Turns recharts' payload into the entries ChartTooltip draws. */
export function toTooltipEntries(
    payload: TooltipCallbackProps['payload'],
    options: EntryOptions = {},
): ChartTooltipEntry[] {
    const { display = (key: string) => key, skipZero = false, reverse = false } = options;

    const entries = (payload ?? [])
        .filter(item => item.value != null)
        .filter(item => !skipZero || Number(item.value) > 0)
        .map(item => ({
            key: String(item.dataKey),
            label: display(String(item.dataKey)),
            color: item.color ?? '',
            value: Number(item.value),
        }));

    return reverse ? entries.reverse() : entries;
}
