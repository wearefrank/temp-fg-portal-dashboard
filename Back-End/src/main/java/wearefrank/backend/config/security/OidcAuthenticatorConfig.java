package wearefrank.backend.config.security;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientProviderBuilder;
import org.springframework.security.oauth2.client.oidc.web.logout.OidcClientInitiatedLogoutSuccessHandler;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.ClientRegistrations;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;

/**
 * Logs the console in through an OpenID Connect provider. This is the default and the
 * only type that supports single sign-on, group mapping and git-token brokering.
 */
@Configuration
@ConditionalOnProperty(name = "console.security.auth.type", havingValue = OidcAuthenticatorConfig.TYPE)
@EnableConfigurationProperties(OidcProperties.class)
public class OidcAuthenticatorConfig implements ConsoleAuthenticator {

    static final String TYPE = "OIDC";

    /**
     * Part of the login URL the frontend navigates to and of the redirect_uri registered
     * with the provider, so it is effectively public API - renaming it breaks both.
     */
    public static final String REGISTRATION_ID = "keycloak";

    private final OidcProperties properties;

    public OidcAuthenticatorConfig(OidcProperties properties) {
        this.properties = properties;
    }

    @Override
    public String type() {
        return TYPE;
    }

    @Override
    public String loginUrl() {
        return "/oauth2/authorization/" + REGISTRATION_ID;
    }

    @Override
    public void configure(HttpSecurity http) throws Exception {
        OidcClientInitiatedLogoutSuccessHandler logoutSuccessHandler =
                new OidcClientInitiatedLogoutSuccessHandler(clientRegistrationRepository());
        logoutSuccessHandler.setPostLogoutRedirectUri("{baseUrl}");

        // The console's page, not the hand-off endpoint. Naming a custom page is what stops
        // Spring generating one at /login - it only skips that by itself when it can
        // enumerate registrations, and the lazy repository deliberately cannot. Pointing it
        // at the hand-off endpoint instead would loop forever whenever the provider is
        // unreachable, because a failed authorization request redirects back to the login
        // page, which would be the request that just failed.
        http
                .oauth2Login(oauth2 -> oauth2.loginPage(LOGIN_PAGE))
                .logout(logout -> logout.logoutSuccessHandler(logoutSuccessHandler));
    }

    @Bean
    ClientRegistrationRepository clientRegistrationRepository() {
        return new LazyClientRegistrationRepository(REGISTRATION_ID, this::loadRegistration);
    }

    private ClientRegistration loadRegistration() {
        return ClientRegistrations.fromIssuerLocation(properties.issuerUri())
                .registrationId(REGISTRATION_ID)
                .clientId(properties.clientId())
                .clientSecret(properties.clientSecret())
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri("{baseUrl}/login/oauth2/code/{registrationId}")
                .scope(properties.scope())
                .build();
    }

    /**
     * Lets the app reuse the login's access token for its own calls to the provider, and
     * refresh it when it expires. oauth2Login by itself never refreshes, and Keycloak's
     * access tokens live an hour - shorter than a working session, so without this the
     * broker-token lookups would start failing mid-session.
     */
    @Bean
    OAuth2AuthorizedClientManager authorizedClientManager(
            ClientRegistrationRepository clientRegistrations,
            OAuth2AuthorizedClientRepository authorizedClients) {

        DefaultOAuth2AuthorizedClientManager manager =
                new DefaultOAuth2AuthorizedClientManager(clientRegistrations, authorizedClients);
        manager.setAuthorizedClientProvider(OAuth2AuthorizedClientProviderBuilder.builder()
                .authorizationCode()
                .refreshToken()
                .build());
        return manager;
    }
}
