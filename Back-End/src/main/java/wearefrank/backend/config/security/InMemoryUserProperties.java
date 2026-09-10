package wearefrank.backend.config.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/**
 * Users for the IN_MEMORY authenticator. Accounts come from the configuration only: there
 * is no sign-up, password reset or account management. Use OIDC if you need those.
 */
@ConfigurationProperties(InMemoryUserProperties.PREFIX)
public record InMemoryUserProperties(List<ConsoleUser> users) {

    public static final String PREFIX = OAuth2Properties.PREFIX + ".in-memory";

    /** Password carries a password-encoder prefix, e.g. {bcrypt}$2a$10$... */
    public record ConsoleUser(String username, String password, List<String> roles) {}
}
