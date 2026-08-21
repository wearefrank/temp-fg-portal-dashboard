const LOGIN_URL = '/oauth2/authorization/keycloak';

// Methods the CSRF filter lets through without a token.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

/**
 * Reads the CSRF token Spring Security writes into the (deliberately non-HttpOnly)
 * XSRF-TOKEN cookie. Returns null outside the browser, e.g. under vitest.
 */
export function getCsrfToken(): string | null {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Starts the OIDC login. This has to be a full page navigation: the flow redirects
 * through Keycloak and back, which a fetch() cannot follow.
 */
export function redirectToLogin(): void {
    if (typeof window === 'undefined') return;
    window.location.href = LOGIN_URL;
}

/**
 * Logs out of both the app and Keycloak.
 *
 * Submitted as a real form rather than a fetch() for two reasons: Spring requires a
 * POST with a CSRF token (a plain link would be a 403), and the response redirects to
 * Keycloak's end_session_endpoint, which only a browser navigation can follow. Using
 * fetch() here would clear the local session but leave the Keycloak SSO session alive,
 * so the next login would silently sign the same user straight back in.
 */
export function logout(): void {
    if (typeof document === 'undefined') return;

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/logout';

    const csrf = document.createElement('input');
    csrf.type = 'hidden';
    csrf.name = '_csrf'; // form parameter; the header variant is only for XHR
    csrf.value = getCsrfToken() ?? '';
    form.appendChild(csrf);

    document.body.appendChild(form);
    form.submit();
}

/**
 * fetch() wrapper that keeps the session working: sends the CSRF token on writes and
 * bounces to Keycloak when the session is gone. Use this instead of bare fetch() for
 * anything under /api.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);

    if (!SAFE_METHODS.has(method)) {
        const token = getCsrfToken();
        if (token) headers.set('X-XSRF-TOKEN', token);
    }

    const response = await fetch(input, { ...init, headers, credentials: 'same-origin' });

    if (response.status === 401) {
        redirectToLogin();
        throw new Error('Not authenticated - redirecting to login');
    }

    return response;
}
