package wearefrank.backend.config.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;

import java.util.function.Supplier;

/**
 * Resolves the OIDC registration on first use instead of at startup.
 *
 * Spring's usual issuer-uri handling fetches the discovery document while the context is
 * building, so a provider that is down takes the whole application with it - in Kubernetes
 * that is a crashloop. Here it costs only the login that triggered the lookup, and the
 * next attempt retries, so the console recovers on its own once the provider is back.
 *
 * Deliberately not Iterable: enumerating registrations is what Spring's generated login
 * page does, and that would put discovery back on the startup path. The console serves its
 * own login page, so nothing needs the listing.
 */
public class LazyClientRegistrationRepository implements ClientRegistrationRepository {

    private static final Logger log = LoggerFactory.getLogger(LazyClientRegistrationRepository.class);

    private final String registrationId;
    private final Supplier<ClientRegistration> loader;

    private volatile ClientRegistration cached;

    public LazyClientRegistrationRepository(String registrationId, Supplier<ClientRegistration> loader) {
        this.registrationId = registrationId;
        this.loader = loader;
    }

    @Override
    public ClientRegistration findByRegistrationId(String id) {
        if (!registrationId.equals(id)) return null;

        ClientRegistration resolved = cached;
        if (resolved != null) return resolved;

        synchronized (this) {
            // A failure propagates and leaves cached null on purpose, so the next call retries.
            if (cached == null) {
                cached = loader.get();
                log.info("Resolved OIDC client registration '{}'", registrationId);
            }
            return cached;
        }
    }
}
