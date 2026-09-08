package wearefrank.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * A git connection fixed by whoever runs the console. While enabled the backend ignores
 * the repo, branch and file path the browser sends and uses these instead, so locking the
 * settings panel is not something a user can undo from devtools.
 *
 * The token is optional and separate from the rest. Left empty, each user brings their
 * own through Keycloak or a personal access token, and commits carry their name. Set, it
 * is a service account every user shares - nobody has to paste anything, and every commit
 * from this console looks like it came from one author.
 */
@ConfigurationProperties("git.locked")
public record GitLockProperties(
        boolean enabled,
        String provider,
        String host,
        String repo,
        String branch,
        String filePath,
        String token
) {
    public GitLockProperties {
        provider = blankToDefault(provider, "github").toLowerCase();
        host = orEmpty(host);
        repo = orEmpty(repo);
        branch = orEmpty(branch);
        filePath = orEmpty(filePath);
        token = orEmpty(token);
    }

    /** Whether this deployment supplies the token, leaving users nothing to enter. */
    public boolean hasToken() {
        return enabled && !token.isEmpty();
    }

    private static String orEmpty(String value) {
        return value == null ? "" : value.trim();
    }

    private static String blankToDefault(String value, String fallback) {
        String trimmed = orEmpty(value);
        return trimmed.isEmpty() ? fallback : trimmed;
    }
}
