import { type ReactNode } from 'react';
import styles from './Dashboard.module.css';

interface LiveCardProps<T> {
    title: string;
    state: { data: T[] | null; loading: boolean; error: string | null };
    emptyText: string;
    /** Set the key on whatever you return - these are rendered as a list. */
    renderItem: (item: T) => ReactNode;
}

/** A card listing what APISIX currently has loaded, with the one set of empty states. */
export function LiveCard<T>({ title, state, emptyText, renderItem }: LiveCardProps<T>) {
    return (
        <div className="card">
            <div className="card-header">{title}</div>
            {body(state, emptyText, renderItem)}
        </div>
    );
}

function body<T>(
    state: LiveCardProps<T>['state'],
    emptyText: string,
    renderItem: (item: T) => ReactNode,
): ReactNode {
    // First load only - useFetch keeps the last rows through a refetch, so checking `loading`
    // alone flashed this above them every tick.
    if (state.loading && !state.data) return <Hint>Loading...</Hint>;
    if (state.error) return <Hint>Unavailable</Hint>;
    if (!Array.isArray(state.data)) return null;
    if (state.data.length === 0) return <Hint>{emptyText}</Hint>;
    return <>{state.data.map(renderItem)}</>;
}

const Hint = ({ children }: { children: ReactNode }) => (
    <div className={`text-small text-muted ${styles.emptyHint}`}>{children}</div>
);
