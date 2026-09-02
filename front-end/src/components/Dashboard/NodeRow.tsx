import type { LiveNode } from './dashboardTypes';
import styles from './Dashboard.module.css';

/** One backend behind an upstream: where it is, and how much traffic it takes. */
export const NodeRow = ({ node }: { node: LiveNode }) => (
    <div className={styles.statRow}>
        <code className="text-small">{node.host}:{node.port}</code>
        <span className="text-muted text-small">weight: {node.weight}</span>
    </div>
);
