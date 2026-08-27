import React, { useCallback, useRef, useState } from 'react';
import {
    QUICK_RANGES,
    absoluteProblem,
    fromInputValue,
    inputBounds,
    rangeLabel,
    seedInputs,
    type TimeRange,
} from './timeRange';
import { useDismiss } from './useDismiss';
import styles from './TimeRangePicker.module.css';

interface TimeRangePickerProps {
    value: TimeRange;
    onChange: (next: TimeRange) => void;
}

/** Quick ranges plus an exact from/to, in one dropdown. */
export const TimeRangePicker: React.FC<TimeRangePickerProps> = ({ value, onChange }) => {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const close = useCallback(() => setOpen(false), []);
    useDismiss(wrapRef, open, close);

    // Read once per opening rather than per render, so the ceiling does not move under a
    // half-filled form.
    const [nowMs, setNowMs] = useState(() => Date.now());
    // Both fields always carry a time, so picking a date is enough on its own.
    const [{ from, to }, setFields] = useState(() => seedInputs(value, nowMs));
    const setFrom = (next: string) => setFields(f => ({ ...f, from: next }));
    const setTo = (next: string) => setFields(f => ({ ...f, to: next }));

    // Opening shows what is applied, or today, rather than whatever was typed and left.
    const toggle = () => {
        if (!open) {
            const opened = Date.now();
            setNowMs(opened);
            setFields(seedInputs(value, opened));
        }
        setOpen(o => !o);
    };

    const fromMs = fromInputValue(from);
    const toMs = fromInputValue(to);
    const bounds = inputBounds(fromMs, toMs, nowMs);
    const problem = absoluteProblem(fromMs, toMs, nowMs);

    const applyAbsolute = () => {
        if (problem !== null || fromMs == null || toMs == null) return;
        onChange({ kind: 'absolute', fromMs, toMs });
        setOpen(false);
    };

    const pickQuick = (seconds: number) => {
        onChange({ kind: 'relative', seconds });
        setOpen(false);
    };

    return (
        <div className={styles.wrap} ref={wrapRef}>
            <button
                type="button"
                className={styles.trigger}
                onClick={toggle}
                aria-haspopup="dialog"
                aria-expanded={open}
            >
                <span aria-hidden="true">🕒</span>
                {rangeLabel(value)}
                <span className={styles.caret} aria-hidden="true">▾</span>
            </button>

            {open && (
                <div className={styles.panel} role="dialog" aria-label="Time range">
                    <div className={styles.section}>Absolute range</div>
                    {/* min/max keep the browser's own calendar from offering a window that
                        could never hold logs: a day that has not started, or a start after
                        the end. */}
                    <label className={styles.field}>
                        <span>From</span>
                        <input
                            type="datetime-local"
                            value={from}
                            max={bounds.fromMax}
                            onChange={e => setFrom(e.target.value)}
                        />
                    </label>
                    <label className={styles.field}>
                        <span>To</span>
                        <input
                            type="datetime-local"
                            value={to}
                            min={bounds.toMin}
                            max={bounds.toMax}
                            onChange={e => setTo(e.target.value)}
                        />
                    </label>
                    <div className={styles.applyRow}>
                        <button
                            type="button"
                            className={styles.apply}
                            onClick={applyAbsolute}
                            disabled={problem !== null}
                        >
                            Apply
                        </button>
                        {problem && <span className={styles.invalid}>{problem}</span>}
                    </div>

                    <div className={styles.divider} />

                    <div className={styles.quickList}>
                        {QUICK_RANGES.map(quick => {
                            const selected = value.kind === 'relative' && value.seconds === quick.seconds;
                            return (
                                <button
                                    key={quick.label}
                                    type="button"
                                    className={`${styles.quick} ${selected ? styles.quickActive : ''}`}
                                    aria-pressed={selected}
                                    onClick={() => pickQuick(quick.seconds)}
                                >
                                    {quick.label}
                                    {selected && <span aria-hidden="true">✓</span>}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};
