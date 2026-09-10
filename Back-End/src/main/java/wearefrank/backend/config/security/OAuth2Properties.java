package wearefrank.backend.config.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/**
 * Settings for the OAUTH2 authenticator. The names match the Frank!Framework console, so
 * one set of properties configures both products.
 *
 * These use their own namespace instead of spring.security.oauth2.client.*, because Spring
 * Boot binds those at startup and would resolve the issuer there.
 */
@ConfigurationProperties(OAuth2Properties.PREFIX)
public record OAuth2Properties(
        String provider,
        String clientId,
        String clientSecret,
        String issuerUri,
        String authorizationUri,
        String tokenUri,
        String userInfoUri,
        String jwkSetUri,
        String endSessionUri,
        String userNameAttributeName,
        List<String> scopes,
        String authoritiesClaimName
) {

    public static final String PREFIX = "application.security.console.authentication";

    /** Uses the endpoints configured here instead of one of Spring's built-in presets. */
    public static final String CUSTOM_PROVIDER = "custom";

    private static final List<String> DEFAULT_SCOPES = List.of("openid", "profile", "email");

    /** Keycloak's logout endpoint sits at a fixed path under the realm. */
    private static final String KEYCLOAK_LOGOUT_PATH = "/protocol/openid-connect/logout";

    public OAuth2Properties {
        provider = orDefault(provider, CUSTOM_PROVIDER);
        userNameAttributeName = orDefault(userNameAttributeName, "preferred_username");
        authoritiesClaimName = orDefault(authoritiesClaimName, "realm_access.roles");
        issuerUri = trimTrailingSlash(issuerUri);
        scopes = scopes == null || scopes.isEmpty() ? DEFAULT_SCOPES : List.copyOf(scopes);
    }

    /**
     * Whether all four endpoints are configured by hand. All or nothing, because a partial
     * set would fall back to discovery, which is usually the thing being avoided.
     */
    public boolean hasExplicitEndpoints() {
        return isSet(authorizationUri) && isSet(tokenUri) && isSet(userInfoUri) && isSet(jwkSetUri);
    }

    /**
     * Where to send the browser to end the provider session. Normally discovery supplies
     * this; with manual endpoints it is derived from the issuer, or set explicitly for a
     * provider other than Keycloak.
     */
    public String resolvedEndSessionUri() {
        if (isSet(endSessionUri)) return endSessionUri;
        return isSet(issuerUri) ? issuerUri + KEYCLOAK_LOGOUT_PATH : null;
    }

    public boolean isCustomProvider() {
        return CUSTOM_PROVIDER.equalsIgnoreCase(provider);
    }

    private static boolean isSet(String value) {
        return value != null && !value.isBlank();
    }

    private static String orDefault(String value, String fallback) {
        return isSet(value) ? value : fallback;
    }

    private static String trimTrailingSlash(String uri) {
        if (uri == null) return null;
        return uri.endsWith("/") ? uri.substring(0, uri.length() - 1) : uri;
    }
}
