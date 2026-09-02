import { useEffect, useState } from 'react';

const REFRESH_SECONDS = 60;

/**
 * The dashboard's clock. Panels hand the tick to useFetch, so this never knows who listens.
 *
 * The tick is the instant it fired rather than a counter: the same "look again" signal, and
 * the clock reading for panels that need one without calling Date.now() during a render.
 */
export function useDashboardRefresh(): number {
    const [firedAt, setFiredAt] = useState(() => Date.now());

    useEffect(() => {
        const refresh = setInterval(() => setFiredAt(Date.now()), REFRESH_SECONDS * 1000);
        return () => clearInterval(refresh);
    }, []);

    return firedAt;
}

/**
 * Seconds until the next refresh, counted down where it is drawn rather than on the dashboard.
 *
 * Held apart on purpose: this changes every second, and a second of state on the dashboard is
 * a second of re-rendering the chart, the log table and every card under them - which is felt
 * as the whole page hitching once a second, hover effects included.
 */
export function useRefreshCountdown(refreshKey: number): number {
    const [left, setLeft] = useState(REFRESH_SECONDS);
    const [countedFor, setCountedFor] = useState(refreshKey);

    // Restarted during the render that brings the new tick, rather than from an effect: React
    // re-runs this straight away, so the old count is never painted.
    if (countedFor !== refreshKey) {
        setCountedFor(refreshKey);
        setLeft(REFRESH_SECONDS);
    }

    useEffect(() => {
        const tick = setInterval(() => setLeft(seconds => Math.max(0, seconds - 1)), 1_000);
        return () => clearInterval(tick);
    }, []);

    return left;
}
