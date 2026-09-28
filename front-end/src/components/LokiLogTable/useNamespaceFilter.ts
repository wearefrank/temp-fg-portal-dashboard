import { useMemo, useState } from 'react';
import { useFetch } from '../../hooks/useFetch';
import type { LogEntry } from './types';

/** "No namespace filter". The empty string, so it doubles as the falsy check. */
export const ALL_NAMESPACES = '';

/**
 * Narrows the rows to one namespace, in the browser.
 * Namespaces are gotten from the LOKI_NAMESPACE
 */
export function useNamespaceFilter(entries: LogEntry[]) {
    const [namespace, setNamespace] = useState<string>(ALL_NAMESPACES);
    const known = useFetch<string[]>('/logs/namespaces').data ?? [];

    const visibleEntries = useMemo(
        () => (namespace === ALL_NAMESPACES ? entries : entries.filter(e => e.namespace === namespace)),
        [entries, namespace],
    );

    return { namespace, setNamespace, known, visibleEntries };
}
