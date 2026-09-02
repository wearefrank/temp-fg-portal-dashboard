import { NodeRow } from './NodeRow';
import type { LiveUpstream } from './dashboardTypes';
import { toNodeList } from './upstreamNodes';
import styles from './Dashboard.module.css';

export const LiveUpstreamItem = ({ upstream }: { upstream: LiveUpstream }) => (
    <div className={styles.statsList}>
        <div className={styles.statRow}>
            <strong>Upstream {upstream.value.id}</strong>
            <span className="text-muted text-small">{upstream.value.type}</span>
        </div>
        {toNodeList(upstream.value.nodes).map(node => (
            <NodeRow key={`${node.host}:${node.port}`} node={node} />
        ))}
    </div>
);
