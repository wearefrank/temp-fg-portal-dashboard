/**
 * The time window a log table is showing, and the conversions between it, the /logs/page
 * query and the strings the UI displays.
 *
 * Kept apart from the component so it can be unit tested.
 */
export type TimeRange =
    | { kind: 'relative'; seconds: number }              // 0 = everything Loki holds
    | { kind: 'absolute'; fromMs: number; toMs: number };

export const QUICK_RANGES = [
    { label: 'Last 5 minutes', seconds: 300 },
    { label: 'Last 15 minutes', seconds: 900 },
    { label: 'Last 1 hour', seconds: 3600 },
    { label: 'Last 3 hours', seconds: 10800 },
    { label: 'Last 6 hours', seconds: 21600 },
    { label: 'Last 12 hours', seconds: 43200 },
    { label: 'Last 24 hours', seconds: 86400 },
    { label: 'Last 2 days', seconds: 172800 },
    { label: 'Last 7 days', seconds: 604800 },
    // { label: 'Everything Loki holds', seconds: 0 },
] as const;

export const DEFAULT_RANGE: TimeRange = { kind: 'relative', seconds: 3600 };

const DAY_MS = 86_400_000;

/**
 * Relative:
 * Absolute:
 */
export function rangeToQuery(range: TimeRange): { windowSeconds: number; anchor: string | null } {
    if (range.kind === 'relative') return { windowSeconds: range.seconds, anchor: null };
    const windowSeconds = Math.max(1, Math.round((range.toMs - range.fromMs) / 1000));
    // Milliseconds to nanoseconds by appending zeros, so the value never passes through a
    // double above 2^53. Multiplying would.
    return { windowSeconds, anchor: `${Math.trunc(range.toMs)}000000` };
}

// Identifies a window. Two different absolute ranges must not compare equal, or the table
// would keep its page number when the window under it changed.
export function rangeKey(range: TimeRange): string {
    return range.kind === 'relative'
        ? `r${range.seconds}`
        : `a${range.fromMs}-${range.toMs}`;
}

