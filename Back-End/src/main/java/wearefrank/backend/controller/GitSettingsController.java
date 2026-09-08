package wearefrank.backend.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import wearefrank.backend.config.GitLockProperties;
import wearefrank.backend.dto.GitLockDto;

/**
 * Tells the frontend whether the git connection is fixed by the deployment. Only a
 * courtesy for the UI - the enforcement itself sits in VersioningController, which
 * ignores the browser's headers while the lock is on.
 */
@RestController
@RequestMapping("/api/git")
public class GitSettingsController {

    private final GitLockProperties gitLock;

    public GitSettingsController(GitLockProperties gitLock) {
        this.gitLock = gitLock;
    }

    @GetMapping("/settings")
    public GitLockDto settings() {
        if (!gitLock.enabled()) {
            return new GitLockDto(false, "", "", "", "", "");
        }
        return new GitLockDto(
                true,
                gitLock.provider(),
                gitLock.host(),
                gitLock.repo(),
                gitLock.branch(),
                gitLock.filePath());
    }
}
