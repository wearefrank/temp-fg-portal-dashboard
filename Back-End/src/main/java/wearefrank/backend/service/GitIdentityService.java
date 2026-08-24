package wearefrank.backend.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.client.OAuth2AuthorizeRequest;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.io.IOException;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Reads git provider tokens out of Keycloak instead of asking the user for a personal
 * access token. Keycloak brokers GitHub/GitLab as identity providers and, with "store
 * tokens" enabled, keeps the token it got from them on the user's federated identity.
 *
 * Nothing here ever throws on a Keycloak problem: {@code GlobalExceptionHandler} turns a
 * RuntimeException into a 502, which would take the whole history page down for users who
 * are perfectly happy on the personal-access-token fallback.
 */
@Service
public class GitIdentityService {

    private static final Logger log = LoggerFactory.getLogger(GitIdentityService.class);

    private static final String REGISTRATION_ID = "keycloak";
    private static final String OIDC_AUTH_TYPE = "OIDC";
    private static final Duration TIMEOUT = Duration.ofSeconds(10);

    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final OAuth2AuthorizedClientManager authorizedClientManager;
    private final String issuerUri;
    private final String clientId;
    private final Set<String> brokeredProviders;

    public GitIdentityService(
            @Qualifier("keycloakHttpClient") HttpClient httpClient,
            ObjectMapper objectMapper,
            OAuth2AuthorizedClientManager authorizedClientManager,
            @Value("${console.security.auth.type:}") String authType,
            @Value("${console.security.auth.oidc.issuer-uri:}") String issuerUri,
            @Value("${console.security.auth.oidc.client-id:}") String clientId,
            @Value("${git.broker.providers:github,gitlab}") String brokeredProviders) {
        this.httpClient = httpClient;
        this.objectMapper = objectMapper;
        this.authorizedClientManager = authorizedClientManager;
        // Brokering needs an identity provider to broker through. The OIDC settings are
        // readable whatever the active authenticator, so blank them out when it is not the
        // one in use - isAvailable() then reports the feature off, as it does for a realm
        // that brokers nothing.
        boolean brokering = OIDC_AUTH_TYPE.equals(authType);
        this.issuerUri = brokering ? trimTrailingSlash(issuerUri) : "";
        this.clientId = brokering ? clientId : "";
        this.brokeredProviders = parseProviders(brokeredProviders);
    }

    /** Aliases this deployment brokers, in the order the UI should show them. */
    public List<String> providers() {
        return List.copyOf(brokeredProviders);
    }

    /**
     * Whether linking is even possible here. The realm's identity providers cannot be
     * discovered over a public endpoint, so which aliases exist is a deployment setting
     * (git.broker.providers) rather than something we probe for.
     */
    public boolean isAvailable(String alias) {
        return !issuerUri.isBlank() && brokeredProviders.contains(alias);
    }

    /** What Keycloak's account console knows about one linked provider. */
    public record LinkedAccount(boolean connected, String username) {
    }

