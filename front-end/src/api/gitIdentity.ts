import { client } from './client';
import { setLinkedProviders, type GitProvider } from '../pages/history/gitSettingsStorage';

/**
 * Link status of one git provider brokered through Keycloak.
 * available - this deployment brokers the provider at all.
 * linked    - the user connected their account, so the backend can read a token for it.
 */
export interface GitIdentity {
    available: boolean;
    linked: boolean;
    /** Account name at the provider, null when Keycloak could not tell us. */
    username: string | null;
}

export type GitIdentityMap = Partial<Record<GitProvider, GitIdentity>>;

/**
 * Never throws: a deployment without brokered identity providers is a normal state, and
 * the personal-access-token fields are the fallback for it.
 */
export async function fetchGitIdentities(): Promise<GitIdentityMap> {
    let identities: GitIdentityMap = {};
    try {
        identities = await client<GitIdentityMap>('/git/identity');
    } catch {
        identities = {};
    }

    const linked = new Set<GitProvider>();
    for (const [provider, status] of Object.entries(identities)) {
        if (status?.linked) linked.add(provider as GitProvider);
    }
    setLinkedProviders(linked);

    return identities;
}

/**
 * Sends the browser to Keycloak to link the account. This has to be a full page
 * navigation, the same as login: the flow redirects on through GitHub/GitLab, which a
 * fetch() cannot follow. The URL is minted per click because its hash is bound to the
 * current Keycloak session.
 */
export async function startGitLink(provider: GitProvider): Promise<void> {
    const { url } = await client<{ url: string }>(`/git/${provider}/link`, { method: 'POST' });
    window.location.href = url;
}
