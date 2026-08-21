import type { GithubSettings, GitlabSettings, GiteaSettings } from './types';
import { migrateGithubSettings, migrateGitlabSettings, migrateGiteaSettings } from './types';

export type GitProvider = 'github' | 'gitlab' | 'gitea';

export const GITHUB_STORAGE_KEY = 'github-settings';
export const GITLAB_STORAGE_KEY = 'gitlab-settings';
export const GITEA_STORAGE_KEY = 'gitea-settings';
export const PROVIDER_STORAGE_KEY = 'git-provider';

/**
 * Providers whose token comes from Keycloak. Kept at module level rather than in React
 * state because getProviderHeaders() runs outside the component tree, and a stale token
 * left over in localStorage must never be sent once the account is linked.
 */
let linkedProviders: ReadonlySet<GitProvider> = new Set();

export function setLinkedProviders(providers: ReadonlySet<GitProvider>): void {
    linkedProviders = providers;
}

export function isLinked(provider: GitProvider): boolean {
    return linkedProviders.has(provider);
}

export function loadGithubSettings(): GithubSettings {
    try {
        const stored = localStorage.getItem(GITHUB_STORAGE_KEY);
        if (stored) return migrateGithubSettings(JSON.parse(stored));
    } catch {
        // ignore parse errors
    }
    return { githubToken: '', githubRepo: '', githubBranch: '', profiles: [] };
}

export function loadGitlabSettings(): GitlabSettings {
    try {
        const stored = localStorage.getItem(GITLAB_STORAGE_KEY);
        if (stored) return migrateGitlabSettings(JSON.parse(stored));
    } catch {
        // ignore parse errors
    }
    return { gitlabToken: '', gitlabHost: '', gitlabProject: '', gitlabBranch: '', profiles: [] };
}

export function loadGiteaSettings(): GiteaSettings {
    try {
        const stored = localStorage.getItem(GITEA_STORAGE_KEY);
        if (stored) return migrateGiteaSettings(JSON.parse(stored));
    } catch {
        // ignore parse errors
    }
    return { giteaToken: '', giteaHost: '', giteaRepo: '', giteaBranch: '', profiles: [] };
}

export function loadProvider(): GitProvider {
    const stored = localStorage.getItem(PROVIDER_STORAGE_KEY);
    if (stored === 'gitlab' || stored === 'gitea') return stored;
    return 'github';
}

/**
 * Per-request git settings for the backend. filePathOverride replaces the file path from
 * localStorage when provided.
 *
 * Token headers are omitted for linked providers: the backend then reads the token from
 * the user's Keycloak account link instead, and it never passes through the browser.
 */
export function getProviderHeaders(filePathOverride?: string): Record<string, string> {
    try {
        const provider = loadProvider();
        if (provider === 'gitlab') {
            const s = loadGitlabSettings();
            const filePath = filePathOverride !== undefined ? filePathOverride : '';
            return withToken({
                'X-Git-Provider': 'gitlab',
                'X-Gitlab-Host': s.gitlabHost || '',
                'X-Gitlab-Project': s.gitlabProject || '',
                'X-Gitlab-Branch': s.gitlabBranch || '',
                'X-Gitlab-File-Path': filePath,
            }, 'gitlab', 'X-Gitlab-Token', s.gitlabToken);
        }
        if (provider === 'gitea') {
            const s = loadGiteaSettings();
            const filePath = filePathOverride !== undefined ? filePathOverride : '';
            return {
                'X-Git-Provider': 'gitea',
                'X-Gitea-Token': s.giteaToken || '',
                'X-Gitea-Host': s.giteaHost || '',
                'X-Gitea-Repo': s.giteaRepo || '',
                'X-Gitea-Branch': s.giteaBranch || '',
                'X-Gitea-File-Path': filePath,
            };
        }
        const s = loadGithubSettings();
        const filePath = filePathOverride !== undefined ? filePathOverride : '';
        return withToken({
            'X-Git-Provider': 'github',
            'X-Github-Repo': s.githubRepo || '',
            'X-Github-Branch': s.githubBranch || '',
            'X-Github-File-Path': filePath,
        }, 'github', 'X-Github-Token', s.githubToken);
    } catch {
        return { 'X-Git-Provider': 'github' };
    }
}

function withToken(
    headers: Record<string, string>,
    provider: GitProvider,
    headerName: string,
    token: string | undefined
): Record<string, string> {
    if (isLinked(provider)) return headers;
    return { ...headers, [headerName]: token || '' };
}
