package wearefrank.backend.config;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.savedrequest.HttpSessionRequestCache;
import org.springframework.security.web.util.matcher.NegatedRequestMatcher;
import wearefrank.backend.config.security.ConsoleAuthenticator;
import wearefrank.backend.config.security.InMemoryAuthenticatorConfig;
import wearefrank.backend.config.security.OAuth2Properties;
import wearefrank.backend.config.security.OidcAuthenticatorConfig;
import wearefrank.backend.config.security.SessionAuthenticationEntryPoint;

import static org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher.pathPattern;

/**
 * Security rules shared by every login method. The login method itself comes from the
 * {@link ConsoleAuthenticator} selected by application.security.console.authentication.type.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    SecurityFilterChain filterChain(HttpSecurity http, ObjectProvider<ConsoleAuthenticator> authenticators)
            throws Exception {

        // No authenticator means the type is unset or misspelled. Fail fast instead of
        // starting a console without login.
        ConsoleAuthenticator authenticator = authenticators.getIfAvailable();
        if (authenticator == null) {
            throw new IllegalStateException("No authenticator for " + OAuth2Properties.PREFIX
                    + ".type. Set it to " + OidcAuthenticatorConfig.TYPE
                    + " or " + InMemoryAuthenticatorConfig.TYPE + ".");
        }

        // Only remember page requests, so the post-login redirect never lands on an
        // /api endpoint that was requested by an XHR.
        HttpSessionRequestCache requestCache = new HttpSessionRequestCache();
        requestCache.setRequestMatcher(new NegatedRequestMatcher(pathPattern("/api/**")));

        http
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/actuator/health/**").permitAll()
                        // The login page renders before there is a session, and it asks
                        // which login mechanism to show.
                        .requestMatchers(ConsoleAuthenticator.LOGIN_PAGE, "/api/auth/mode").permitAll()
                        // The login page also needs its own bundle. Requiring authentication
                        // here answers the scripts with a 401, so the page never loads. These
                        // are build output only; everything with data is under /api.
                        .requestMatchers("/assets/**", "/vite.svg", "/favicon.ico").permitAll()
                        // Error dispatches pass through this chain too. Requiring
                        // authentication here turns any error into a login redirect loop.
                        .requestMatchers("/error").permitAll()
                        .anyRequest().authenticated())
                .csrf(csrf -> csrf.disable())
                .exceptionHandling(ex -> ex.defaultAuthenticationEntryPointFor(
                        new SessionAuthenticationEntryPoint(),
                        pathPattern("/api/**")))
                .requestCache(cache -> cache.requestCache(requestCache));

        authenticator.configure(http);

        return http.build();
    }
}
