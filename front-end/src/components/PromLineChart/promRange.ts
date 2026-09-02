/** The windows the range toggle offers, and how each maps onto a Prometheus query. */
export const RANGE_OPTIONS = [
    { label: '1h',  startOffset: 3600,   step: '60',   promRange: '1m',  barWindow: '1h'   },
    { label: '1d',  startOffset: 86400,  step: '300',  promRange: '5m',  barWindow: '1d'   },
    { label: '5d',  startOffset: 432000, step: '1800', promRange: '30m', barWindow: '5d'   },
    // startOffset null means "from epoch" - everything Prometheus still retains.
    { label: 'All', startOffset: null,   step: '3600', promRange: '1h',  barWindow: '365d' },
] as const;

export type RangeLabel = typeof RANGE_OPTIONS[number]['label'];
export type RangeOption = typeof RANGE_OPTIONS[number];

export function findRange(label: RangeLabel): RangeOption {
    return RANGE_OPTIONS.find(option => option.label === label) ?? RANGE_OPTIONS[0];
}
