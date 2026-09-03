import { useCallback, useMemo, useState } from 'react';
import { useFetch } from '../../hooks/useFetch';
import { useTickWhile } from '../../hooks/useTickWhile';
import {
    rangeCanChange,
    rangeToQuery,
    saveRange,
    type TimeRange,
} from '../TimeRangePicker/timeRange';
import { DEFAULT_SORT, nextSort, sortRoutes, type Sort, type SortKey } from './routeStatsSort';
import type { RouteStatsResult } from './types';
import {usePersistedState} from "../../hooks/usePersistedState.ts";

const STORAGE_KEY = 'routeStats';

const DEFAULT_RANGE: TimeRange = { kind: 'relative', seconds: 604800 };

/** Traffic per route over a window, with the zoom and the sort that go with it. */
export function useRouteStats(refreshKey: number) {

    const [range, setRange] = usePersistedState<TimeRange>(STORAGE_KEY, DEFAULT_RANGE);
    const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
    // The window the first zoom moved away from, so zooming out goes straight back to it
    // however many drags in you are - the picker has no idea where the chart started.
    const [zoomOrigin, setZoomOrigin] = useState<TimeRange | null>(null);

    const endpoint = useMemo(() => {

        const { windowSeconds, anchor } = rangeToQuery(range);

        const params = new URLSearchParams({ windowSeconds: String(windowSeconds) });

        if (anchor) params.set('anchor', anchor);
        return `/routes/stats?${params}`;
    }, [range]);

    const [dragging, setDragging] = useState(false);
    // tick decides when the refetch happens
    const tick = useTickWhile(refreshKey, !dragging && rangeCanChange(range, refreshKey));

    // fetches the route stats from Loki
    const statsFetch = useFetch<RouteStatsResult>(endpoint, tick);

    const applyRange = useCallback((next: TimeRange) => {
        setRange(next);
        saveRange(STORAGE_KEY, next);
    }, []);

    const pickRange = useCallback((next: TimeRange) => {
        setZoomOrigin(null);
        applyRange(next);
    }, [applyRange]);


    const zoomTo = useCallback((next: TimeRange) => {
        setZoomOrigin(origin => origin ?? range);
        applyRange(next);
    }, [range, applyRange]);

    const zoomOut = useCallback(() => {
        if (!zoomOrigin) return;
        applyRange(zoomOrigin);
        setZoomOrigin(null);
    }, [zoomOrigin, applyRange]);

    const toggleSort = useCallback((key: SortKey) => {
        setSort(current => nextSort(current, key));
    }, []);

    const fetched = statsFetch.error ? null : statsFetch.data;

    const result = statsFetch.stale ? null : fetched;

    const rows = useMemo(
        () => (result ? sortRoutes(result.routes, sort) : []),
        [result, sort],
    );

    return {
        range,
        pickRange,
        zoomTo,
        zoomOut,
        setDragging,
        canZoomOut: zoomOrigin !== null,
        result,
        rows,
        error: statsFetch.error,
        loading: result === null && statsFetch.error === null,
        sort,
        toggleSort,
    };
}
