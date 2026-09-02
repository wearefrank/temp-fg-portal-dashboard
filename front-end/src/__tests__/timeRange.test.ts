import { describe, it, expect, beforeEach } from 'vitest';
import {
    DEFAULT_RANGE,
    absoluteProblem,
    defaultInputs,
    describeRange,
    formatDuration,
    fromInputValue,
    inputBounds,
    loadRange,
    seedInputs,
    rangeCanChange,
    rangeKey,
    rangeLabel,
    rangeToQuery,
    saveRange,
    spansMoreThanADay,
    toInputValue,
    type TimeRange,
} from '../components/TimeRangePicker/timeRange';

// The vitest environment is "node", so there is no localStorage to read.
function installLocalStorage(): void {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
        key: (index: number) => [...store.keys()][index] ?? null,
        get length() { return store.size; },
    } as Storage;
}

describe('rangeToQuery', () => {
    it('sends a relative range as a duration with no anchor', () => {
        expect(rangeToQuery({ kind: 'relative', seconds: 300 }))
            .toEqual({ windowSeconds: 300, anchor: null });
    });

    it('keeps 0 as 0, which the backend reads as the retention window', () => {
        expect(rangeToQuery({ kind: 'relative', seconds: 0 }))
            .toEqual({ windowSeconds: 0, anchor: null });
    });

    it('turns an absolute range into a length plus the instant it ends at', () => {
        const fromMs = 1_756_281_600_000;
        const toMs = 1_756_287_000_000;
        expect(rangeToQuery({ kind: 'absolute', fromMs, toMs }))
            .toEqual({ windowSeconds: 5400, anchor: '1756287000000000000' });
    });

    it('builds the anchor as the millisecond digits with six zeros appended', () => {
        const toMs = 1_756_287_000_123;
        const { anchor } = rangeToQuery({ kind: 'absolute', fromMs: toMs - 1000, toMs });
        expect(anchor).toBe('1756287000123000000');
        // Exact by construction: the value never passes through a double above 2^53.
        expect(anchor).toBe(`${toMs}000000`);
        expect(anchor).toHaveLength(String(toMs).length + 6);
    });

    it('never asks for a window shorter than a second', () => {
        expect(rangeToQuery({ kind: 'absolute', fromMs: 1000, toMs: 1100 }).windowSeconds).toBe(1);
    });
});

describe('rangeKey', () => {
    it('tells two different absolute ranges apart', () => {
        const a: TimeRange = { kind: 'absolute', fromMs: 1000, toMs: 2000 };
        const b: TimeRange = { kind: 'absolute', fromMs: 3000, toMs: 4000 };
        expect(rangeKey(a)).not.toBe(rangeKey(b));
    });

    it('tells a relative range apart from an absolute one', () => {
        expect(rangeKey({ kind: 'relative', seconds: 3600 }))
            .not.toBe(rangeKey({ kind: 'absolute', fromMs: 0, toMs: 3_600_000 }));
    });

    it('is stable for the same range', () => {
        expect(rangeKey({ kind: 'relative', seconds: 3600 }))
            .toBe(rangeKey({ kind: 'relative', seconds: 3600 }));
    });
});

describe('formatDuration', () => {
    it('picks the largest whole unit', () => {
        expect(formatDuration(300)).toBe('5 minutes');
        expect(formatDuration(3600)).toBe('1 hour');
        expect(formatDuration(21600)).toBe('6 hours');
        expect(formatDuration(86400)).toBe('1 day');
        expect(formatDuration(604800)).toBe('7 days');
    });
});

describe('describeRange', () => {
    it('names the retention window for 0', () => {
        expect(describeRange({ kind: 'relative', seconds: 0 })).toBe('the retention window');
    });

    it('reads as part of a sentence for a relative range', () => {
        expect(describeRange({ kind: 'relative', seconds: 21600 })).toBe('the last 6 hours');
    });

    it('shows both ends of an absolute range', () => {
        const from = new Date(2026, 7, 27, 9, 0).getTime();
        const to = new Date(2026, 7, 27, 10, 30).getTime();
        expect(describeRange({ kind: 'absolute', fromMs: from, toMs: to })).toContain('→');
    });
});

describe('rangeLabel', () => {
    it('uses the quick range name when the seconds match one', () => {
        expect(rangeLabel(DEFAULT_RANGE)).toBe('Last 1 hour');
    });

    it('falls back to a duration for seconds no quick range covers', () => {
        expect(rangeLabel({ kind: 'relative', seconds: 7200 })).toBe('Last 2 hours');
    });
});

