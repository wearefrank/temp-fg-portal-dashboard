package wearefrank.backend.config.security;

import org.springframework.security.config.annotation.web.builders.HttpSecurity;

/**
 * One way of logging into the console. Which implementation is active is decided by
 * console.security.auth.type; each owns its own property namespace and contributes its
 * own beans, so an inactive type costs nothing at runtime.
 *
 * Every implementation must end up with a real authenticated principal. A variant that
 * leaves requests anonymous would force every user-facing feature to carry a "there is
 * no user" branch forever, which is the one thing this indirection exists to avoid.
 */
public interface ConsoleAuthenticator {

    /**
     * The console's own login route, served by the frontend. Every authenticator points
     * Spring's login page here, so a rejected login lands on a page that can explain
     * itself instead of on whatever mechanism just refused.
     */
    String LOGIN_PAGE = "/login";

    /** The console.security.auth.type value this implementation answers to. */
    String type();

    /**
     * Where the frontend starts authentication. For a password form that is
     * {@link #LOGIN_PAGE} itself; for an identity provider it is the hand-off endpoint.
     */
    String loginUrl();

    /** Adds the login mechanism to the shared filter chain. */
    void configure(HttpSecurity http) throws Exception;
}
