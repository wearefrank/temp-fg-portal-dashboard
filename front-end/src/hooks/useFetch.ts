import { useState, useEffect, useCallback, useRef } from 'react';
import { client } from '../api/client';

interface FetchState<T> {
    data: T | null;
    loading: boolean;
    stale: boolean;
    error: string | null;
    refetch: () => void;
}

export function useFetch<T>(endpoint: string, refreshKey?: number): FetchState<T> {
    const [data, setData] = useState<T | null>(null);
    // We use this for preventing from the data clearing on changing the params of the endpoint
    const [loadedFor, setLoadedFor] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const controllerRef = useRef<AbortController | null>(null);

    const fetchData = useCallback(async () => {
        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        setLoading(true);
        setError(null);
        try {
            const result = await client<T>(endpoint, { signal: controller.signal });
            setData(result);
            setLoadedFor(endpoint);
        } catch (err) {
            // if we abort it, it doesn't have to display an error
            if (err instanceof Error && err.name === 'AbortError') return;
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            // also loading is set to false when aborted, might be changed in the future if we see fit
            setLoading(false);
        }
    }, [endpoint]);

    // fetchData is stable per endpoint, so a new URL arriving with a new tick is one fetch.
    useEffect(() => {
        fetchData();
        return () => controllerRef.current?.abort();
    }, [fetchData, refreshKey]);

    return { data, loading, stale: loadedFor !== endpoint, error, refetch: fetchData };
}