describe('spansMoreThanADay', () => {
    it('is false for a window of a day or less', () => {
        expect(spansMoreThanADay({ kind: 'relative', seconds: 3600 })).toBe(false);
        expect(spansMoreThanADay({ kind: 'relative', seconds: 86400 })).toBe(false);
    });

    it('is true for the retention window and anything longer than a day', () => {
        expect(spansMoreThanADay({ kind: 'relative', seconds: 0 })).toBe(true);
        expect(spansMoreThanADay({ kind: 'relative', seconds: 604800 })).toBe(true);
    });

    it('is true for a short absolute window that still crosses midnight', () => {
        const from = new Date(2026, 7, 27, 23, 30).getTime();
        const to = new Date(2026, 7, 28, 0, 30).getTime();
        expect(spansMoreThanADay({ kind: 'absolute', fromMs: from, toMs: to })).toBe(true);
    });

    it('is false for an absolute window inside one day', () => {
        const from = new Date(2026, 7, 27, 9, 0).getTime();
        const to = new Date(2026, 7, 27, 17, 0).getTime();
        expect(spansMoreThanADay({ kind: 'absolute', fromMs: from, toMs: to })).toBe(false);
    });
});

describe('datetime-local values', () => {
    it('round trips through the input format in local time', () => {
        const ms = new Date(2026, 7, 27, 9, 5).getTime();
        expect(fromInputValue(toInputValue(ms))).toBe(ms);
    });

    it('pads month, day, hour and minute to two digits', () => {
        expect(toInputValue(new Date(2026, 0, 2, 3, 4).getTime())).toBe('2026-01-02T03:04');
    });

    it('returns null for empty or unparseable input', () => {
        expect(fromInputValue('')).toBeNull();
        expect(fromInputValue('not a date')).toBeNull();
    });
});

describe('defaultInputs / seedInputs', () => {
    const now = new Date(2026, 7, 27, 14, 0).getTime();

    it('offers the whole of today, so a date needs no time typed after it', () => {
        expect(defaultInputs(now)).toEqual({ from: '2026-08-27T00:01', to: '2026-08-27T23:59' });
    });

    it('seeds today for a relative range', () => {
        expect(seedInputs({ kind: 'relative', seconds: 3600 }, now)).toEqual(defaultInputs(now));
    });

    it('seeds an applied absolute range from its own ends', () => {
        const fromMs = new Date(2026, 7, 20, 9, 30).getTime();
        const toMs = new Date(2026, 7, 21, 17, 0).getTime();
        expect(seedInputs({ kind: 'absolute', fromMs, toMs }, now))
            .toEqual({ from: '2026-08-20T09:30', to: '2026-08-21T17:00' });
    });
});

describe('inputBounds', () => {
    const now = new Date(2026, 7, 27, 14, 0).getTime();

    it('caps both ends at the end of today while nothing is filled in', () => {
        const bounds = inputBounds(null, null, now);
        expect(bounds.fromMax).toBe('2026-08-27T23:59');
        expect(bounds.toMax).toBe('2026-08-27T23:59');
        expect(bounds.toMin).toBeUndefined();
    });

    it('leaves the seeded whole day inside its own bounds', () => {
        const { from, to } = defaultInputs(now);
        const bounds = inputBounds(fromInputValue(from), fromInputValue(to), now);
        expect(from <= bounds.fromMax).toBe(true);
        expect(to <= bounds.toMax).toBe(true);
        expect(to >= bounds.toMin!).toBe(true);
    });

    it('holds the end a minute past the start once a start is picked', () => {
        const from = new Date(2026, 7, 27, 9, 0).getTime();
        expect(inputBounds(from, null, now).toMin).toBe('2026-08-27T09:01');
    });

    it('holds the start a minute before the end once an end is picked', () => {
        const to = new Date(2026, 7, 27, 9, 0).getTime();
        expect(inputBounds(null, to, now).fromMax).toBe('2026-08-27T08:59');
    });

    it('keeps the end of today as the start ceiling when a typed end is beyond it', () => {
        const to = new Date(2026, 7, 28, 9, 0).getTime();
        expect(inputBounds(null, to, now).fromMax).toBe('2026-08-27T23:59');
    });
});

