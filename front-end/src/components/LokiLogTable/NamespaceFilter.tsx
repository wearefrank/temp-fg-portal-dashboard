import { ALL_NAMESPACES } from './useNamespaceFilter';
import styles from './LokiLogTable.module.css';

interface NamespaceFilterProps {
    namespaces: string[];
    value: string;
    onChange: (namespace: string) => void;
}

/**
 * Buttons rather than a dropdown - there are only ever a handful, and switching is one click.
 * Always shown, even with a single namespace, so "which am I looking at" has an answer.
 */
export const NamespaceFilter = ({ namespaces, value, onChange }: NamespaceFilterProps) => (
    <div className={styles.namespaceFilter} role="group" aria-label="Filter by namespace">
        {/* Without this the row is a button reading "All" next to a bare name, which says
            nothing about what they narrow. */}
        <span className={styles.namespaceLabel}>Namespace</span>
        {[ALL_NAMESPACES, ...namespaces].map(namespace => {
            const active = value === namespace;
            return (
                <button
                    key={namespace}
                    type="button"
                    className={`${styles.toolbarBtn} ${active ? styles.toolbarBtnActive : ''}`}
                    onClick={() => onChange(namespace)}
                    aria-pressed={active}
                >
                    {namespace === ALL_NAMESPACES ? 'All' : namespace}
                </button>
            );
        })}
    </div>
);
