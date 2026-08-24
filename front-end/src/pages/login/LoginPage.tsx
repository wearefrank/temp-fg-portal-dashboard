import React, { useEffect, useRef, useState } from 'react';
import { getCsrfToken } from '../../api/auth';
import { fetchAuthMode, type AuthMode } from '../../api/authMode';
import styles from './LoginPage.module.css';

type View = 'loading' | 'ready' | 'redirecting' | 'unavailable';

/**
 * The way in, for whichever authenticator the backend runs. With an identity provider
 * there is normally nothing to show and we hand straight over to it; with local accounts
 * this is the password form. Asking the backend rather than building the choice in keeps
 * the frontend working against either without a rebuild.
 */
export const LoginPage: React.FC = () => {
    const [view, setView] = useState<View>('loading');
    const [mode, setMode] = useState<AuthMode | null>(null);
    const csrfField = useRef<HTMLInputElement>(null);

    // Spring bounces a rejected login back here with ?error, and a completed logout with ?logout.
    const [params] = useState(() => new URLSearchParams(window.location.search));
    const failed = params.has('error');
    const signedOut = params.has('logout');

    useEffect(() => {
        let cancelled = false;

        fetchAuthMode()
            .then(next => {
                if (cancelled) return;
                setMode(next);

                // Never hand straight back to a provider that just turned us away: that is a
                // redirect loop, and an unreachable provider would spin in it indefinitely.
                if (next.type === 'OIDC' && !failed) {
                    setView('redirecting');
                    window.location.href = next.loginUrl;
                    return;
                }
                setView('ready');
            })
            .catch(() => {
                if (!cancelled) setView('unavailable');
            });

        return () => { cancelled = true; };
    }, [failed]);

    /**
     * The token is read here rather than at render because the cookie only arrives with
     * the first response from the backend, which may still be in flight when this mounts.
     */
    const attachCsrfToken = () => {
        if (csrfField.current) csrfField.current.value = getCsrfToken() ?? '';
    };

    const errorMessage = mode?.type === 'OIDC'
        ? 'Signing in with your identity provider did not work. It may be unavailable - try again in a moment.'
        // Never say which half was wrong: that tells an attacker which usernames exist.
        : 'Invalid username or password.';

    return (
        <div className={styles.page}>
            <div className={styles.card}>
                <h1 className={styles.brand}>
                    <span className={styles.brandAccent}>Frank<b>!</b></span>Gateway
                </h1>
                <p className={styles.subtitle}>Sign in to the gateway console</p>

                {failed && view === 'ready' && <p className={styles.error}>{errorMessage}</p>}
                {signedOut && !failed && <p className={styles.status}>You have been signed out.</p>}

                {view === 'loading' && <p className={styles.status}>Loading...</p>}
                {view === 'redirecting' && <p className={styles.status}>Redirecting to your identity provider...</p>}
                {view === 'unavailable' && (
                    <p className={styles.status}>
                        The console is not reachable right now. Try again in a moment.
                    </p>
                )}

                {view === 'ready' && mode?.type === 'OIDC' && (
                    <button
                        type="button"
                        className={`btn-primary ${styles.submit}`}
                        onClick={() => { window.location.href = mode.loginUrl; }}
                    >
                        Try again
                    </button>
                )}

                {view === 'ready' && mode?.type === 'IN_MEMORY' && (
                    <form
                        className={styles.form}
                        method="post"
                        action="/login/password"
                        onSubmit={attachCsrfToken}
                    >
                        <label className={styles.label} htmlFor="username">Username</label>
                        <input
                            className={styles.input}
                            id="username"
                            name="username"
                            autoComplete="username"
                            autoFocus
                            required
                        />

                        <label className={styles.label} htmlFor="password">Password</label>
                        <input
                            className={styles.input}
                            id="password"
                            name="password"
                            type="password"
                            autoComplete="current-password"
                            required
                        />

                        <input type="hidden" name="_csrf" ref={csrfField} />

                        <button type="submit" className={`btn-primary ${styles.submit}`}>Sign in</button>
                    </form>
                )}
            </div>
        </div>
    );
};
