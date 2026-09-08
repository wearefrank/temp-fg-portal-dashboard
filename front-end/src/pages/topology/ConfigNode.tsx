import React, {createContext, useContext} from 'react';
import {Handle, Position, useEdges, useNodeId} from '@xyflow/react';
import type {NodeProps, Node} from '@xyflow/react';
import type {ColorScheme, ConfigNodeData} from './buildTopology';
import { CATEGORY_COLOR, CATEGORY_LABEL, CATEGORY_DEFINITIONS, getDisplayId } from '../../config/categoryDefinitions';
import { DENIED_ON } from './buildLiveTopology';
import styles from './TopologyPage.module.css';

// Re-export so existing importers (TopologyPage, CardLayer) don't need to change
export { CATEGORY_COLOR, CATEGORY_LABEL };

// Color scheme context - provided by TopologyPage, consumed here

export const ColorSchemeContext = createContext<ColorScheme>('source');

// Handle styling helpers

const HANDLE_SIZE   = 12;
const HANDLE_OFFSET = 1;

// `ring` is the colour of the far end of the connection, shown as a border.
function handleStyle(left: string, color: string, pos: 'top' | 'bottom', ring?: string): React.CSSProperties {
    return {
        left,
        background: color,
        border: `2px solid ${ring ?? color}`,
        width:  `${HANDLE_SIZE}px`,
        height: `${HANDLE_SIZE}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...(pos === 'top' ? {top: `-${HANDLE_OFFSET}px`} : {bottom: `-${HANDLE_OFFSET}px`}),
    };
}

const COUNT_LABEL_STYLE: React.CSSProperties = {
    color: '#1e293b',
    fontSize: '0.5rem',
    fontWeight: 700,
    lineHeight: 1,
    pointerEvents: 'none',
    userSelect: 'none',
};

// ---------------------------------------------------------------------------
// Data-driven handle system — derived from CATEGORY_DEFINITIONS
// ---------------------------------------------------------------------------

interface HandleSpec {
    handleId: string;
    /** Category at the other end of the edge, used for color computation. */
    otherCategory: string;
    /** Shown when no edge is currently connected. */
    tooltipHint: string;
    /** FK field on this node (source handles): show its current value in the tooltip. */
    field?: string;
    /** Auth-edge source handles: show the consumer's plugin names in the tooltip. */
    isAuthEdge?: boolean;
}

interface CategoryHandles {
    sources: HandleSpec[];
    targets: HandleSpec[];
}

function buildCategoryHandles(): Record<string, CategoryHandles> {
    const result: Record<string, CategoryHandles> = {};
    for (const cat of Object.keys(CATEGORY_DEFINITIONS)) {
        result[cat] = { sources: [], targets: [] };
    }

    for (const [cat, def] of Object.entries(CATEGORY_DEFINITIONS)) {
        for (const ref of def.referenceFields) {
            if (ref.edgeDirection === 'forward') {
                result[cat].sources.push({
                    handleId: `source-${ref.targetCategory}`,
                    otherCategory: ref.targetCategory,
                    tooltipHint: `set ${ref.field} to connect`,
                    field: ref.field,
                });
                if (result[ref.targetCategory]) {
                    result[ref.targetCategory].targets.push({
                        handleId: `target-from-${cat}`,
                        otherCategory: cat,
                        tooltipHint: `set ${cat}'s ${ref.field} to connect`,
                    });
                }
            } else {
                // reverse: edge runs targetCategory → cat; cat holds the FK field
                result[cat].targets.push({
                    handleId: `target-from-${ref.targetCategory}`,
                    otherCategory: ref.targetCategory,
                    tooltipHint: `set ${ref.field} to connect`,
                    field: ref.field,
                });
                if (result[ref.targetCategory]) {
                    result[ref.targetCategory].sources.push({
                        handleId: `source-to-${cat}`,
                        otherCategory: cat,
                        tooltipHint: '',
                    });
                }
            }
        }

        for (const targetCat of def.authTargetCategories) {
            result[cat].sources.push({
                handleId: `source-auth-${targetCat}`,
                otherCategory: targetCat,
                tooltipHint: `add auth plugin to connect to ${targetCat}s`,
                isAuthEdge: true,
            });
            if (result[targetCat] && !result[targetCat].targets.some(t => t.handleId === `target-from-${cat}`)) {
                result[targetCat].targets.push({
                    handleId: `target-from-${cat}`,
                    otherCategory: cat,
                    tooltipHint: `${cat}: add matching auth plugin`,
                    isAuthEdge: true,
                });
            }
        }
    }

    return result;
}

const CATEGORY_HANDLES = buildCategoryHandles();

