import { useState, useEffect, useCallback, useRef } from 'react';
import { client } from '../api/client';
import { apiFetch } from '../api/auth';

const GITHUB_STORAGE_KEY = 'github-settings';
const GITLAB_STORAGE_KEY = 'gitlab-settings';
const GITEA_STORAGE_KEY = 'gitea-settings';
const PROVIDER_STORAGE_KEY = 'git-provider';

// filePathOverride replaces the file path from localStorage when provided.
function getProviderHeaders(filePathOverride?: string): Record<string, string> {
    try {
        const provider = localStorage.getItem(PROVIDER_STORAGE_KEY) ?? 'github';
        if (provider === 'gitlab') {
            const stored = localStorage.getItem(GITLAB_STORAGE_KEY);
            const s = stored ? JSON.parse(stored) : {};
            const filePath = filePathOverride !== undefined ? filePathOverride : (s.gitlabFilePath || '');
            return {
                'X-Git-Provider': 'gitlab',
                'X-Gitlab-Token': s.gitlabToken || '',
                'X-Gitlab-Host': s.gitlabHost || '',
                'X-Gitlab-Project': s.gitlabProject || '',
                'X-Gitlab-Branch': s.gitlabBranch || '',
                'X-Gitlab-File-Path': filePath,
            };
        }
        if (provider === 'gitea') {
            const stored = localStorage.getItem(GITEA_STORAGE_KEY);
            const s = stored ? JSON.parse(stored) : {};
            const filePath = filePathOverride !== undefined ? filePathOverride : (s.giteaFilePath || '');
            return {
                'X-Git-Provider': 'gitea',
                'X-Gitea-Token': s.giteaToken || '',
                'X-Gitea-Host': s.giteaHost || '',
                'X-Gitea-Repo': s.giteaRepo || '',
                'X-Gitea-Branch': s.giteaBranch || '',
                'X-Gitea-File-Path': filePath,
            };
        }
        const stored = localStorage.getItem(GITHUB_STORAGE_KEY);
        const s = stored ? JSON.parse(stored) : {};
        const filePath = filePathOverride !== undefined ? filePathOverride : (s.githubFilePath || '');
        return {
            'X-Git-Provider': 'github',
            'X-Github-Token': s.githubToken || '',
            'X-Github-Repo': s.githubRepo || '',
            'X-Github-Branch': s.githubBranch || '',
            'X-Github-File-Path': filePath,
        };
    } catch {
        return { 'X-Git-Provider': 'github' };
    }
}

export interface VersionSummary {
    id: string;
    message: string;
    createdAt: string;
    commitUrl?: string;
    author?: string;
}

interface VersionDetail extends VersionSummary {
    content: string;
}

interface UseVersionHistory {
    versions: VersionSummary[] | null;
    loading: boolean;
    error: string | null;
    refetch: () => void;
    clearCache: () => void;
    saveVersion: (message: string, content: string) => Promise<void>;
    fetchVersionContent: (id: string, filePathOverride?: string) => Promise<string>;
    loadFileContent: (filePathOverride?: string) => Promise<string>;
}

// module-level caches keyed by file path so multiple files can be cached simultaneously
const cachedVersions = new Map<string, VersionSummary[]>();
const cachedLatestId = new Map<string, string>();
const cachedContent = new Map<string, string>();

// One-shot fetch of versions for a given file path; no polling or caching.
// Used by the compare panel to populate per-side version dropdowns.
export async function fetchVersionsForFile(filePath: string): Promise<VersionSummary[]> {
    return client<VersionSummary[]>('/versions', { headers: getProviderHeaders(filePath) });
}

// Check whether a file path exists in the configured repo at the configured branch.
export async function checkFileExists(filePath: string): Promise<boolean> {
    return client<boolean>('/versions/exists', { method: 'GET', headers: getProviderHeaders(filePath) });
}

