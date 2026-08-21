import { describe, it, expect, beforeEach } from 'vitest';
import {
    getProviderHeaders,
    setLinkedProviders,
    GITHUB_STORAGE_KEY,
    GITLAB_STORAGE_KEY,
    GITEA_STORAGE_KEY,
    PROVIDER_STORAGE_KEY,
} from '../pages/history/gitSettingsStorage';

// The vitest environment is "node", so there is no localStorage to read.
function installLocalStorage(): void {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
        key: (index: number) => [...store.keys()][index] ?? null,
        get length() { return store.size; },
    } as Storage;
}

describe('getProviderHeaders', () => {
    beforeEach(() => {
        installLocalStorage();
        setLinkedProviders(new Set());
    });

    it('sends the stored personal access token when the provider is not linked', () => {
        localStorage.setItem(PROVIDER_STORAGE_KEY, 'github');
        localStorage.setItem(GITHUB_STORAGE_KEY, JSON.stringify({
            githubToken: 'ghp_secret', githubRepo: 'owner/repo', githubBranch: 'main', profiles: [],
        }));

        expect(getProviderHeaders('routes.yaml')).toEqual({
            'X-Git-Provider': 'github',
            'X-Github-Token': 'ghp_secret',
            'X-Github-Repo': 'owner/repo',
            'X-Github-Branch': 'main',
            'X-Github-File-Path': 'routes.yaml',
        });
    });

    it('omits the token header once GitHub is linked through Keycloak', () => {
        localStorage.setItem(PROVIDER_STORAGE_KEY, 'github');
        localStorage.setItem(GITHUB_STORAGE_KEY, JSON.stringify({
            githubToken: 'ghp_leftover', githubRepo: 'owner/repo', githubBranch: 'main', profiles: [],
        }));
        setLinkedProviders(new Set(['github']));

        const headers = getProviderHeaders('routes.yaml');

        // A token left over in localStorage must never go out once the account is linked.
        expect(headers).not.toHaveProperty('X-Github-Token');
        expect(Object.values(headers)).not.toContain('ghp_leftover');
        expect(headers['X-Github-Repo']).toBe('owner/repo');
    });

    it('omits the token header once GitLab is linked through Keycloak', () => {
        localStorage.setItem(PROVIDER_STORAGE_KEY, 'gitlab');
        localStorage.setItem(GITLAB_STORAGE_KEY, JSON.stringify({
            gitlabToken: 'glpat_leftover', gitlabHost: 'https://gitlab.com',
            gitlabProject: 'owner/project', gitlabBranch: 'main', profiles: [],
        }));
        setLinkedProviders(new Set(['gitlab']));

        const headers = getProviderHeaders('routes.yaml');

        expect(headers).not.toHaveProperty('X-Gitlab-Token');
        expect(headers['X-Gitlab-Project']).toBe('owner/project');
    });

    it('keeps sending the Gitea token, which is never brokered', () => {
        localStorage.setItem(PROVIDER_STORAGE_KEY, 'gitea');
        localStorage.setItem(GITEA_STORAGE_KEY, JSON.stringify({
            giteaToken: 'gitea_secret', giteaHost: 'https://gitea.example.com',
            giteaRepo: 'owner/repo', giteaBranch: 'main', profiles: [],
        }));
        setLinkedProviders(new Set(['github', 'gitlab', 'gitea']));

        expect(getProviderHeaders('routes.yaml')['X-Gitea-Token']).toBe('gitea_secret');
    });

    it('falls back to github when the stored settings are unreadable', () => {
        localStorage.setItem(PROVIDER_STORAGE_KEY, 'github');
        localStorage.setItem(GITHUB_STORAGE_KEY, '{not json');

        // A corrupt blob must not send a garbage token; the loader returns empty settings.
        expect(getProviderHeaders('routes.yaml')['X-Github-Token']).toBe('');
    });
});