// Maps 'source-{targetCategory}' handle IDs to FK field names for target-handle tooltip building.
// Covers all forward-direction references; adding a new one to categoryDefinitions.ts is sufficient.
const SOURCE_HANDLE_TO_FIELD: Record<string, string> = Object.fromEntries(
    Object.values(CATEGORY_DEFINITIONS).flatMap(def =>
        def.referenceFields
            .filter(r => r.edgeDirection === 'forward')
            .map(r => [`source-${r.targetCategory}`, r.field])
    )
);

function parseSourceNodeId(nid: string): {category: string; id: string} {
    const sep = nid.indexOf('-');
    return {category: nid.slice(0, sep), id: nid.slice(sep + 1)};
}

// Data-driven handle renderer — all handles are generated from CATEGORY_HANDLES

function getHandles(
    category: string,
    entry: Record<string, unknown>,
    colorScheme: ColorScheme,
    counts: Record<string, number>,
    tooltips: Record<string, string>,
): React.ReactNode {
    const spec = CATEGORY_HANDLES[category];
    if (!spec || (spec.targets.length === 0 && spec.sources.length === 0)) return null;

    const src = colorScheme === 'source';
    const thisColor = CATEGORY_COLOR[category] ?? '#64748b';

    const n = (id: string) => {
        const c = counts[id] ?? 0;
        return c > 0 ? <span style={COUNT_LABEL_STYLE}>{c}</span> : null;
    };

    const plugins = entry['plugins'];
    const pluginKeys = plugins && typeof plugins === 'object' && !Array.isArray(plugins)
        ? Object.keys(plugins as Record<string, unknown>)
        : [];

    const targetHandles = spec.targets.map((h, i) => {
        const left = `${(i + 1) * 100 / (spec.targets.length + 1)}%`;
        const otherColor = CATEGORY_COLOR[h.otherCategory] ?? '#64748b';
        const bg   = src ? otherColor : thisColor;
        const ring = src ? undefined  : otherColor;
        return (
            <Handle key={h.handleId} type="target" position={Position.Top}
                    id={h.handleId}
                    style={handleStyle(left, bg, 'top', ring)}
                    data-tooltip={tooltips[h.handleId] || h.tooltipHint}>
                {n(h.handleId)}
            </Handle>
        );
    });

    const sourceHandles = spec.sources.map((h, i) => {
        const left = `${(i + 1) * 100 / (spec.sources.length + 1)}%`;
        const otherColor = CATEGORY_COLOR[h.otherCategory] ?? '#64748b';
        const bg   = src ? thisColor  : otherColor;
        const ring = src ? otherColor : undefined;
        let tooltip: string;
        if (h.field) {
            const val = entry[h.field];
            tooltip = val ? `${h.field}: '${val}'` : h.tooltipHint;
        } else if (h.isAuthEdge) {
            tooltip = pluginKeys.length > 0 ? `plugins: ${pluginKeys.join(', ')}` : h.tooltipHint;
        } else {
            tooltip = h.tooltipHint;
        }
        return (
            <Handle key={h.handleId} type="source" position={Position.Bottom}
                    id={h.handleId}
                    style={handleStyle(left, bg, 'bottom', ring)}
                    data-tooltip={tooltip}>
                {n(h.handleId)}
            </Handle>
        );
    });

    return <>{targetHandles}{sourceHandles}</>;
}

// Helper: upstream node addresses for display

function upstreamAddresses(nodes: unknown): string[] {
    if (!nodes) return [];
    if (typeof nodes === 'object' && !Array.isArray(nodes))
        return Object.keys(nodes as Record<string, unknown>).slice(0, 3);
    if (Array.isArray(nodes))
        return (nodes as Array<{host?: unknown; port?: unknown}>)
            .slice(0, 3)
            .map(n => `${n.host ?? '?'}:${n.port ?? '?'}`);
    return [];
}

// Resources that blacklist this consumer, empty for every other kind of node.
function deniedOn(entry: Record<string, unknown>): string[] {
    const value = entry[DENIED_ON];
    return Array.isArray(value) ? value.map(String) : [];
}

// 'route-r1' reads better as 'route r1' on a chip.
function readableNodeId(nodeId: string): string {
    return nodeId.replace('-', ' ');
}

const CATEGORIES_WITH_INPUTS = new Set(
    Object.entries(CATEGORY_DEFINITIONS).flatMap(([cat, def]) => [
        ...def.referenceFields.filter(r => r.edgeDirection === 'forward').map(r => r.targetCategory),
        ...def.referenceFields.filter(r => r.edgeDirection === 'reverse').map(() => cat),
        ...def.authTargetCategories,
    ])
);
const CATEGORIES_WITH_OUTPUTS = new Set(
    Object.entries(CATEGORY_DEFINITIONS).flatMap(([cat, def]) => [
        ...(def.referenceFields.length > 0 ? [cat] : []),
        ...def.referenceFields.filter(r => r.edgeDirection === 'reverse').map(r => r.targetCategory),
        ...(def.authTargetCategories.length > 0 ? [cat] : []),
    ])
);

