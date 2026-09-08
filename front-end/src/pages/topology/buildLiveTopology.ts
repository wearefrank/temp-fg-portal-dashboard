import type { Edge, Node } from '@xyflow/react';
import type { ColorScheme, ConfigNodeData } from './buildTopology';
import { EDGE_LABEL_BG_STYLE, EDGE_LABEL_STYLE } from './buildTopology';
import { AUTH_PLUGINS, CATEGORY_COLOR, CATEGORY_DEFINITIONS } from '../../config/categoryDefinitions';
import type {
    LiveInlineUpstream, LiveNodes, LiveRoute, LiveService, LiveUpstream,
} from '../../components/Dashboard/dashboardTypes';
import { toNodeList } from '../../components/Dashboard/upstreamNodes';

export interface LiveTopologyInput {
    routes: LiveRoute[] | null;
    services: LiveService[] | null;
    upstreams: LiveUpstream[] | null;
}


const LIVE_CATEGORIES = ['route', 'service', 'upstream', 'consumer'];
export type LiveCategory = typeof LIVE_CATEGORIES[number];

/** The categories that can own an inline upstream or a consumer-restriction plugin. */
const OWNER_CATEGORIES = ['route', 'service'];
export type OwnerCategory = typeof OWNER_CATEGORIES[number];

/** Marks upstream nodes the console invented, so a detail card can say so. */
export const SYNTHETIC_UPSTREAM = '__inline';

/** Marks consumer nodes read from a consumer-restriction list. */
export const DERIVED_CONSUMER = '__from_consumer_restriction';

/** Holds the node ids of the resources whose blacklist names this consumer. */
export const DENIED_ON = '__denied_on';

/** One resource as the control API reports it. */
type LiveEntry = Record<string, unknown>;

interface LiveReference {
    field: string;
    target: LiveCategory;
    animated: boolean;
}

const RESOLVABLE_TARGETS: ReadonlySet<string> = new Set(LIVE_CATEGORIES);

/**
 * Reference fields taken from the shared category schema, so a field added there also
 * shows up here. Reverse and unresolvable ones are dropped — plugin_config_id points at
 * a category the control API does not serve, so its edge could never land.
 */
function liveReferences(category: OwnerCategory): LiveReference[] {
    return CATEGORY_DEFINITIONS[category].referenceFields
        .filter(ref => ref.edgeDirection === 'forward' && RESOLVABLE_TARGETS.has(ref.targetCategory))
        .map(ref => ({
            field: ref.field,
            target: ref.targetCategory as LiveCategory,
            animated: ref.animated === true,
        }));
}

const LIVE_REFERENCES: Record<OwnerCategory, LiveReference[]> = {
    route: liveReferences('route'),
    service: liveReferences('service'),
};

export function buildLiveTopology(
    input: LiveTopologyInput,
    colorScheme: ColorScheme = 'destination',
): { nodes: Node<ConfigNodeData>[]; edges: Edge[] } {

    const upstreams = new Map<string, LiveEntry>();
    for (const entry of input.upstreams ?? []) {
        upstreams.set(String(entry.value.id), { ...entry.value });
    }

    const routes = (input.routes ?? []).map(e => adoptInlineUpstream('route', { ...e.value }, upstreams));
    const services = (input.services ?? []).map(e => adoptInlineUpstream('service', { ...e.value }, upstreams));

    const restricted = [
        ...collectRestrictions('route', routes),
        ...collectRestrictions('service', services),
    ];

    // Both passes above may add inline upstreams, so read the map only now.
    const byCategory: Record<LiveCategory, LiveEntry[]> = {
        route: routes,
        service: services,
        upstream: [...upstreams.values()],
        consumer: deriveConsumers(restricted),
    };

    const nodes: Node<ConfigNodeData>[] = [];
    const known = new Set<string>();

    for (const category of LIVE_CATEGORIES) {
        for (const entry of byCategory[category]) {
            const id = nodeId(category, entry);
            known.add(id);
            nodes.push({
                id,
                type: 'configNode',
                position: { x: 0, y: 0 }, // filled in by applyElkLayout()
                data: { category, entry },
            });
        }
    }

    const edges: Edge[] = [];

    for (const category of OWNER_CATEGORIES) {
        for (const entry of byCategory[category]) {
            for (const ref of LIVE_REFERENCES[category]) {
                const value = entry[ref.field];
                if (value == null) continue;

                const target = `${ref.target}-${String(value)}`;
                if (!known.has(target)) continue; // dangling id

                edges.push(referenceEdge(nodeId(category, entry), target, category, ref, colorScheme));
            }
        }
    }

    // Only a whitelist means access. Blacklisted consumers get a node, no edge.
    const allowedBy = whitelistIndex(restricted);

    for (const consumer of byCategory.consumer) {
        const source = nodeId('consumer', consumer);
        for (const resource of allowedBy.get(String(consumer['username'])) ?? []) {
            edges.push(consumerEdge(source, resource, colorScheme));
        }
    }

    return { nodes, edges };
}