export function formatDuration(seconds: number): string {
    if (seconds % 86400 === 0) {
        const days = seconds / 86400;
        return `${days} day${days === 1 ? '' : 's'}`;
    }
    if (seconds % 3600 === 0) {
        const hours = seconds / 3600;
        return `${hours} hour${hours === 1 ? '' : 's'}`;
    }
    const minutes = Math.round(seconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function stamp(ms: number, withDate: boolean): string {
    const d = new Date(ms);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    if (!withDate) return time;
    return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

// The end drops its date when both ends fall on the same day, which is the common case.
export function formatAbsolute(fromMs: number, toMs: number): string {
    const sameDay = new Date(fromMs).toDateString() === new Date(toMs).toDateString();
    return `${stamp(fromMs, true)} → ${stamp(toMs, !sameDay)}`;
}

/** Text for the picker button. */
export function rangeLabel(range: TimeRange): string {
    if (range.kind === 'absolute') return formatAbsolute(range.fromMs, range.toMs);
    const quick = QUICK_RANGES.find(q => q.seconds === range.seconds);
    if (quick) return quick.label;
    return `Last ${formatDuration(range.seconds)}`;
}

/** Reads as part of a sentence: "1-25 of 900 lines in <this>". */
export function describeRange(range: TimeRange): string {
    if (range.kind === 'absolute') return formatAbsolute(range.fromMs, range.toMs);
    if (range.seconds === 0) return 'the retention window';
    return `the last ${formatDuration(range.seconds)}`;
}
/**
 * Whether rows in this window can fall on different days.
 * if there are more than 24 hours we have to show what day it was.
 */
export function spansMoreThanADay(range: TimeRange): boolean {
    if (range.kind === 'relative') return range.seconds === 0 || range.seconds > 86400;

    return range.toMs - range.fromMs > DAY_MS
        || new Date(range.fromMs).toDateString() !== new Date(range.toMs).toDateString();
}

// Shifting by the zone offset makes the UTC string read as the local clock
export function toInputValue(ms: number): string {
    const offsetMs = new Date(ms).getTimezoneOffset() * 60_000;
    return new Date(ms - offsetMs).toISOString().slice(0, 16);
}

export function fromInputValue(value: string): number | null {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? null : ms;
}

// <input type="datetime-local"> steps by a minute unless told otherwise.
const INPUT_STEP_MS = 60_000;

// The times a whole day runs between, so a date on its own is a usable window and the time
// segments never have to be touched.
export const DAY_START_TIME = '00:01';
export const DAY_END_TIME = '23:59';

function dayOf(value: string): string {
    return value.slice(0, 10);
}

// The last minute the picker offers. Later today is allowed - to Loki that just means "up
// to now" - but a day that has not started is not.
function endOfDay(ms: number): string {
    return `${dayOf(toInputValue(ms))}T${DAY_END_TIME}`;
}

/** Today, start to end, as the two input values. */
export function defaultInputs(nowMs: number): { from: string; to: string } {
    const day = dayOf(toInputValue(nowMs));
    return { from: `${day}T${DAY_START_TIME}`, to: `${day}T${DAY_END_TIME}` };
}

/** What the fields show when the panel opens: the applied window, or today if none is. */
export function seedInputs(range: TimeRange, nowMs: number): { from: string; to: string } {
    if (range.kind !== 'absolute') return defaultInputs(nowMs);
    return { from: toInputValue(range.fromMs), to: toInputValue(range.toMs) };
}

export interface InputBounds {
    fromMax: string;
    toMin: string | undefined;
    toMax: string;
}

/**
 * What the two inputs may offer, given what is filled in so far: never a day that has not
 * started, and never a start at or after the end. The browser greys the rest out in its own
 * picker. Comparing the values as strings is comparing them in time, in this format.
 */
export function inputBounds(fromMs: number | null, toMs: number | null, nowMs: number): InputBounds {
    const latest = endOfDay(nowMs);
    const lastStart = toMs != null ? toInputValue(toMs - INPUT_STEP_MS) : null;
    return {
        fromMax: lastStart != null && lastStart < latest ? lastStart : latest,
        toMin: fromMs != null ? toInputValue(fromMs + INPUT_STEP_MS) : undefined,
        toMax: latest,
    };
}

/** Why the pair cannot be applied, or null when it can. */
export function absoluteProblem(fromMs: number | null, toMs: number | null, nowMs: number): string | null {
    if (fromMs == null || toMs == null) return 'Pick a start and an end';
    if (fromMs >= toMs) return 'The start must come first';
    if (toInputValue(toMs) > endOfDay(nowMs)) return 'That day has not started yet';
    return null;
}

/**
 * Persisted per log kind under its own key rather than through useAppSettings: that hook
 * writes the whole settings blob from a copy each caller holds privately, so the two tables
 * would overwrite each other.
 */
const STORAGE_PREFIX = 'fg-log-range:';

export function loadRange(kind: string): TimeRange | null {
    try {
        const raw = localStorage.getItem(STORAGE_PREFIX + kind);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return isTimeRange(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export function saveRange(kind: string, range: TimeRange): void {
    try {
        localStorage.setItem(STORAGE_PREFIX + kind, JSON.stringify(range));
    } catch {
        // Storage can be unavailable or full; the range just does not outlive the session.
    }
}

/**
 * How long after a window closes it can still gain lines.
 *
 * The gateway's loki-logger plugin batches before pushing - buffer_duration is 60s in the
 * production config (see the plugin block in config/apisix.yaml) - so a request served just
 * before a window's end can reach Loki a minute after it. Five minutes clears that with room
 * to spare, and nothing is lost by waiting: this only decides whether a panel keeps asking.
 */
const SETTLED_AFTER_MS = 5 * 60 * 1000;

/**
 * Whether asking again could return anything new.
 *
 * A relative window moves with the clock, so it always can. An absolute one is fixed in the
 * past: once the log has settled behind it, every refresh re-runs the same query for the same
 * answer - which for an aggregate over a week is a real amount of work Loki does for nothing.
 *
 * A panel on a periodic timer should check this before refetching. It is not a cache: the
 * reader asking for a refresh, or changing the window, should still go and look.
 */
export function rangeCanChange(range: TimeRange, nowMs: number): boolean {
    if (range.kind === 'relative') return true;
    return range.toMs > nowMs - SETTLED_AFTER_MS;
}

function isTimeRange(value: unknown): value is TimeRange {
    if (typeof value !== 'object' || value === null) return false;
    const r = value as Record<string, unknown>;
    if (r.kind === 'relative') return typeof r.seconds === 'number' && Number.isFinite(r.seconds);
    if (r.kind === 'absolute') {
        return typeof r.fromMs === 'number' && Number.isFinite(r.fromMs)
            && typeof r.toMs === 'number' && Number.isFinite(r.toMs)
            && r.fromMs < r.toMs;
    }
    return false;
}
