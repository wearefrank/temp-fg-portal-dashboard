package wearefrank.backend.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import wearefrank.backend.config.GitLockProperties;
import wearefrank.backend.dto.ConfigVersionDto;
import wearefrank.backend.service.GitIdentityService;
import wearefrank.backend.service.VersioningService;
import wearefrank.backend.service.versioning.*;

import java.util.List;

@RestController
@RequestMapping("/api/versions")
@CrossOrigin(origins = "http://localhost:5173")
public class VersioningController {

    private final VersioningService versioningService;
    private final GitIdentityService gitIdentityService;
    private final GitLockProperties gitLock;

    public VersioningController(VersioningService versioningService,
                                GitIdentityService gitIdentityService,
                                GitLockProperties gitLock) {
        this.versioningService = versioningService;
        this.gitIdentityService = gitIdentityService;
        this.gitLock = gitLock;
    }

    @GetMapping
    public List<ConfigVersionDto.Summary> listVersions(HttpServletRequest req) {
        return versioningService.listVersions(activeConfig(req));
    }

    @GetMapping("/{id}")
    public ConfigVersionDto getVersion(@PathVariable String id, HttpServletRequest req) {
        return versioningService.getVersion(id, activeConfig(req));
    }

    @PostMapping
    public ConfigVersionDto.Summary saveVersion(@RequestBody ConfigVersionDto.SaveRequest request, HttpServletRequest req) {
        return versioningService.saveVersion(request.message(), request.content(), activeConfig(req));
    }

    // returns plain text so the frontend can load the file content directly into the editor
    @GetMapping(value = "/file", produces = MediaType.TEXT_PLAIN_VALUE)
    public String readCurrentFile(HttpServletRequest req) {
        return versioningService.readCurrentFile(activeConfig(req));
    }

    @GetMapping("/exists")
    public boolean fileExists(HttpServletRequest req) {
        return versioningService.fileExists(activeConfig(req));
    }

    private GitProviderConfig activeConfig(HttpServletRequest req) {
        switch (provider(req).toLowerCase()) {
            case "gitlab":
                return gitlabConfig(req);
            case "gitea":
                return giteaConfig(req);
            default:
                return githubConfig(req);
        }
    }

    private String provider(HttpServletRequest req) {
        if (gitLock.enabled()) return gitLock.provider();
        return header(req, "X-Git-Provider", "github");
    }

    private GitHubConfig githubConfig(HttpServletRequest req) {
        return new GitHubConfig(
                token(req, "X-Github-Token", "github"),
                setting(req, "X-Github-Repo", gitLock.repo()),
                setting(req, "X-Github-Branch", gitLock.branch()),
                setting(req, "X-Github-File-Path", gitLock.filePath()));
    }

    private GitLabConfig gitlabConfig(HttpServletRequest req) {
        return new GitLabConfig(
                token(req, "X-Gitlab-Token", "gitlab"),
                setting(req, "X-Gitlab-Host", gitLock.host()),
                setting(req, "X-Gitlab-Project", gitLock.repo()),
                setting(req, "X-Gitlab-Branch", gitLock.branch()),
                setting(req, "X-Gitlab-File-Path", gitLock.filePath()));
    }

    /**
     * In order: a token pinned by the deployment, then one the browser sent, then the
     * user's Keycloak account link. The pinned one wins because a deployment that supplies
     * a token gives its users no way to enter one of their own.
     *
     * brokerAlias is null for providers Keycloak does not broker.
     */
    private String token(HttpServletRequest req, String headerName, String brokerAlias) {
        if (gitLock.hasToken()) return gitLock.token();
        String fromHeader = header(req, headerName);
        if (!fromHeader.isBlank()) return fromHeader;
        if (brokerAlias == null) return "";
        return gitIdentityService.brokeredToken(brokerAlias).orElse("");
    }

    private GiteaConfig giteaConfig(HttpServletRequest req) {
        return new GiteaConfig(
                token(req, "X-Gitea-Token", null),
                setting(req, "X-Gitea-Host", gitLock.host()),
                setting(req, "X-Gitea-Repo", gitLock.repo()),
                setting(req, "X-Gitea-Branch", gitLock.branch()),
                setting(req, "X-Gitea-File-Path", gitLock.filePath()));
    }

    /**
     * One connection setting: the deployment's fixed value while the git connection is
     * locked, otherwise whatever the browser sent. Locking has to bite here rather than in
     * the UI, since the headers are the user's to forge.
     */
    private String setting(HttpServletRequest req, String headerName, String lockedValue) {
        return gitLock.enabled() ? lockedValue : header(req, headerName);
    }

    private String header(HttpServletRequest req, String name) {
        String value = req.getHeader(name);
        return value != null ? value : "";
    }

    private String header(HttpServletRequest req, String name, String defaultValue) {
        String value = req.getHeader(name);
        return value != null ? value : defaultValue;
    }
}