export function useVersionHistory(filePath: string): UseVersionHistory {
    // Tracks the filePath for which the current `versions` state was fetched.
    // When it differs from `filePath`, the caller gets a derived value from cache instead.
    const [fetchedForPath, setFetchedForPath] = useState<string>(filePath);
    const [versions, setVersions] = useState<VersionSummary[] | null>(cachedVersions.get(filePath) ?? null);
    const [error, setError] = useState<string | null>(null);
    const controllerRef = useRef<AbortController | null>(null);

    // When filePath changed but the fetch hasn't completed yet, show cached data (or null for loading).
    // This avoids showing the previous file's stale versions AND avoids synchronous setState in effects.
    let displayedVersions: VersionSummary[] | null;
    if (!filePath) {
        displayedVersions = [];
    } else if (fetchedForPath !== filePath) {
        displayedVersions = cachedVersions.get(filePath) ?? null;
    } else {
        displayedVersions = versions;
    }
    const displayedError = fetchedForPath === filePath ? error : null;

    const fetchVersions = useCallback(async () => {
        if (!filePath) return;
        // abort any in-flight request before starting a new one
        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        try {
            const data = await client<VersionSummary[]>('/versions', { signal: controller.signal, headers: getProviderHeaders(filePath) });
            // only update state when the list actually changed (avoids unnecessary re-renders)
            const latestId = data[0]?.id ?? null;
            if (latestId !== (cachedLatestId.get(filePath) ?? null)) {
                cachedVersions.set(filePath, data);
                if (latestId) cachedLatestId.set(filePath, latestId);
                setVersions(data);
            }
            setFetchedForPath(filePath);
            setError(null);
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') return;
            setError(err instanceof Error ? err.message : 'An error occurred');
            cachedVersions.delete(filePath);
            cachedLatestId.delete(filePath);
            setVersions([]);
            setFetchedForPath(filePath);
        }
    }, [filePath]);

    useEffect(() => {
        fetchVersions();
        // poll every 60 s so the list stays fresh in long-running sessions
        const interval = setInterval(fetchVersions, 60_000);
        return () => {
            controllerRef.current?.abort();
            clearInterval(interval);
        };
    }, [fetchVersions]);

    const saveVersion = async (message: string, content: string): Promise<void> => {
        const newVersion = await client<VersionSummary>('/versions', { body: { message, content }, headers: getProviderHeaders(filePath) });
        // optimistically prepend the new version, then refetch to confirm
        const existing = cachedVersions.get(filePath) ?? [];
        cachedVersions.set(filePath, [newVersion, ...existing]);
        cachedLatestId.set(filePath, newVersion.id);
        setVersions([newVersion, ...existing]);
        setFetchedForPath(filePath);
        fetchVersions();
    };

    const fetchVersionContent = async (id: string, filePathOverride?: string): Promise<string> => {
        const resolvedPath = filePathOverride !== undefined ? filePathOverride : filePath;
        const cacheKey = `${resolvedPath}::${id}`;
        // content never changes for a given commit sha + file path, so it's safe to cache indefinitely
        const hit = cachedContent.get(cacheKey);
        if (hit !== undefined) return hit;
        const detail = await client<VersionDetail>(`/versions/${id}`, { method: 'GET', headers: getProviderHeaders(resolvedPath) });
        cachedContent.set(cacheKey, detail.content);
        return detail.content;
    };

    // loads the current HEAD file directly from the repo (not a specific commit)
    const loadFileContent = async (filePathOverride?: string): Promise<string> => {
        const resolvedPath = filePathOverride !== undefined ? filePathOverride : filePath;
        const response = await apiFetch('/api/versions/file', { headers: getProviderHeaders(resolvedPath) });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || `HTTP ${response.status}`);
        }
        return response.text();
    };

    const clearCache = () => {
        cachedVersions.delete(filePath);
        cachedLatestId.delete(filePath);
        setVersions(null);
        setFetchedForPath('');
    };

    return {
        versions: displayedVersions,
        loading: displayedVersions === null,
        error: displayedError,
        refetch: fetchVersions,
        clearCache,
        saveVersion,
        fetchVersionContent,
        loadFileContent,
    };
}
