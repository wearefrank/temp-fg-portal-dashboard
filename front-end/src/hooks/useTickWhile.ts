import { useState } from 'react';

/**
 * The dashboard's tick, passed on while `follow` and frozen at the last one otherwise.
 * Freezing is what stops the refetch - useFetch only looks again when the number changes -
 * so a tick arriving while a panel is not following is held, not lost.
 */
export function useTickWhile(refreshKey: number, follow: boolean): number {
    const [tick, setTick] = useState(refreshKey);

    // Set during the render that brings the tick, so the fetch goes out with it.
    if (follow && tick !== refreshKey) {
        setTick(refreshKey);
    }

    return tick;
}
