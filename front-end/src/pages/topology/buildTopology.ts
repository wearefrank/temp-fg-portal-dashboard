import ELK from 'elkjs/lib/elk.bundled.js';
import type { Node, Edge } from '@xyflow/react';

/**
 * BFS from `startId` through the edge graph using directional queues:
 * - Nodes reached via an *output* edge only continue following outputs.
 * - Nodes reached via an *input* edge only continue following inputs.
 * This prevents unrelated sibling nodes from being pulled into the focus set.
 */
export function getConnectedNodeIds(startId: string, edges: Edge[]): Set<string> {
    const visited    = new Set([startId]);
    const downQueue: string[] = []; // reached via output — expand outputs only
    const upQueue:   string[] = []; // reached via input  — expand inputs only

    for (const e of edges) {
        if (e.source === startId && !visited.has(e.target)) { visited.add(e.target); downQueue.push(e.target); }
        if (e.target === startId && !visited.has(e.source)) { visited.add(e.source); upQueue.push(e.source); }
    }
    while (downQueue.length) {
        const id = downQueue.shift()!;
        for (const e of edges)
            if (e.source === id && !visited.has(e.target)) { visited.add(e.target); downQueue.push(e.target); }
    }
    while (upQueue.length) {
        const id = upQueue.shift()!;
        for (const e of edges)
            if (e.target === id && !visited.has(e.source)) { visited.add(e.source); upQueue.push(e.source); }
    }
    return visited;
}
import type { ApisixConfig, ResourceConfiguration } from '../../actions/SchemaValidation';
import { CATEGORY_DEFINITIONS, CATEGORY_COLOR, AUTH_PLUGINS, getIdField, getDisplayId } from '../../config/categoryDefinitions';

export type ColorScheme = 'source' | 'destination';

export interface ConfigNodeData extends Record<string, unknown> {
    category: string;
    entry: ResourceConfiguration;
}

const NODE_WIDTH  = 240;
const NODE_HEIGHT = 170;

// Consumer edge colors per target category (dest-scheme). FK edge colors are computed from CATEGORY_COLOR.
const DEST_CONSUMER_EDGE_COLORS: Record<string, string> = {
    route: '#3b82f6',
    service: '#f97316',
    plugin_config: '#f59e0b',
};

// Shared with buildLiveTopology so both graphs label edges the same way.
export const EDGE_LABEL_STYLE = { fontSize: '9px', fill: '#cbd5e1' };
export const EDGE_LABEL_BG_STYLE = { fill: '#1e293b', fillOpacity: 0.9, rx: 3, ry: 3 };

function nodeId(category: string, entry: ResourceConfiguration, index?: number): string {
    return `${category}-${getDisplayId(category, entry as Record<string, unknown>, index)}`;
}

// AUTH_PLUGINS is imported from categoryDefinitions — update it there to add/remove auth plugins.

function authPluginNames(entry: ResourceConfiguration): Set<string> {
    const plugins = entry['plugins'];
    if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) return new Set();
    return new Set(
        Object.keys(plugins as Record<string, unknown>).filter(p => AUTH_PLUGINS.has(p))
    );
}

// ---------------------------------------------------------------------------
// consumer-restriction support
// ---------------------------------------------------------------------------
//
// The APISIX `consumer-restriction` plugin controls which consumers may access
// a resource.  Its `type` field (default: "consumer") determines what the
// `whitelist` / `blacklist` arrays contain:
//
//   "consumer"       – consumer usernames  (the only case we filter on here)
//   "consumer_group" – consumer-group IDs  (not modelled in the topology yet)
//   "service"        – service IDs         (not applicable to consumer edges)
//   "route"          – route IDs           (not applicable to consumer edges)
//
// When `type` is anything other than "consumer" we conservatively treat the
// restriction as absent so that no edges are incorrectly hidden.
//
// Rules applied per resource that carries the plugin:
//   • whitelist present and non-empty → only listed consumers may connect
//   • blacklist present and non-empty → all consumers except listed ones may connect
//   • both absent / empty             → no restriction, all consumers may connect
//   • both present                    → whitelist takes precedence (APISIX behaviour)

type ConsumerRestrictionType = 'consumer' | 'consumer_group' | 'service' | 'route';

interface ConsumerRestrictionConfig {
    /** Restricts filtering to one of four target kinds. Defaults to "consumer". */
    type?: ConsumerRestrictionType;
    /** Explicit allow-list of consumer usernames (takes precedence over blacklist). */
    whitelist?: string[];
    /** Explicit deny-list of consumer usernames. */
    blacklist?: string[];
}

/**
 * Extracts the `consumer-restriction` plugin config from a resource entry,
 * or returns `null` if the plugin is absent or has a non-consumer `type`.
 */
