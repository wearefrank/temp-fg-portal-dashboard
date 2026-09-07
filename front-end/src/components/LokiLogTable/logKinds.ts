import type { LogKind, LogKinds } from './types';

/**
 * The kinds a panel was pointed at, deduped and in a fixed order. Sorted rather than left as
 * given, so one table cannot produce two ?type= spellings and two fetch caches - the server
 * canonicalises the set itself, so the order is ours to pick.
 */
export function normalizeKinds(kind: LogKinds): LogKind[] {
    const kinds = Array.isArray(kind) ? kind : [kind];
    return [...new Set(kinds)].sort();
}

/** The ?type= the endpoints take: the normalised kinds, comma-separated. */
export function kindParam(kind: LogKinds): string {
    return normalizeKinds(kind).join(',');
}
