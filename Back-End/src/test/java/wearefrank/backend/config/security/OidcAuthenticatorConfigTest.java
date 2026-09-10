package wearefrank.backend.config.security;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Building the registration from the endpoints in configuration, which is the path the
 * Keycloak documentation configures. Asserted without a network call on purpose: not
 * needing one is the reason to spell the endpoints out in the first place.
 */
class OidcAuthenticatorConfigTest {

    private static final String ISSUER = "http://localhost:8888/realms/test";

    @Test
    void buildsTheRegistrationFromTheConfiguredEndpoints() {
        ClientRegistration registration = configFor(properties(ISSUER, true, null)).buildRegistration();

        assertThat(registration.getRegistrationId()).isEqualTo(OidcAuthenticatorConfig.REGISTRATION_ID);
        assertThat(registration.getClientId()).isEqualTo("my-oidc-client");
        assertThat(registration.getClientSecret()).isEqualTo("my-oidc-secret");
        assertThat(registration.getClientAuthenticationMethod())
                .isEqualTo(ClientAuthenticationMethod.CLIENT_SECRET_BASIC);
        assertThat(registration.getAuthorizationGrantType()).isEqualTo(AuthorizationGrantType.AUTHORIZATION_CODE);
        assertThat(registration.getRedirectUri()).isEqualTo("{baseUrl}/login/oauth2/code/{registrationId}");
        assertThat(registration.getScopes()).containsExactlyInAnyOrder("openid", "profile", "email");

        ClientRegistration.ProviderDetails provider = registration.getProviderDetails();
        assertThat(provider.getAuthorizationUri()).isEqualTo(ISSUER + "/protocol/openid-connect/auth");
        assertThat(provider.getTokenUri()).isEqualTo(ISSUER + "/protocol/openid-connect/token");
        assertThat(provider.getJwkSetUri()).isEqualTo(ISSUER + "/protocol/openid-connect/certs");
        assertThat(provider.getIssuerUri()).isEqualTo(ISSUER);
        assertThat(provider.getUserInfoEndpoint().getUri())
                .isEqualTo(ISSUER + "/protocol/openid-connect/userinfo");
        assertThat(provider.getUserInfoEndpoint().getUserNameAttributeName()).isEqualTo("preferred_username");
    }

    /**
     * Discovery would have carried the logout endpoint. Without it in the metadata,
     * OidcClientInitiatedLogoutSuccessHandler signs the user out of the console only, and
     * the provider's session survives to sign them straight back in.
     */
    @Test
    void derivesTheLogoutEndpointWhenTheEndpointsAreConfiguredByHand() {
        ClientRegistration registration = configFor(properties(ISSUER, true, null)).buildRegistration();

        assertThat(registration.getProviderDetails().getConfigurationMetadata())
                .containsEntry("end_session_endpoint", ISSUER + "/protocol/openid-connect/logout");
    }

    @Test
    void prefersAConfiguredLogoutEndpoint() {
        ClientRegistration registration =
                configFor(properties(ISSUER, true, "https://idp.example/logout")).buildRegistration();

        assertThat(registration.getProviderDetails().getConfigurationMetadata())
                .containsEntry("end_session_endpoint", "https://idp.example/logout");
    }

    /** The presets exist in Spring, but this console is only ever pointed at a configured provider. */
    @Test
    void refusesAProviderOtherThanCustom() {
        OAuth2Properties google = new OAuth2Properties("google", "id", "secret", ISSUER,
                null, null, null, null, null, null, null, null);

        assertThatThrownBy(() -> configFor(google).buildRegistration())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("google")
                .hasMessageContaining("custom");
    }

    /** Nothing to discover from and nothing spelled out is a misconfiguration, not a login failure to debug. */
    @Test
    void refusesWithNeitherAnIssuerNorEndpoints() {
        OAuth2Properties empty = new OAuth2Properties(null, "id", "secret", null,
                null, null, null, null, null, null, null, null);

        assertThatThrownBy(() -> configFor(empty).buildRegistration())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("issuerUri");
    }

    private OidcAuthenticatorConfig configFor(OAuth2Properties properties) {
        return new OidcAuthenticatorConfig(properties);
    }

    private OAuth2Properties properties(String issuer, boolean explicitEndpoints, String endSessionUri) {
        return new OAuth2Properties(
                "custom",
                "my-oidc-client",
                "my-oidc-secret",
                issuer,
                explicitEndpoints ? issuer + "/protocol/openid-connect/auth" : null,
                explicitEndpoints ? issuer + "/protocol/openid-connect/token" : null,
                explicitEndpoints ? issuer + "/protocol/openid-connect/userinfo" : null,
                explicitEndpoints ? issuer + "/protocol/openid-connect/certs" : null,
                endSessionUri,
                "preferred_username",
                List.of("openid", "profile", "email"),
                "realm_access.roles");
    }
}
