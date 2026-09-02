import { NodeRow } from './NodeRow';
import type { LiveService } from './dashboardTypes';
import { toNodeList } from './upstreamNodes';
import styles from './Dashboard.module.css';

export const LiveServiceItem = ({ service }: { service: LiveService }) => {
    const { id, name, desc, upstream_id: upstreamId, upstream, plugins } = service.value;
    const pluginNames = Object.keys(plugins ?? {});

    return (
        <div className={styles.statsList}>
            <div className={styles.statRow}>
                <strong>{name ?? `Service ${id}`}</strong>
                <span className="text-muted text-small">id: {id}</span>
            </div>

            {desc && <div className={`text-small text-muted ${styles.statRow}`}>{desc}</div>}

            {/* A service points at an upstream either by reference or inline - show whichever
                it uses. */}
            {upstreamId != null && (
                <div className={styles.statRow}>
                    <span className="text-small">Upstream</span>
                    <code className="text-small">{upstreamId}</code>
                </div>
            )}
            {toNodeList(upstream?.nodes).map(node => (
                <NodeRow key={`${node.host}:${node.port}`} node={node} />
            ))}

            {pluginNames.length > 0 && (
                <div className={styles.tagList}>
                    {pluginNames.map(plugin => (
                        <span key={plugin} className={styles.tag}>{plugin}</span>
                    ))}
                </div>
            )}
        </div>
    );
};
