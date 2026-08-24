package wearefrank.backend.config.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/**
 * Settings for the OIDC authenticator. Its own namespace rather than Spring Boot's
 * spring.security.oauth2.client.*, because Boot binds those unconditionally and resolves
 * the issuer while the context builds - which is exactly the startup dependency this
 * design removes.
 */
@ConfigurationProperties("console.security.auth.oidc")
public record OidcProperties(
        String issuerUri,
        String clientId,
        String clientSecret,
        List<String> scope
) {}
