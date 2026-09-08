package wearefrank.backend.dto;

/**
 * The git connection this deployment pins, so the frontend can show it read-only instead
 * of offering fields that would be ignored anyway.
 *
 * locked - when false every other field is empty and the browser's own settings apply.
 * The token is never sent here; that is the point of keeping it on the server.
 */
public record GitLockDto(
        boolean locked,
        String provider,
        String host,
        String repo,
        String branch,
        String filePath
) {}
