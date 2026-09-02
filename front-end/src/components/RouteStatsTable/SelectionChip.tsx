import { routeLabel } from './routeStatsFormat';
import type { RouteStats } from './types';
import styles from './RouteStatsTable.module.css';

interface SelectionChipProps {
    route: RouteStats;
    onClear: () => void;
}

/** Indicates what route is selected and clears the selection. */
export const SelectionChip = ({ route, onClear }: SelectionChipProps) => (
    <div className={styles.selectionChip}>
        <span>
            Showing <strong>{routeLabel(route)}</strong> — by exact status code,
            and the log below is filtered to it
        </span>
        <button type="button" onClick={onClear} aria-label="Show all routes">✕</button>
    </div>
);