    /**
     * Link status straight from Keycloak's account API, keyed by provider alias. One call
     * covers every provider and carries the account name, where probing the broker token
     * costs a call each and logs a server-side error for every provider not linked yet.
     *
     * Empty when the account API cannot be reached, which the caller treats as "fall back
     * to probing" rather than "nothing is linked".
     */
    public Map<String, LinkedAccount> linkedAccounts() {
        if (issuerUri.isBlank()) return Map.of();

        Optional<String> accessToken = keycloakAccessToken();
        if (accessToken.isEmpty()) return Map.of();

        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(issuerUri + "/account/linked-accounts"))
                    .header("Authorization", "Bearer " + accessToken.get())
                    .header("Accept", "application/json")
                    .timeout(TIMEOUT)
                    .GET()
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                log.debug("Keycloak account API returned {} for linked accounts", response.statusCode());
                return Map.of();
            }

            Map<String, LinkedAccount> accounts = new LinkedHashMap<>();
            for (JsonNode node : objectMapper.readTree(response.body())) {
                String alias = node.path("providerAlias").asText("");
                if (alias.isBlank()) continue;
                String username = node.path("linkedUsername").asText(null);
                accounts.put(alias, new LinkedAccount(node.path("connected").asBoolean(false), username));
            }
            return accounts;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return Map.of();
        } catch (IOException | RuntimeException e) {
            log.warn("Could not read linked accounts from Keycloak: {}", e.toString());
            return Map.of();
        }
    }

    /**
     * The provider token Keycloak stored for the current user, or empty when they have not
     * linked their account (or Keycloak is unreachable).
     */
    public Optional<String> brokeredToken(String alias) {
        if (!isAvailable(alias)) return Optional.empty();
        return keycloakAccessToken().flatMap(token -> fetchStoredToken(alias, token));
    }

    /**
     * Keycloak's client-initiated account-link URL. The hash is what proves to Keycloak
     * that this app started the flow; it is unforgeable without the user's session state.
     */
    public Optional<String> linkUrl(String alias, String redirectUri, String nonce) {
        if (!isAvailable(alias)) return Optional.empty();

        Optional<String> sessionState = sessionState();
        if (sessionState.isEmpty()) {
            log.warn("Cannot build a {} link URL: the ID token carries neither session_state nor sid", alias);
            return Optional.empty();
        }

        String hash = linkHash(nonce, sessionState.get(), clientId, alias);
        String url = issuerUri + "/broker/" + alias + "/link"
                + "?client_id=" + encode(clientId)
                + "&redirect_uri=" + encode(redirectUri)
                + "&nonce=" + encode(nonce)
                + "&hash=" + encode(hash);
        return Optional.of(url);
    }

    /** Base64Url(SHA-256(nonce + session_state + client_id + provider)), unpadded as Keycloak expects. */
    static String linkHash(String nonce, String sessionState, String clientId, String alias) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest((nonce + sessionState + clientId + alias).getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required by the JVM spec", e);
        }
    }

    /**
     * Retrieval API V1. V2 (POST with client credentials) is the documented successor, but
     * it is gated on client attributes whose realm-import names are not documented, so this
     * sticks to V1 and its addReadTokenRoleOnCreate switch.
     */
    private Optional<String> fetchStoredToken(String alias, String keycloakAccessToken) {
        String url = issuerUri + "/broker/" + alias + "/token";
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .header("Authorization", "Bearer " + keycloakAccessToken)
                    .header("Accept", "application/json")
                    .timeout(TIMEOUT)
                    .GET()
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                // 400/404 is the normal "this user has not linked that provider" answer.
                log.debug("No stored {} token for the current user, Keycloak returned {}", alias, response.statusCode());
                return Optional.empty();
            }

            // Deliberately no body logging anywhere in this method: it holds the token.
            String token = extractAccessToken(response.body());
            if (token.isBlank()) {
                log.warn("Keycloak returned a {} token response with no access_token in it", alias);
                return Optional.empty();
            }
            return Optional.of(token);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return Optional.empty();
        } catch (IOException | RuntimeException e) {
            log.warn("Could not read the {} broker token from Keycloak: {}", alias, e.toString());
            return Optional.empty();
        }
    }

    /**
     * Keycloak hands back whatever the provider sent it, so the shape depends on the
     * provider. GitHub answers form-urlencoded unless its "JSON Format" (githubJsonFormat)
     * option is on, and that option is off by default, so both shapes have to be read here
     * rather than relying on every realm being configured for JSON.
     */
    String extractAccessToken(String body) {
        if (body == null || body.isBlank()) return "";

        String trimmed = body.trim();
        if (trimmed.startsWith("{")) {
            try {
                return objectMapper.readTree(trimmed).path("access_token").asText("");
            } catch (JsonProcessingException e) {
                return "";
            }
        }

        for (String pair : trimmed.split("&")) {
            int split = pair.indexOf('=');
            if (split <= 0) continue;
            if (!"access_token".equals(pair.substring(0, split))) continue;
            return URLDecoder.decode(pair.substring(split + 1), StandardCharsets.UTF_8);
        }
        return "";
    }

    /**
     * The current user's Keycloak access token. Goes through the authorized-client manager
     * rather than reading the stored client directly so an expired token is refreshed:
     * the realm's default lifespan is an hour, well under a working session.
     */
    private Optional<String> keycloakAccessToken() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        ServletRequestAttributes attributes = currentRequest();
        if (authentication == null || attributes == null) return Optional.empty();

        try {
            OAuth2AuthorizeRequest request = OAuth2AuthorizeRequest
                    .withClientRegistrationId(REGISTRATION_ID)
                    .principal(authentication)
                    .attribute(HttpServletRequest.class.getName(), attributes.getRequest())
                    .attribute(HttpServletResponse.class.getName(), attributes.getResponse())
                    .build();

            OAuth2AuthorizedClient client = authorizedClientManager.authorize(request);
            return Optional.ofNullable(client)
                    .map(c -> c.getAccessToken().getTokenValue());
        } catch (RuntimeException e) {
            log.warn("No usable Keycloak access token for the current session: {}", e.toString());
            return Optional.empty();
        }
    }

    /** Keycloak emits session_state; newer versions prefer sid, and some realms send both. */
    private Optional<String> sessionState() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof OidcUser user)) {
            return Optional.empty();
        }
        String state = user.getClaimAsString("session_state");
        if (state == null || state.isBlank()) state = user.getClaimAsString("sid");
        return Optional.ofNullable(state).filter(s -> !s.isBlank());
    }

    private static ServletRequestAttributes currentRequest() {
        return RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes
                ? attributes
                : null;
    }

    private static Set<String> parseProviders(String configured) {
        return Arrays.stream(configured.split(","))
                .map(String::trim)
                .filter(alias -> !alias.isEmpty())
                .collect(Collectors.toCollection(LinkedHashSet::new));
    }

    private static String trimTrailingSlash(String uri) {
        return uri.endsWith("/") ? uri.substring(0, uri.length() - 1) : uri;
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