function getConsumerRestriction(entry: ResourceConfiguration): ConsumerRestrictionConfig | null {
    const plugins = entry['plugins'];
    if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) return null;

    const raw = (plugins as Record<string, unknown>)['consumer-restriction'];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    const restriction = raw as ConsumerRestrictionConfig;

    // Only the default "consumer" type carries consumer-username lists.
    // For any other type we have no information to filter on, so we treat
    // the restriction as absent and leave the edge visible.
    if (restriction.type !== undefined && restriction.type !== 'consumer') return null;

    return restriction;
}

/**
 * Returns true when `consumerUsername` is permitted to reach a resource
 * given that resource's consumer-restriction config.
 *
 * @param consumerUsername - the `username` field of the consumer entry
 * @param restriction      - parsed restriction config, or null if absent
 */
function isConsumerPermitted(consumerUsername: string, restriction: ConsumerRestrictionConfig | null): boolean {
    if (!restriction) return true;

    // Whitelist takes precedence: consumer must be explicitly listed.
    if (restriction.whitelist && restriction.whitelist.length > 0) {
        return restriction.whitelist.includes(consumerUsername);
    }

    // Blacklist: consumer must NOT be listed.
    if (restriction.blacklist && restriction.blacklist.length > 0) {
        return !restriction.blacklist.includes(consumerUsername);
    }

    // Plugin present but no lists configured — no effective restriction.
    return true;
}

// Singleton ELK instance — reused across layout calls to avoid re-init overhead.
const elk = new ELK();

/**
 * Runs ELK's layered (Sugiyama) algorithm on a set of unpositioned nodes and
 * edges, and returns the same nodes with their `position` fields filled in.
 *
 * This is async — call it from a useEffect, not a useMemo.
 */
export async function applyElkLayout(
    nodes: Node<ConfigNodeData>[],
    edges: Edge[],
): Promise<Node<ConfigNodeData>[]> {
    const graph = await elk.layout({
        id: 'root',
        layoutOptions: {
            // Sugiyama-style layered layout — best for hierarchical DAGs like this topology
            'elk.algorithm':                                     'layered',
            'elk.direction':                                     'DOWN',
            // Vertical gap between consecutive layers (e.g. routes → services)
            'elk.layered.spacing.nodeNodeBetweenLayers':         '90',
            // Horizontal gap between nodes in the same layer
            'elk.spacing.nodeNode':                              '60',
            // LAYER_SWEEP minimises edge crossings between layers
            'elk.layered.crossingMinimization.strategy':         'LAYER_SWEEP',
            // BRANDES_KOEPF gives balanced, readable x-positions
            'elk.layered.nodePlacement.strategy':                'BRANDES_KOEPF',
            'elk.layered.nodePlacement.bk.fixedAlignment':       'BALANCED',
            // Keep disconnected subgraphs (e.g. global_rule island) apart
            'elk.separateConnectedComponents':                   'true',
            'elk.spacing.componentComponent':                    '100',
            // Higher thoroughness = fewer crossings, acceptable for this graph size
            'elk.layered.thoroughness':                          '7',
        },
        children: nodes.map(n => ({ id: n.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
        edges: edges.map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })),
    });

    const posMap = new Map(
        (graph.children ?? []).map(n => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]),
    );

    return nodes.map(n => ({ ...n, position: posMap.get(n.id) ?? { x: 0, y: 0 } }));
}

