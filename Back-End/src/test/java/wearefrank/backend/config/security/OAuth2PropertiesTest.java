package wearefrank.backend.config.security;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.env.SystemEnvironmentPropertySource;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The property names are a contract with the Frank!Framework console, so that one set of
 * settings configures both against the same realm. They are asserted here spelled exactly
 * as that documentation writes them - camelCase and all - because a name that stops binding
 * fails silently: the field is left null and the console starts with the setting ignored.
 */
class OAuth2PropertiesTest {

    private final ApplicationContextRunner runner =
            new ApplicationContextRunner().withUserConfiguration(EnableProperties.class);

    @Configuration
    @EnableConfigurationProperties(OAuth2Properties.class)
    static class EnableProperties {}

    @Test
    void bindsEverySettingTheFrankFrameworkDocumentationLists() {
        runner.withPropertyValues(
                "application.security.console.authentication.type=OAUTH2",
                "application.security.console.authentication.provider=custom",
                "application.security.console.authentication.clientId=my-oidc-client",
                "application.security.console.authentication.clientSecret=my-oidc-secret",
                "application.security.console.authentication.issuerUri=http://localhost:8888/realms/test",
                "application.security.console.authentication.authorizationUri=http://localhost:8888/realms/test/protocol/openid-connect/auth",
                "application.security.console.authentication.tokenUri=http://localhost:8888/realms/test/protocol/openid-connect/token",
                "application.security.console.authentication.userInfoUri=http://localhost:8888/realms/test/protocol/openid-connect/userinfo",
                "application.security.console.authentication.jwkSetUri=http://localhost:8888/realms/test/protocol/openid-connect/certs",
                "application.security.console.authentication.userNameAttributeName=preferred_username",
                "application.security.console.authentication.scopes=openid, profile, email",
                "application.security.console.authentication.authoritiesClaimName=realm_access.roles"
        ).run(context -> {
            OAuth2Properties properties = context.getBean(OAuth2Properties.class);

            assertThat(properties.provider()).isEqualTo("custom");
            assertThat(properties.isCustomProvider()).isTrue();
            assertThat(properties.clientId()).isEqualTo("my-oidc-client");
            assertThat(properties.clientSecret()).isEqualTo("my-oidc-secret");
            assertThat(properties.issuerUri()).isEqualTo("http://localhost:8888/realms/test");
            assertThat(properties.authorizationUri()).endsWith("/protocol/openid-connect/auth");
            assertThat(properties.tokenUri()).endsWith("/protocol/openid-connect/token");
            assertThat(properties.userInfoUri()).endsWith("/protocol/openid-connect/userinfo");
            assertThat(properties.jwkSetUri()).endsWith("/protocol/openid-connect/certs");
            assertThat(properties.userNameAttributeName()).isEqualTo("preferred_username");
            assertThat(properties.authoritiesClaimName()).isEqualTo("realm_access.roles");

            // Written with spaces after the commas in that documentation.
            assertThat(properties.scopes()).containsExactly("openid", "profile", "email");

            assertThat(properties.hasExplicitEndpoints()).isTrue();
        });
    }

    /**
     * The same names work as environment variables, which is how a container sets them:
     * upper-cased, dots to underscores, camelCase run together. Worth pinning because it is
     * the deployment route, and a name that stops binding leaves the field null in silence.
     */
    @Test
    void bindsTheSameSettingsFromEnvironmentVariables() {
        Map<String, Object> environment = Map.of(
                "APPLICATION_SECURITY_CONSOLE_AUTHENTICATION_CLIENTID", "client-from-env",
                "APPLICATION_SECURITY_CONSOLE_AUTHENTICATION_ISSUERURI", "http://kc:8888/realms/test",
                "APPLICATION_SECURITY_CONSOLE_AUTHENTICATION_USERNAMEATTRIBUTENAME", "email",
                "APPLICATION_SECURITY_CONSOLE_AUTHENTICATION_AUTHORITIESCLAIMNAME", "groups");

        new ApplicationContextRunner()
                .withInitializer(context -> context.getEnvironment().getPropertySources().addFirst(
                        new SystemEnvironmentPropertySource(
                                StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME, environment)))
                .withUserConfiguration(EnableProperties.class)
                .run(context -> {
                    OAuth2Properties properties = context.getBean(OAuth2Properties.class);

                    assertThat(properties.clientId()).isEqualTo("client-from-env");
                    assertThat(properties.issuerUri()).isEqualTo("http://kc:8888/realms/test");
                    assertThat(properties.userNameAttributeName()).isEqualTo("email");
                    assertThat(properties.authoritiesClaimName()).isEqualTo("groups");
                });
    }

    /**
     * Configuring the endpoints by hand costs the end_session_endpoint that discovery would
     * have supplied, and without one logout leaves the provider's session alive.
     */
    @Test
    void derivesTheLogoutEndpointFromTheIssuerWhenItIsNotConfigured() {
        runner.withPropertyValues(
                "application.security.console.authentication.issuerUri=http://localhost:8888/realms/test"
        ).run(context -> assertThat(context.getBean(OAuth2Properties.class).resolvedEndSessionUri())
                .isEqualTo("http://localhost:8888/realms/test/protocol/openid-connect/logout"));
    }

    @Test
    void prefersAConfiguredLogoutEndpointOverTheDerivedOne() {
        runner.withPropertyValues(
                "application.security.console.authentication.issuerUri=http://localhost:8888/realms/test",
                "application.security.console.authentication.endSessionUri=https://idp.example/logout"
        ).run(context -> assertThat(context.getBean(OAuth2Properties.class).resolvedEndSessionUri())
                .isEqualTo("https://idp.example/logout"));
    }

    /**
     * All four or none. A half-filled set falling back to discovery for the rest would be
     * the opposite of why anyone spells them out.
     */
    @Test
    void doesNotTreatAPartialEndpointSetAsExplicit() {
        runner.withPropertyValues(
                "application.security.console.authentication.tokenUri=http://localhost:8888/token"
        ).run(context -> assertThat(context.getBean(OAuth2Properties.class).hasExplicitEndpoints()).isFalse());
    }

    @Test
    void fallsBackToKeycloakDefaultsWhenTheOptionalSettingsAreLeftOut() {
        runner.run(context -> {
            OAuth2Properties properties = context.getBean(OAuth2Properties.class);

            assertThat(properties.provider()).isEqualTo("custom");
            assertThat(properties.userNameAttributeName()).isEqualTo("preferred_username");
            assertThat(properties.authoritiesClaimName()).isEqualTo("realm_access.roles");
            assertThat(properties.scopes()).containsExactly("openid", "profile", "email");
            assertThat(properties.hasExplicitEndpoints()).isFalse();
        });
    }

    /** A trailing slash on the issuer would otherwise produce "//protocol/..." URLs. */
    @Test
    void trimsATrailingSlashFromTheIssuer() {
        runner.withPropertyValues(
                "application.security.console.authentication.issuerUri=http://localhost:8888/realms/test/"
        ).run(context -> assertThat(context.getBean(OAuth2Properties.class).issuerUri())
                .isEqualTo("http://localhost:8888/realms/test"));
    }
}
