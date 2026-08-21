package wearefrank.backend;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

// Static endpoints instead of issuer-uri, so the context loads without a live Keycloak.
// Kept here rather than in test application.properties: a registration on the shared
// classpath pulls OAuth2 auto-configuration into the @WebMvcTest slices, which breaks them.
@SpringBootTest(properties = {
        "spring.security.oauth2.client.provider.keycloak.authorization-uri=http://localhost/auth",
        "spring.security.oauth2.client.provider.keycloak.token-uri=http://localhost/token",
        "spring.security.oauth2.client.provider.keycloak.jwk-set-uri=http://localhost/jwks",
        "spring.security.oauth2.client.provider.keycloak.user-info-uri=http://localhost/userinfo",
        "spring.security.oauth2.client.provider.keycloak.user-name-attribute=sub",
        "spring.security.oauth2.client.registration.keycloak.client-id=test-client",
        "spring.security.oauth2.client.registration.keycloak.client-secret=test-secret",
        "spring.security.oauth2.client.registration.keycloak.authorization-grant-type=authorization_code",
        "spring.security.oauth2.client.registration.keycloak.redirect-uri={baseUrl}/login/oauth2/code/{registrationId}",
        "spring.security.oauth2.client.registration.keycloak.scope=openid"
})
class BackEndApplicationTests {

    @Test
    void contextLoads() {
    }

}