export function buildTopology(config: ApisixConfig, colorScheme: ColorScheme = 'source'): { nodes: Node<ConfigNodeData>[]; edges: Edge[] } {
    const nodes: Node<ConfigNodeData>[] = [];
    const edges: Edge[] = [];

    const categories = [
        'consumer', 'ssl',
        'route', 'global_rule',
        'service', 'plugin_config',
        'upstream',
    ] as const;

    // First pass: collect nodes and build a reference registry.
    // Registry maps "category-originalId" -> resolved node ID so that edge lookups
    // work even when a node's ID was derived from a fallback (no id field).
    const refRegistry = new Map<string, string>();

    const resolveRef = (category: string, refId: unknown): string | null => {
        if (refId === undefined || refId === null) return null;
        return refRegistry.get(`${category}-${String(refId)}`) ?? null;
    };

    for (const category of categories) {
        const raw = (config as Record<string, unknown>)[category + 's'];
        if (!Array.isArray(raw)) continue;

        for (let i = 0; i < (raw as ResourceConfiguration[]).length; i++) {
            const entry = (raw as ResourceConfiguration[])[i];
            const id = nodeId(category, entry, i);

            // Register by original id/username so other entries can reference this node
            const originalId = entry[getIdField(category)];
            if (originalId !== undefined && originalId !== null) {
                refRegistry.set(`${category}-${String(originalId)}`, id);
            }

            nodes.push({
                id,
                type: 'configNode',
                position: { x: 0, y: 0 }, // positions applied later by applyElkLayout()
                data: { category, entry },
            });
        }
    }

    // Second pass: collect edges using the registry for all reference lookups
    for (const node of nodes) {
        const { category, entry } = node.data;

        const def = CATEGORY_DEFINITIONS[category];
        if (def) {
            for (const ref of def.referenceFields) {
                const resolvedId = resolveRef(ref.targetCategory, entry[ref.field]);
                if (!resolvedId) continue;

                const isForward    = ref.edgeDirection === 'forward';
                const edgeSource   = isForward ? node.id   : resolvedId;
                const edgeTarget   = isForward ? resolvedId : node.id;
                const sourceHandle = isForward ? `source-${ref.targetCategory}` : `source-to-${category}`;
                const targetHandle = isForward ? `target-from-${category}`      : `target-from-${ref.targetCategory}`;

                const sourceCategory = isForward ? category             : ref.targetCategory;
                const destCategory   = isForward ? ref.targetCategory   : category;
                const strokeColor    = colorScheme === 'source'
                    ? (CATEGORY_COLOR[sourceCategory] ?? '#64748b')
                    : (CATEGORY_COLOR[destCategory]   ?? '#64748b');

                const edgeStyle: { stroke: string; strokeDasharray?: string } = { stroke: strokeColor };
                if (ref.dashed) edgeStyle.strokeDasharray = '5 3';

                const edgeEntry: Parameters<typeof edges.push>[0] = {
                    id: `${edgeSource}->${edgeTarget}`,
                    source: edgeSource,
                    target: edgeTarget,
                    sourceHandle,
                    targetHandle,
                    type: 'smoothstep',
                    label: ref.targetCategory,
                    labelStyle: EDGE_LABEL_STYLE,
                    labelBgStyle: EDGE_LABEL_BG_STYLE,
                    style: edgeStyle,
                };
                if (ref.animated) edgeEntry.animated = true;
                edges.push(edgeEntry);
            }
        }
    }

    // Auth-sender edges: connect each category that has authTargetCategories defined
    // to every matching target node that shares at least one auth plugin.
    const consumerNodes = nodes.filter(
        n => (CATEGORY_DEFINITIONS[n.data.category]?.authTargetCategories.length ?? 0) > 0
    );
    const authTargetCategories = new Set(
        Object.values(CATEGORY_DEFINITIONS).flatMap(def => def.authTargetCategories)
    );
    const authTargetNodes = nodes.filter(n => authTargetCategories.has(n.data.category));

    for (const consumer of consumerNodes) {
        const consumerAuth = authPluginNames(consumer.data.entry);
        if (consumerAuth.size === 0) continue;

        // Consumers are identified by `username`, not `id`.
        const consumerUsername = String(consumer.data.entry['username'] ?? '');

        for (const target of authTargetNodes) {
            const targetAuth = authPluginNames(target.data.entry);

            // For routes, also consider auth plugins inherited via plugin_config_id
            let inheritedAuth = new Set<string>();
            if (target.data.category === 'route') {
                const pcNodeId = resolveRef('plugin_config', target.data.entry['plugin_config_id']);
                const pcNode = pcNodeId ? nodes.find(n => n.id === pcNodeId) : null;
                if (pcNode) inheritedAuth = authPluginNames(pcNode.data.entry);
            }

            const shared = [...consumerAuth].find(p => targetAuth.has(p) || inheritedAuth.has(p));
            if (!shared) continue;

            // Respect the `consumer-restriction` plugin on the target resource.
            // If the consumer is not permitted, skip the edge entirely so the
            // topology only shows connections that can actually carry traffic.
            const restriction = getConsumerRestriction(target.data.entry);
            if (!isConsumerPermitted(consumerUsername, restriction)) continue;

            const edgeId = `${consumer.id}->${target.id}`;
            const consumerEdgeColor = colorScheme === 'source'
                ? '#8b5cf6'
                : (DEST_CONSUMER_EDGE_COLORS[target.data.category] ?? '#8b5cf6');
            edges.push({
                id: edgeId,
                source: consumer.id,
                target: target.id,
                sourceHandle: `source-auth-${target.data.category}`,
                targetHandle: `target-from-${consumer.data.category}`,
                type: 'smoothstep',
                label: shared,
                labelStyle: EDGE_LABEL_STYLE,
                labelBgStyle: EDGE_LABEL_BG_STYLE,
                style: { stroke: consumerEdgeColor, strokeDasharray: '3 3' },
            });
        }
    }

    return { nodes, edges };
}
