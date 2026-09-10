package wearefrank.backend.config.security;

import org.springframework.security.config.annotation.web.builders.HttpSecurity;

/**
 * One way of logging into the console. The active implementation is picked by
 * application.security.console.authentication.type.
 *
 * Every implementation must produce a real authenticated user; anonymous access is not
 * supported.
 */
public interface ConsoleAuthenticator {

    /** The login page, served by the frontend. All authenticators redirect here. */
    String LOGIN_PAGE = "/login";

    /** The authentication type value this implementation answers to. */
    String type();

    /** Where the frontend starts login: the login page, or an identity provider endpoint. */
    String loginUrl();

    /** Whether this mechanism can supply a git provider token. Only OIDC can. */
    default boolean brokersGitTokens() {
        return false;
    }

    /** Adds the login mechanism to the shared filter chain. */
    void configure(HttpSecurity http) throws Exception;
}
