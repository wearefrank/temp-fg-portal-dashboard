package wearefrank.backend.config.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/**
 * Users for the IN_MEMORY authenticator. Provisioned by whoever runs the console: there
 * is no sign-up, no password reset and no account management UI, by design. A deployment
 * that needs those wants OIDC instead.
 */
@ConfigurationProperties("console.security.auth.in-memory")
public record InMemoryUserProperties(List<ConsoleUser> users) {

    /** Password carries a password-encoder prefix, e.g. {bcrypt}$2a$10$... */
    public record ConsoleUser(String username, String password, List<String> roles) {}
}