function nodeId(category: LiveCategory, entry: LiveEntry): string {
    const id = category === 'consumer' ? entry['username'] : entry['id'];
    return `${category}-${String(id ?? '')}`;
}

/** Everything an edge needs beyond the styling every live edge shares. */
interface EdgeSpec {
    source: string;
    target: string;
    sourceHandle: string;
    targetHandle: string;
    label: string;
    /** The two ends, in graph order. The colour scheme picks which one sets the stroke. */
    from: LiveCategory;
    to: LiveCategory;
    animated?: boolean;
    dashed?: boolean;
}

function makeEdge(spec: EdgeSpec, colorScheme: ColorScheme): Edge {
    const end = colorScheme === 'source' ? spec.from : spec.to;
    const stroke = CATEGORY_COLOR[end] ?? '#64748b';

    return {
        id: `${spec.source}->${spec.target}`,
        source: spec.source,
        target: spec.target,
        sourceHandle: spec.sourceHandle,
        targetHandle: spec.targetHandle,
        type: 'smoothstep',
        label: spec.label,
        labelStyle: EDGE_LABEL_STYLE,
        labelBgStyle: EDGE_LABEL_BG_STYLE,
        style: spec.dashed ? { stroke, strokeDasharray: '3 3' } : { stroke },
        animated: spec.animated ?? false,
    };
}

function referenceEdge(
    source: string,
    target: string,
    category: OwnerCategory,
    ref: LiveReference,
    colorScheme: ColorScheme,
): Edge {
    return makeEdge({
        source,
        target,
        sourceHandle: `source-${ref.target}`,
        targetHandle: `target-from-${category}`,
        label: ref.target,
        from: category,
        to: ref.target,
        animated: ref.animated,
    }, colorScheme);
}

function consumerEdge(source: string, resource: RestrictedResource, colorScheme: ColorScheme): Edge {
    return makeEdge({
        source,
        target: resource.nodeId,
        sourceHandle: `source-auth-${resource.category}`,
        targetHandle: 'target-from-consumer',
        label: resource.authLabel,
        from: 'consumer',
        to: resource.category,
        dashed: true,
    }, colorScheme);
}

// The consumer-restriction `type` says what its lists hold. Only these two hold usernames;
// other types hold route, service or consumer-group ids.
const CONSUMER_SCOPED_TYPES: ReadonlySet<string> = new Set(['consumer_name', 'consumer']);

/** A route or service whose consumer-restriction plugin names consumer usernames. */
interface RestrictedResource {
    nodeId: string;
    category: OwnerCategory;
    /** Credential the consumer must present, shown on the edge. */
    authLabel: string;
    whitelist: string[];
    blacklist: string[];
}

function allowedByMethodsUsers(restriction: Record<string, unknown>): string[] {
    const out: string[] = [];

    if (Array.isArray(restriction['allowed_by_methods'])) {
        for (const allowedByMethods of restriction['allowed_by_methods']) {
            if (isRecord(allowedByMethods) && typeof allowedByMethods['user'] === 'string') {
                out.push(allowedByMethods['user']);
            }
        }
    }

    return out;
}

function collectRestrictions(category: OwnerCategory, entries: LiveEntry[]): RestrictedResource[] {
    const found: RestrictedResource[] = [];

    for (const entry of entries) {
        const restriction = consumerRestriction(entry);
        if (!restriction) continue;

        const whitelist = [
            ...new Set([
                ...stringList(restriction['whitelist']),
                ...allowedByMethodsUsers(restriction)
            ])
        ];

        const blacklist = stringList(restriction['blacklist']);

        if (whitelist.length === 0 && blacklist.length === 0) continue;

        found.push({
            nodeId: nodeId(category, entry),
            category,
            authLabel: authPluginName(entry) ?? 'whitelist',
            whitelist,
            blacklist,
        });
    }

    return found;
}

/** Resources each username is whitelisted on, so the edge pass is a lookup per consumer. */
function whitelistIndex(restricted: RestrictedResource[]): Map<string, RestrictedResource[]> {
    const index = new Map<string, RestrictedResource[]>();

    for (const resource of restricted) {
        for (const username of resource.whitelist) {
            const allowed = index.get(username);
            if (allowed) allowed.push(resource);
            else index.set(username, [resource]);
        }
    }

    return index;
}