// ConfigNode — the custom ReactFlow node

type ConfigNodeType = Node<ConfigNodeData>;

export const ConfigNode: React.FC<NodeProps<ConfigNodeType>> = ({data}) => {
    const colorScheme   = useContext(ColorSchemeContext);
    const {category, entry} = data;
    const currentNodeId = useNodeId() ?? '';
    const allEdges      = useEdges();
    const currentId     = currentNodeId.slice(currentNodeId.indexOf('-') + 1);

    const handleCounts:  Record<string, number> = {};
    const handleTooltips: Record<string, string> = {};

    for (const e of allEdges) {
        if (e.source === currentNodeId && e.sourceHandle)
            handleCounts[e.sourceHandle] = (handleCounts[e.sourceHandle] ?? 0) + 1;

        if (e.target === currentNodeId && e.targetHandle) {
            handleCounts[e.targetHandle] = (handleCounts[e.targetHandle] ?? 0) + 1;
            const field = SOURCE_HANDLE_TO_FIELD[e.sourceHandle ?? ''];
            if (field) {
                const {category: srcCat, id: srcId} = parseSourceNodeId(e.source);
                const tip  = `${srcCat} '${srcId}' has ${field} set to '${currentId}'`;
                const prev = handleTooltips[e.targetHandle];
                handleTooltips[e.targetHandle] = prev ? `${prev} · ${tip}` : tip;
            }
        }
    }

    const color     = CATEGORY_COLOR[category] ?? '#64748b';
    const label     = CATEGORY_LABEL[category] ?? category;
    const title     = getDisplayId(category, entry as Record<string, unknown>) || '—';
    const fallbackInfo = (CATEGORY_DEFINITIONS[category]?.fallbackFields ?? [])
        .flatMap(field => {
            const val = (entry as Record<string, unknown>)[field];
            if (val === undefined || val === null) return [];
            const str = Array.isArray(val) ? String(val[0]) : String(val);
            return str.trim() !== '' && str !== title ? [{ field, value: str }] : [];
        });
    const plugins   = entry['plugins'];
    const pluginKeys = plugins && typeof plugins === 'object' && !Array.isArray(plugins)
        ? Object.keys(plugins as Record<string, unknown>)
        : [];
    const denied = deniedOn(entry as Record<string, unknown>);

    return (
        <div className={denied.length > 0 ? `${styles.configNode} ${styles.deniedNode}` : styles.configNode}>
            {getHandles(category, entry as Record<string, unknown>, colorScheme, handleCounts, handleTooltips)}

            <div className={styles.nodeMain}>
                <div className={styles.nodeHeader} style={{background: color}}>
                    <span className={styles.nodeCategory}>{label}</span>
                    {denied.length > 0 && <span className={styles.deniedBadge}>blocked</span>}
                </div>

                <div className={styles.nodeBody}>
                    {CATEGORIES_WITH_INPUTS.has(category)  && <div className={styles.ioLabelTop}>▲ input</div>}

                    <div className={styles.nodeContent}>
                        <div className={styles.nodeTitle}>{title}</div>

                        {fallbackInfo.length > 0 && (
                            <div className={styles.nodeDetail}>
                                {fallbackInfo.map(({ field, value }) => (
                                    <div key={field}>
                                        <span className={styles.nodeDetailLabel}>{field}</span>
                                        {': '}
                                        {value}
                                    </div>
                                ))}
                            </div>
                        )}

                        {category === 'upstream' && (
                            <div className={styles.nodeDetail}>
                                {upstreamAddresses(entry['nodes']).map(addr => (
                                    <div key={addr}><code>{addr}</code></div>
                                ))}
                                {!!entry['type'] && <div className={styles.nodeTag}>{String(entry['type'])}</div>}
                            </div>
                        )}

                        {denied.length > 0 && (
                            <div className={styles.deniedList}>
                                <span className={styles.nodeDetailLabel}>blacklisted on</span>
                                {denied.map(id => (
                                    <span key={id} className={styles.deniedChip}>{readableNodeId(id)}</span>
                                ))}
                            </div>
                        )}

                        {pluginKeys.length > 0 && (
                            <div className={styles.pluginChips}>
                                {pluginKeys.map(p => <span key={p} className={styles.pluginChip}>{p}</span>)}
                            </div>
                        )}
                    </div>

                    {CATEGORIES_WITH_OUTPUTS.has(category) && <div className={styles.ioLabelBottom}>output ▼</div>}
                </div>
            </div>
        </div>
    );
};

export const nodeTypes = {configNode: ConfigNode};
