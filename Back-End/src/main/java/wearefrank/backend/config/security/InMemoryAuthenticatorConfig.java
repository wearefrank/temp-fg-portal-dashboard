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
import org.springframework.security.provisioning.InMemoryUserDetailsManager;

import java.util.List;

/**
 * Logs users in against a list of accounts in the configuration, for deployments without an
 * identity provider. No single sign-on, no group mapping and no git-token brokering: git
 * falls back to personal access tokens.
 */
@Configuration
@ConditionalOnProperty(name = OAuth2Properties.PREFIX + ".type", havingValue = InMemoryAuthenticatorConfig.TYPE)
@EnableConfigurationProperties(InMemoryUserProperties.class)
public class InMemoryAuthenticatorConfig implements ConsoleAuthenticator {

    public static final String TYPE = "IN_MEMORY";

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
        // loginPage points at the frontend route, so Spring does not generate its own page.
        // The POST uses a separate path so the dev server can serve the page and still
        // forward the submission to us.
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

        // Without this Spring Boot creates a default user with a random password, which
        // is a working account nobody configured.
        if (configured.isEmpty()) {
            throw new IllegalStateException(
                    OAuth2Properties.PREFIX + ".type is " + TYPE + " but no users are configured. "
                            + "Set " + InMemoryUserProperties.PREFIX + ".users[0].username/password/roles.");
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
}
