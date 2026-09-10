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
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;

import java.util.Map;

/**
 * Logs the console in through an OpenID Connect provider. This is the default and the
 * only type that supports single sign-on, group mapping and git-token brokering.
 */
@Configuration
@ConditionalOnProperty(name = OAuth2Properties.PREFIX + ".type", havingValue = OidcAuthenticatorConfig.TYPE)
@EnableConfigurationProperties(OAuth2Properties.class)
public class OidcAuthenticatorConfig implements ConsoleAuthenticator {

    /** Named to match the Frank!Framework console, so both read the same settings file. */
    public static final String TYPE = "OAUTH2";

    /**
     * Appears in the login URL and in the redirect_uri registered with the provider, so
     * renaming it breaks both.
     */
    public static final String REGISTRATION_ID = "keycloak";

    private final OAuth2Properties properties;

    public OidcAuthenticatorConfig(OAuth2Properties properties) {
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

    /** The only authenticator that can fetch a git token from the provider for the user. */
    @Override
    public boolean brokersGitTokens() {
        return true;
    }

    @Override
    public void configure(HttpSecurity http) throws Exception {
        OidcClientInitiatedLogoutSuccessHandler logoutSuccessHandler =
                new OidcClientInitiatedLogoutSuccessHandler(clientRegistrationRepository());
        logoutSuccessHandler.setPostLogoutRedirectUri("{baseUrl}");

        http.oauth2Login(oauth2 -> oauth2
                        .loginPage(LOGIN_PAGE)
                        .userInfoEndpoint(userInfo -> userInfo.oidcUserService(oidcUserService())))
                .logout(logout -> logout.logoutSuccessHandler(logoutSuccessHandler));
    }

    @Bean
    ClientRegistrationRepository clientRegistrationRepository() {
        return new LazyClientRegistrationRepository(REGISTRATION_ID, this::buildRegistration);
    }

    /** Turns the configured role claim into Spring authorities, so hasRole() sees realm roles. */
    private RoleClaimOidcUserService oidcUserService() {
        return new RoleClaimOidcUserService(properties.authoritiesClaimName());
    }

    /**
     * Builds the registration the login flow uses. Called on first login, not at startup;
     * see {@link LazyClientRegistrationRepository}.
     *
     * Only the "custom" provider is supported, since the provider is always configured by
     * the operator. Anything else is rejected instead of treated as custom.
     */
    ClientRegistration buildRegistration() {
        if (!properties.isCustomProvider()) {
            throw new IllegalStateException(OAuth2Properties.PREFIX + ".provider is '"
                    + properties.provider() + "', but only '" + OAuth2Properties.CUSTOM_PROVIDER
                    + "' is supported. Configure the endpoints, or the issuer to discover them from.");
        }

        return baseBuilder()
                .clientId(properties.clientId())
                .clientSecret(properties.clientSecret())
                .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri("{baseUrl}/login/oauth2/code/{registrationId}")
                .scope(properties.scopes())
                // Decides authentication.getName(). The default is "sub", a UUID.
                .userNameAttributeName(properties.userNameAttributeName())
                .build();
    }

    /**
     * Where the endpoints come from: the configuration if all four are set, otherwise the
     * issuer's discovery document, fetched on this first login.
     */
    private ClientRegistration.Builder baseBuilder() {
        if (properties.hasExplicitEndpoints()) return explicitEndpoints();

        if (properties.issuerUri() == null || properties.issuerUri().isBlank()) {
            throw new IllegalStateException("Set " + OAuth2Properties.PREFIX + ".issuerUri, or all four of "
                    + "authorizationUri, tokenUri, userInfoUri and jwkSetUri.");
        }
        return ClientRegistrations.fromIssuerLocation(properties.issuerUri())
                .registrationId(REGISTRATION_ID);
    }

    private ClientRegistration.Builder explicitEndpoints() {
        ClientRegistration.Builder builder = ClientRegistration.withRegistrationId(REGISTRATION_ID)
                .clientName(REGISTRATION_ID)
                .authorizationUri(properties.authorizationUri())
                .tokenUri(properties.tokenUri())
                .userInfoUri(properties.userInfoUri())
                .jwkSetUri(properties.jwkSetUri())
                .issuerUri(properties.issuerUri());

        // Discovery would normally supply this. Without it logout clears our session but
        // not the provider's, so the next login signs the same user back in.
        String endSessionUri = properties.resolvedEndSessionUri();
        if (endSessionUri != null) {
            builder.providerConfigurationMetadata(Map.of("end_session_endpoint", endSessionUri));
        }

        return builder;
    }

    /**
     * Lets the app reuse the login's access token for its own calls to the provider and
     * refresh it when it expires. oauth2Login never refreshes on its own, and Keycloak's
     * access tokens expire after an hour, so token lookups would fail mid-session.
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
