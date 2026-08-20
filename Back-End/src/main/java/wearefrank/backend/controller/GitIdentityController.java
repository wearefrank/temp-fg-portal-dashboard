package wearefrank.backend.controller;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;
import org.springframework.web.util.UriComponentsBuilder;
import wearefrank.backend.dto.GitIdentityDto;
import wearefrank.backend.service.GitIdentityService;

import java.io.Serializable;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Connects a user's GitHub/GitLab account to their Keycloak account, so the console can
 * read a git token from Keycloak instead of the user pasting a personal access token into
 * the browser.
 */
@RestController
@RequestMapping("/api/git")
public class GitIdentityController {

    private static final String PENDING_LINK_ATTRIBUTE = GitIdentityController.class.getName() + ".pendingLink";
    private static final Duration LINK_VALIDITY = Duration.ofMinutes(10);
    private static final String SETTINGS_PAGE = "/history";

    private final SecureRandom random = new SecureRandom();
    private final GitIdentityService gitIdentityService;

    public GitIdentityController(GitIdentityService gitIdentityService) {
        this.gitIdentityService = gitIdentityService;
    }

    /**
     * Keycloak does not echo the nonce back, so the callback is correlated with our own
     * single-use token instead. Deliberately not called "state": Keycloak rejects a
     * redirect_uri whose query string carries an OIDC-reserved parameter name.
     */
    private record PendingLink(String provider, String linkState, Instant startedAt) implements Serializable {
    }

    @GetMapping("/identity")
    public Map<String, GitIdentityDto> identity() {
        // Preferred source: one call, and it carries the account name. Comes back empty if
        // the account API is unreachable, in which case fall back to probing the token.
        Map<String, GitIdentityService.LinkedAccount> accounts = gitIdentityService.linkedAccounts();

        Map<String, GitIdentityDto> statuses = new LinkedHashMap<>();
        for (String alias : gitIdentityService.providers()) {
            if (!gitIdentityService.isAvailable(alias)) {
                statuses.put(alias, new GitIdentityDto(false, false, null));
                continue;
            }

            GitIdentityService.LinkedAccount account = accounts.get(alias);
            if (account != null) {
                statuses.put(alias, new GitIdentityDto(true, account.connected(), account.username()));
            } else {
                statuses.put(alias, new GitIdentityDto(true, gitIdentityService.brokeredToken(alias).isPresent(), null));
            }
        }
        return statuses;
    }

    /**
     * Returns the Keycloak link URL rather than redirecting to it. A 302 would be followed
     * by the caller's fetch() and die on CORS; the frontend navigates to this URL itself,
     * the same way the login redirect works.
     *
     * The URL is built per click on purpose - its hash is bound to the current Keycloak
     * session, so one prepared at page render would already be stale.
     */
    @PostMapping("/{provider}/link")
    public Map<String, String> startLink(@PathVariable String provider, HttpServletRequest request) {
        String nonce = randomToken();
        String linkState = randomToken();

        String redirectUri = ServletUriComponentsBuilder.fromCurrentContextPath()
                .path("/api/git/link/callback")
                .queryParam("provider", provider)
                .queryParam("linkState", linkState)
                .toUriString();

        Optional<String> url = gitIdentityService.linkUrl(provider, redirectUri, nonce);
        if (url.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Account linking is not available for " + provider);
        }

        request.getSession().setAttribute(PENDING_LINK_ATTRIBUTE,
                new PendingLink(provider, linkState, Instant.now()));
        return Map.of("url", url.get());
    }

    /**
     * Where Keycloak drops the browser after the link flow. Bounces back to the history
     * page with the settings panel open so the user sees the new status straight away.
     */
    @GetMapping("/link/callback")
    public ResponseEntity<Void> completeLink(
            @RequestParam String provider,
            @RequestParam(required = false) String linkState,
            @RequestParam(name = "link_error", required = false) String linkErrorParam,
            @RequestParam(name = "error", required = false) String errorParam,
            HttpServletRequest request) {

        // Keycloak reports a failed link as ?link_error=<code>; "error" is only accepted as a
        // fallback. Missing this means a failure looks exactly like a success.
        String failure = linkErrorParam != null && !linkErrorParam.isBlank() ? linkErrorParam : errorParam;

        UriComponentsBuilder target = UriComponentsBuilder.fromPath(SETTINGS_PAGE)
                .queryParam("settings", "1");

        if (!consumePendingLink(request, provider, linkState)) {
            target.queryParam("linkError", "unexpected");
        } else if (failure != null && !failure.isBlank()) {
            target.queryParam("linkError", failure);
        } else {
            target.queryParam("linked", provider);
        }

        return ResponseEntity.status(HttpStatus.FOUND)
                .location(URI.create(target.toUriString()))
                .build();
    }

    /** Clears the pending link whatever the outcome, so a callback URL only ever works once. */
    private boolean consumePendingLink(HttpServletRequest request, String provider, String linkState) {
        HttpSession session = request.getSession(false);
        if (session == null) return false;

        Object stored = session.getAttribute(PENDING_LINK_ATTRIBUTE);
        session.removeAttribute(PENDING_LINK_ATTRIBUTE);

        if (!(stored instanceof PendingLink pending) || linkState == null) return false;
        if (!pending.provider().equals(provider)) return false;
        if (pending.startedAt().plus(LINK_VALIDITY).isBefore(Instant.now())) return false;

        return MessageDigest.isEqual(
                pending.linkState().getBytes(StandardCharsets.UTF_8),
                linkState.getBytes(StandardCharsets.UTF_8));
    }

    private String randomToken() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
