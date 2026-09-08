import { client } from './client';
import { setGitLock, toGitProvider, type GitLock } from '../pages/history/gitSettingsStorage';

interface GitLockResponse {
    locked: boolean;
    provider: string;
    host: string;
    repo: string;
    branch: string;
    filePath: string;
}

/**
 * Whether this deployment pins the git connection. Never throws: an unreachable or older
 * backend simply means nothing is pinned, and the settings panel stays available. The
 * backend enforces the pin on every request regardless of what we do with this.
 */
export async function fetchGitLock(): Promise<GitLock | null> {
    try {
        const response = await client<GitLockResponse>('/git/settings');
        if (!response?.locked) {
            setGitLock(null);
            return null;
        }
        const lock: GitLock = {
            provider: toGitProvider(response.provider),
            host: response.host ?? '',
            repo: response.repo ?? '',
            branch: response.branch ?? '',
            filePath: response.filePath ?? '',
        };
        setGitLock(lock);
        return lock;
    } catch {
        setGitLock(null);
        return null;
    }
}
