package wearefrank.backend.config.security;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.core.AuthorizationGrantType;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class LazyClientRegistrationRepositoryTest {

    private static final String ID = "keycloak";

    @Test
    void resolvesNothingUntilAskedAndThenCaches() {
        AtomicInteger loads = new AtomicInteger();
        LazyClientRegistrationRepository repository = new LazyClientRegistrationRepository(ID, () -> {
            loads.incrementAndGet();
            return registration();
        });

        // The whole point: constructing the repository must not reach the provider.
        assertThat(loads).hasValue(0);

        assertThat(repository.findByRegistrationId(ID)).isNotNull();
        assertThat(repository.findByRegistrationId(ID)).isNotNull();
        assertThat(loads).hasValue(1);
    }

    @Test
    void retriesAfterAFailedLookup() {
        AtomicInteger attempts = new AtomicInteger();
        Supplier<ClientRegistration> flaky = () -> {
            if (attempts.incrementAndGet() == 1) throw new IllegalStateException("provider down");
            return registration();
        };
        LazyClientRegistrationRepository repository = new LazyClientRegistrationRepository(ID, flaky);

        assertThatThrownBy(() -> repository.findByRegistrationId(ID)).isInstanceOf(IllegalStateException.class);

        // A provider that was down at the first login must not poison every later one.
        assertThat(repository.findByRegistrationId(ID)).isNotNull();
        assertThat(attempts).hasValue(2);
    }

    @Test
    void ignoresOtherRegistrationIds() {
        LazyClientRegistrationRepository repository =
                new LazyClientRegistrationRepository(ID, LazyClientRegistrationRepositoryTest::registration);

        assertThat(repository.findByRegistrationId("something-else")).isNull();
    }

    private static ClientRegistration registration() {
        return ClientRegistration.withRegistrationId(ID)
                .clientId("test-client")
                .clientSecret("test-secret")
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri("{baseUrl}/login/oauth2/code/{registrationId}")
                .authorizationUri("http://localhost/auth")
                .tokenUri("http://localhost/token")
                .userInfoUri("http://localhost/userinfo")
                .userNameAttributeName("sub")
                .jwkSetUri("http://localhost/jwks")
                .scope("openid")
                .build();
    }
}
