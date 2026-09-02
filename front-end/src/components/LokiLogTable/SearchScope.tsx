import { ALL_COLUMNS } from './useLogPage';
import styles from './LokiLogTable.module.css';

export interface SearchScopeOption {
    id: string;
    label: string;
}

interface SearchScopeProps {
    columns: SearchScopeOption[];
    value: string;
    onChange: (columnId: string) => void;
}

/**
 * Which column the search box looks in. Sits in front of the box because it reads as part
 * of it - "in Path, matching centric" - rather than as another filter on the row.
 *
 * The narrowing is the server's: it goes out as `searchField`, which is why the ids here
 * are the column ids - see LogSearchField on the back end.
 */
export const SearchScope = ({ columns, value, onChange }: SearchScopeProps) => (
    <select
        className={styles.searchScope}
        value={value}
        onChange={event => onChange(event.target.value)}
        aria-label="Column to search in"
    >
        <option value={ALL_COLUMNS}>All columns</option>
        {columns.map(column => (
            <option key={column.id} value={column.id}>{column.label}</option>
        ))}
    </select>
);
