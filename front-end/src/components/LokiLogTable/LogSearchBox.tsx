import styles from './LokiLogTable.module.css';

interface LogSearchBoxProps {
    value: string;
    onChange: (value: string) => void;
}

/** The search term. Debounced by useLogPage, so this stays a plain controlled input. */
export const LogSearchBox = ({ value, onChange }: LogSearchBoxProps) => (
    <div className={styles.searchWrap}>
        <input
            className={styles.search}
            type="search"
            placeholder="Search log lines…"
            value={value}
            onChange={event => onChange(event.target.value)}
            aria-label="Search log lines"
        />
        {value && (
            <button
                className={styles.clearSearch}
                type="button"
                onClick={() => onChange('')}
                aria-label="Clear search"
            >
                ×
            </button>
        )}
    </div>
);
