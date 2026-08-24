package wearefrank.backend.config.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientManager;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;

import java.util.List;

/**
 * Logs the console in against users listed in configuration, for deployments that cannot
 * run an identity provider. Everything OIDC gets from Keycloak - single sign-on, group
 * mapping, git-token brokering - is simply absent here; git falls back to personal access
 * tokens, which {@code VersioningController} already prefers when present.
 */
@Configuration
@ConditionalOnProperty(name = "console.security.auth.type", havingValue = InMemoryAuthenticatorConfig.TYPE)
@EnableConfigurationProperties(InMemoryUserProperties.class)
public class InMemoryAuthenticatorConfig implements ConsoleAuthenticator {

    static final String TYPE = "IN_MEMORY";

    private static final Logger log = LoggerFactory.getLogger(InMemoryAuthenticatorConfig.class);

    @Override
    public String type() {
        return TYPE;
    }

    @Override
    public String loginUrl() {
        return LOGIN_PAGE;
    }

    @Override
    public void configure(HttpSecurity http) throws Exception {
        // loginPage points at the SPA's own route, so Spring stops generating a page of its
        // own. The POST goes to a separate path rather than back to /login: the dev server
        // has to serve the page itself while forwarding the submission to us, and it can
        // only tell the two apart by path.
        http.formLogin(form -> form
                .loginPage(loginUrl())
                .loginProcessingUrl("/login/password")
                .failureUrl(loginUrl() + "?error")
                .permitAll());
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    @Bean
    UserDetailsService userDetailsService(InMemoryUserProperties properties) {
        List<InMemoryUserProperties.ConsoleUser> configured =
                properties.users() == null ? List.of() : properties.users();

        // Failing here beats Spring Boot's fallback, which invents a user with a random
        // password and prints it to the log - a working account nobody provisioned.
        if (configured.isEmpty()) {
            throw new IllegalStateException(
                    "console.security.auth.type is " + TYPE + " but no users are configured. "
                            + "Set console.security.auth.in-memory.users[0].username/password/roles.");
        }

        List<UserDetails> users = configured.stream().map(this::toUserDetails).toList();
        return new InMemoryUserDetailsManager(users);
    }

    private UserDetails toUserDetails(InMemoryUserProperties.ConsoleUser configured) {
        if (configured.password() == null || configured.password().isBlank()) {
            throw new IllegalStateException("No password configured for console user " + configured.username());
        }
        if (configured.password().startsWith("{noop}")) {
            log.warn("Console user {} has an unhashed password; use a {} hash outside local development.",
                    configured.username(), "{bcrypt}");
        }

        List<String> roles = configured.roles() == null ? List.of() : configured.roles();
        return User.withUsername(configured.username())
                .password(configured.password())
                .roles(roles.toArray(String[]::new))
                .build();
    }

    /**
     * Placeholder so {@code GitIdentityService} still wires up. It is never consulted:
     * that service short-circuits on a blank issuer URI, which is the state here.
     */
    @Bean
    OAuth2AuthorizedClientManager authorizedClientManager() {
        return request -> null;
    }
}
