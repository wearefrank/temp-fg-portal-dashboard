import { useMemo, useState } from 'react';
import type { LogEntry } from './types';

/** "No namespace filter". The empty string, so it doubles as the falsy check. */
export const ALL_NAMESPACES = '';

/**
 * Narrows the rows to one namespace, in the browser.
 *
 * It hides rows of the page already fetched rather than asking Loki for a narrower set - so it
 * costs no round trip, but it cannot reach lines that are not on this page. The row count, the
 * page count and the pager all still describe the unfiltered result; the subtitle says so.
 */
export function useNamespaceFilter(entries: LogEntry[]) {
    const [namespace, setNamespace] = useState<string>(ALL_NAMESPACES);

    // Accumulated across the pages seen, not taken from the current one: a page holding a
    // single namespace would otherwise shrink the menu and drop the reader's own choice out
    // of it. Merged during render, the way useLogPage adjusts its page number.
    const [known, setKnown] = useState<string[]>([]);
    const [seenEntries, setSeenEntries] = useState<LogEntry[] | null>(null);
    if (seenEntries !== entries) {
        setSeenEntries(entries);
        const merged = mergeNamespaces(known, entries);
        // merged is always a superset, so equal lengths mean nothing is new.
        if (merged.length !== known.length) setKnown(merged);
    }

    const visibleEntries = useMemo(
        () => (namespace === ALL_NAMESPACES ? entries : entries.filter(e => e.namespace === namespace)),
        [entries, namespace],
    );

    return { namespace, setNamespace, known, visibleEntries };
}

function mergeNamespaces(known: string[], entries: LogEntry[]): string[] {
    const onThisPage = entries
        .map(entry => entry.namespace)
        .filter((ns): ns is string => ns != null);
    return [...new Set([...known, ...onThisPage])].sort();
}
