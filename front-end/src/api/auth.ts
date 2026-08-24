/**
 * The console's own login route, not the identity provider's. Which mechanism it ends up
 * using depends on the authenticator the backend runs, which /api/auth/mode reports.
 */
export const LOGIN_URL = '/login';

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
 * Sends the user to the login page. A full page navigation rather than a route change:
 * an OIDC login redirects out to the provider and back, which a fetch() cannot follow.
 */
export function redirectToLogin(): void {
    if (typeof window === 'undefined') return;

    // Already there. Without this a 401 raised by the login page itself would reload it
    // forever instead of letting the user sign in.
    if (window.location.pathname === LOGIN_URL) return;

    window.location.href = LOGIN_URL;
}

/**
 * Logs out of the app, and of the identity provider too when there is one.
 *
 * Submitted as a real form rather than a fetch() for two reasons: Spring requires a
 * POST with a CSRF token (a plain link would be a 403), and under OIDC the response
 * redirects to the provider's end_session_endpoint, which only a browser navigation can
 * follow. Using fetch() there would clear the local session but leave the SSO session
 * alive, so the next login would silently sign the same user straight back in.
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
 * bounces to the login page when the session is gone. Use this instead of bare fetch()
 * for anything under /api.
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
