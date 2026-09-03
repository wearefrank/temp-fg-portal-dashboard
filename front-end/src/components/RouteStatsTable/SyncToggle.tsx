import styles from './RouteStatsTable.module.css';

interface SyncToggleProps {
    checked: boolean;
    onChange: (synced: boolean) => void;
}

/** Turns the one-shot "narrow the log" click into a standing rule. */
export const SyncToggle = ({ checked, onChange }: SyncToggleProps) => (
    <label className={styles.syncToggle} title="Keep the log below on this window and route">
        <input
            type="checkbox"
            checked={checked}
            onChange={event => onChange(event.target.checked)}
        />
        Keep synced
    </label>
);
