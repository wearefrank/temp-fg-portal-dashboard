import { client } from './client';

/** Matches the backend's ConsoleAuthenticator implementations. */
export type AuthType = 'OIDC' | 'IN_MEMORY';

export interface AuthMode {
    type: AuthType;
    /** Where to send someone who needs to sign in. */
    loginUrl: string;
}

/**
 * Which authenticator this deployment runs. Deliberately reachable without a session:
 * it is what an unauthenticated visitor consults to find the way in.
 */
export async function fetchAuthMode(): Promise<AuthMode> {
    return client<AuthMode>('/auth/mode');
}
