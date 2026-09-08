import { useCallback, useMemo } from 'react';
import { useFetch } from '../../hooks/useFetch';
import { useDashboardRefresh } from '../../components/Dashboard/useDashboardRefresh';
import type { LiveRoute, LiveService, LiveUpstream } from '../../components/Dashboard/dashboardTypes';
import { buildLiveTopology } from './buildLiveTopology';
import type { ColorScheme } from './buildTopology';
import { TopologyCanvas } from './TopologyCanvas';
import styles from './TopologyPage.module.css';

/**
 * Topology of what the gateway is running right now, rebuilt on the dashboard's refresh tick.
 * The only inputs are the control API's three list endpoints — no config file is read.
 */
export function LiveTopologyPage() {
    const refreshKey = useDashboardRefresh();

    const routesFetch    = useFetch<LiveRoute[]>('/metrics/routes', refreshKey);
    const upstreamsFetch = useFetch<LiveUpstream[]>('/metrics/upstreams', refreshKey);
    const servicesFetch  = useFetch<LiveService[]>('/metrics/services', refreshKey);

    // Wait for all three. Building on a partial answer lays out a graph that the next
    // response throws away, so the first paint costs three ELK runs instead of one.
    // useFetch keeps the last data across refreshes, so this only holds up the first load.
    const loading = routesFetch.data == null || servicesFetch.data == null || upstreamsFetch.data == null;
    const failed  = routesFetch.error ?? upstreamsFetch.error ?? servicesFetch.error;

    const input = useMemo(() => ({
        routes: routesFetch.data,
        services: servicesFetch.data,
        upstreams: upstreamsFetch.data,
    }), [routesFetch.data, servicesFetch.data, upstreamsFetch.data]);

    // The control API is an external source, so a malformed answer must not take the page
    // down. colorScheme only picks stroke colours, so one build proves the input is safe
    // for every scheme — buildGraph below can then call the builder plainly.
    const probe = useMemo(() => {
        try {
            return { graph: buildLiveTopology(input, 'destination'), reason: null };
        } catch (err) {
            return { graph: null, reason: err instanceof Error ? err.message : String(err) };
        }
    }, [input]);

    const buildGraph = useCallback(
        (colorScheme: ColorScheme) => buildLiveTopology(input, colorScheme),
        [input],
    );

    if (loading && !failed) return <Notice body="Asking the gateway..." />;
    if (failed)             return <Notice body={`Control API unavailable: ${failed}`} />;
    if (!probe.graph)       return <Notice body={probe.reason} />;

    // Upstreams and consumers are counted off the graph, not the fetches: both can include
    // nodes the builder derived rather than ones the control API listed.
    const countOf = (category: string) =>
        probe.graph.nodes.filter(n => n.data.category === category).length;

    const counts = [
        `${routesFetch.data?.length ?? 0} routes`,
        `${servicesFetch.data?.length ?? 0} services`,
        `${countOf('upstream')} upstreams`,
        `${countOf('consumer')} consumers`,
    ].join(' · ');

    return (
        <TopologyCanvas
            buildGraph={buildGraph}
            statusPanel={<span>Live · {counts}</span>}
            showEditorLinks={false}
            cardNotice="Live runtime state from the gateway — not the config file you edit."
        />
    );
}

const Notice = ({ body }: { body: string }) => (
    <div className={`container ${styles.empty}`}>
        <h1>Live Topology</h1>
        <p className="text-muted">{body}</p>
    </div>
);
