package wearefrank.backend.config;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.savedrequest.HttpSessionRequestCache;
import org.springframework.security.web.util.matcher.NegatedRequestMatcher;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import wearefrank.backend.config.security.ConsoleAuthenticator;

import static org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher.pathPattern;

/**
 * Everything the console's security has in common, whichever way users log in. The login
 * mechanism itself comes from the {@link ConsoleAuthenticator} selected by
 * console.security.auth.type - keeping the shared parts here means a new authenticator
 * cannot quietly miss one of them.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    SecurityFilterChain filterChain(HttpSecurity http, ObjectProvider<ConsoleAuthenticator> authenticators)
            throws Exception {

        // No authenticator means the type is unset or misspelled. Refusing to start is the
        // point: the alternative is a console that silently serves everything unauthenticated.
        ConsoleAuthenticator authenticator = authenticators.getIfAvailable();
        if (authenticator == null) {
            throw new IllegalStateException(
                    "No authenticator for console.security.auth.type. Set it to OIDC or IN_MEMORY.");
        }

//        CsrfTokenRequestAttributeHandler csrfHandler = new CsrfTokenRequestAttributeHandler();
//        csrfHandler.setCsrfRequestAttributeName(null);

        // Only remember page navigations. Without this an XHR that hits the 401 entry point
        // gets saved and replayed as the post-login redirect, dumping the user on a JSON endpoint.
        HttpSessionRequestCache requestCache = new HttpSessionRequestCache();
        requestCache.setRequestMatcher(new NegatedRequestMatcher(pathPattern("/api/**")));

        http
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/actuator/health/**").permitAll()
                        // The login page has to render before there is a session, and it is the
                        // page that asks which login mechanism to show.
                        .requestMatchers(ConsoleAuthenticator.LOGIN_PAGE, "/api/auth/mode").permitAll()
                        // ...and the login page cannot render without its own bundle. Left
                        // authenticated, the SPA's script and stylesheet are answered by the
                        // entry point below rather than served: a script asks for */* instead
                        // of HTML, so it misses formLogin's media type matcher and gets the
                        // bodyless 401. The page that asks for credentials then never boots,
                        // and all the browser reports is a blocked empty MIME type. Only build
                        // output lives here - everything that reads or writes is under /api.
                        .requestMatchers("/assets/**", "/vite.svg", "/favicon.ico").permitAll()
                        // Error dispatches run through this chain too. Leaving /error to
                        // authentication turns any error raised while signed out into a
                        // redirect back to the login page, which is a loop rather than an answer.
                        .requestMatchers("/error").permitAll()
                        .anyRequest().authenticated())
//                .csrf(csrf -> csrf
//                        .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
//                        .csrfTokenRequestHandler(csrfHandler))

                .exceptionHandling(ex -> ex.defaultAuthenticationEntryPointFor(
                        new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED), // TODO: create better error showcase
                        pathPattern("/api/**")))
                .requestCache(cache -> cache.requestCache(requestCache));

        authenticator.configure(http);

        return http.build();
    }
}