describe('absoluteProblem', () => {
    const now = new Date(2026, 7, 27, 14, 0).getTime();
    const at = (h: number) => new Date(2026, 7, 27, h, 0).getTime();

    it('asks for both ends while one is missing', () => {
        expect(absoluteProblem(null, at(10), now)).toBe('Pick a start and an end');
        expect(absoluteProblem(at(10), null, now)).toBe('Pick a start and an end');
    });

    it('rejects a start at or after the end', () => {
        expect(absoluteProblem(at(11), at(10), now)).toBe('The start must come first');
        expect(absoluteProblem(at(10), at(10), now)).toBe('The start must come first');
    });

    it('rejects an end on a day that has not started', () => {
        const tomorrow = new Date(2026, 7, 28, 9, 0).getTime();
        expect(absoluteProblem(at(10), tomorrow, now)).toBe('That day has not started yet');
    });

    it('accepts the rest of today, which Loki reads as "up to now"', () => {
        const { from, to } = defaultInputs(now);
        expect(absoluteProblem(fromInputValue(from), fromInputValue(to), now)).toBeNull();
    });

    it('accepts a window that has already passed', () => {
        expect(absoluteProblem(at(10), at(12), now)).toBeNull();
        expect(absoluteProblem(at(10), now, now)).toBeNull();
    });
});

describe('loadRange / saveRange', () => {
    beforeEach(installLocalStorage);

    it('returns null when nothing is stored', () => {
        expect(loadRange('audit')).toBeNull();
    });

    it('round trips a relative range', () => {
        const range: TimeRange = { kind: 'relative', seconds: 900 };
        saveRange('audit', range);
        expect(loadRange('audit')).toEqual(range);
    });

    it('round trips an absolute range', () => {
        const range: TimeRange = { kind: 'absolute', fromMs: 1000, toMs: 2000 };
        saveRange('error', range);
        expect(loadRange('error')).toEqual(range);
    });

    it('keeps the two log kinds apart', () => {
        saveRange('audit', { kind: 'relative', seconds: 300 });
        saveRange('error', { kind: 'relative', seconds: 86400 });
        expect(loadRange('audit')).toEqual({ kind: 'relative', seconds: 300 });
        expect(loadRange('error')).toEqual({ kind: 'relative', seconds: 86400 });
    });

    it('returns null for corrupt or wrong-shaped storage', () => {
        localStorage.setItem('fg-log-range:audit', 'not json');
        expect(loadRange('audit')).toBeNull();

        localStorage.setItem('fg-log-range:audit', JSON.stringify({ kind: 'relative' }));
        expect(loadRange('audit')).toBeNull();

        localStorage.setItem('fg-log-range:audit', JSON.stringify({ kind: 'nonsense' }));
        expect(loadRange('audit')).toBeNull();

        // An inverted absolute range would produce a negative windowSeconds, which the
        // backend turns into a 502.
        localStorage.setItem('fg-log-range:audit', JSON.stringify({ kind: 'absolute', fromMs: 2000, toMs: 1000 }));
        expect(loadRange('audit')).toBeNull();
    });
});

describe('rangeCanChange', () => {
    const NOW = 1_700_000_000_000;
    const MINUTE = 60_000;

    /** It moves with the clock, so there is always something new at the near end. */
    it('is always true for a relative range', () => {
        expect(rangeCanChange({ kind: 'relative', seconds: 3600 }, NOW)).toBe(true);
        // 0 is the retention window, which also ends at now.
        expect(rangeCanChange({ kind: 'relative', seconds: 0 }, NOW)).toBe(true);
    });

    /**
     * The gateway batches before pushing, so a window that closed moments ago can still gain
     * the requests served just before it did.
     */
    it('is true for an absolute range that only just closed', () => {
        expect(rangeCanChange({ kind: 'absolute', fromMs: NOW - MINUTE * 60, toMs: NOW }, NOW)).toBe(true);
        expect(rangeCanChange({ kind: 'absolute', fromMs: NOW - MINUTE * 60, toMs: NOW - MINUTE * 4 }, NOW))
            .toBe(true);
    });

    /** Past the settling time it can only ever answer the same, so polling it is waste. */
    it('is false once an absolute range has settled', () => {
        expect(rangeCanChange({ kind: 'absolute', fromMs: NOW - MINUTE * 60, toMs: NOW - MINUTE * 6 }, NOW))
            .toBe(false);
        expect(rangeCanChange({ kind: 'absolute', fromMs: NOW - MINUTE * 600, toMs: NOW - MINUTE * 500 }, NOW))
            .toBe(false);
    });

    /** A window ending in the future has certainly not closed. */
    it('is true for an absolute range that has not ended yet', () => {
        expect(rangeCanChange({ kind: 'absolute', fromMs: NOW, toMs: NOW + MINUTE * 10 }, NOW)).toBe(true);
    });
});