/** A consumer node the console invented from the restriction lists. */
export interface DerivedConsumer extends LiveEntry {
    username: string;
    [DERIVED_CONSUMER]: true;
    /** Resource node ids that blacklist this consumer. Left off when none do. */
    [DENIED_ON]?: string[];
}

/**
 * Every consumer username the gateway mentions, as a node entry. Consumers nobody
 * restricted on stay invisible. One username appears once, even when several
 * resources name it, and carries the ones that blacklist it.
 */
function deriveConsumers(restricted: RestrictedResource[]): DerivedConsumer[] {
    // Every mentioned username, mapped to the resources that blacklist it.
    const deniedBy = new Map<string, string[]>();

    for (const resource of restricted) {
        for (const username of resource.whitelist) {
            if (!deniedBy.has(username)) deniedBy.set(username, []);
        }

        for (const username of resource.blacklist) {
            const denied = deniedBy.get(username);
            if (denied) denied.push(resource.nodeId);
            else deniedBy.set(username, [resource.nodeId]);
        }
    }

    return [...deniedBy].map(([username, denied]) => ({
        username,
        [DERIVED_CONSUMER]: true as const,
        // Left off when nobody denies them, so the node skips the blocked styling.
        ...(denied.length > 0 ? { [DENIED_ON]: denied } : {}),
    }));
}

/** The plugin config, or null when it is absent or its lists are not usernames. */
function consumerRestriction(entry: LiveEntry): Record<string, unknown> | null {
    const plugins = entry['plugins'];
    if (!isRecord(plugins)) return null;

    const raw = plugins['consumer-restriction'];
    if (!isRecord(raw)) return null;

    const type = raw['type'];
    if (type !== undefined && !CONSUMER_SCOPED_TYPES.has(String(type))) return null;

    return raw;
}

/** First auth plugin on the resource: the credential a consumer must present. */
function authPluginName(entry: LiveEntry): string | null {
    const plugins = entry['plugins'];
    if (!isRecord(plugins)) return null;

    return Object.keys(plugins).find(name => AUTH_PLUGINS.has(name)) ?? null;
}

function stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter(v => typeof v === 'string') : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * An `upstream: {...}` block has no node for an edge to point at, so mint one and
 * rewrite the owner to reference it by id.
 */
function adoptInlineUpstream(
    owner: OwnerCategory,
    entry: LiveEntry,
    upstreams: Map<string, LiveEntry>,
): LiveEntry {
    const inline = entry['upstream'];
    if (entry['upstream_id'] != null || !isInlineUpstream(inline)) return entry;

    const id = inlineUpstreamId(owner, String(entry['id'] ?? ''), inline);
    if (!upstreams.has(id)) {
        upstreams.set(id, { ...inline, id, name: inline.name ?? id, [SYNTHETIC_UPSTREAM]: true });
    }
    return { ...entry, upstream_id: id };
}

/**
 * Node id for an inline upstream. Owners that return the same id share one node,
 * so this decides where the graph merges.
 */
function inlineUpstreamId(
    owner: OwnerCategory,
    ownerId: string,
    upstream: LiveInlineUpstream,
): string {
    // The gateway's own id beats anything we invent.
    if (upstream.id != null && String(upstream.id) !== '') return String(upstream.id);

    // Same host:port set means the same backend, so those owners share a node.
    const signature = nodeSignature(upstream.nodes);
    if (signature !== '') return `${SYNTHETIC_UPSTREAM}:${signature}`;

    // Discovery upstreams have no nodes yet, but the looked-up service names them.
    const discovery = [upstream['discovery_type'], upstream['service_name']]
        .filter(value => typeof value === 'string' && value !== '')
        .join(':');
    if (discovery !== '') return `${SYNTHETIC_UPSTREAM}:${discovery}`;

    // Nothing identifies it, so key on the owner. Never merges, which is the safe side.
    return `${SYNTHETIC_UPSTREAM}:${owner}:${ownerId}`;
}

/** Sorted "host:port" list, so the order APISIX sent does not matter. */
export function nodeSignature(nodes: LiveNodes | undefined): string {
    return toNodeList(nodes)
        .map(node => `${node.host}:${node.port}`)
        .sort()
        .join(',');
}

/** APISIX sends an object here; anything else is absent or malformed. */
function isInlineUpstream(value: unknown): value is LiveInlineUpstream {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
