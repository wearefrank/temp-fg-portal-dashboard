import React, { useEffect, useRef } from 'react';
import { useFetch } from '../../hooks/useFetch';
import type { LogKind } from './types';
import styles from './LokiLogTable.module.css';

/** Shape of GET /logs/count - the same record MessagesCounter reads. */
interface LogCount {
    count: number;
    query: string;
    windowSeconds: number;
}

interface NewLinesBadgeProps {
    kind: LogKind;
    query?: string;
    search: string;
    /** Nanosecond instant the visible snapshot was cut from. */
    anchor: string;
    refreshKey: number;
    onJump: () => void;
}

/**
 * How many lines have arrived since the snapshot was pinned, and one click back to them.
 *
 * Mounted only while the reader is past page 1, which is what makes the request conditional.
 */
export const NewLinesBadge: React.FC<NewLinesBadgeProps> = ({
    kind,
    query,
    search,
    anchor,
    refreshKey,
    onJump,
}) => {
    // /logs/count runs from an absolute startTime up to now. Nanoseconds to seconds by
    // dropping nine digits, not dividing - a JS number is not exact at that size.
    const params = new URLSearchParams({ type: kind, startTime: anchor.slice(0, -9) || '0' });
    if (query) params.set('query', query);
    if (search) params.set('search', search);
    // Not memoised: useFetch compares the endpoint by value, and an equal string is a no-op.
    const countFetch = useFetch<LogCount>(`/logs/count?${params}`);

    // Recount on each tick. The mount guard is a ref, not `refreshKey === 0`, because this
    // mounts mid-session with the key already past zero.
    const refetchRef = useRef(countFetch.refetch);
    useEffect(() => {
        refetchRef.current = countFetch.refetch;
    });
    const mounted = useRef(false);
    useEffect(() => {
        if (!mounted.current) {
            mounted.current = true;
            return;
        }
        refetchRef.current();
    }, [refreshKey]);

    // Silent until something arrives, and on error - a failed count is not worth an alarm.
    const count = countFetch.error ? 0 : countFetch.data?.count ?? 0;
    if (count === 0) return null;

    return (
        <button type="button" className={styles.newLinesBadge} onClick={onJump}>
            {count.toLocaleString()} new {count === 1 ? 'line' : 'lines'} · back to newest
        </button>
    );
};
