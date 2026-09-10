package wearefrank.backend.config.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;

import java.util.function.Supplier;

/**
 * Resolves the OIDC registration on first login instead of at startup, so a provider that
 * is down only fails that login instead of the whole application. The next login retries.
 *
 * Not Iterable on purpose: listing registrations would trigger discovery at startup again,
 * and only Spring's generated login page needs that listing.
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
            // On failure cached stays null on purpose, so the next call retries.
            if (cached == null) {
                cached = loader.get();
                log.info("Resolved OIDC client registration '{}'", registrationId);
            }
            return cached;
        }
    }
}
