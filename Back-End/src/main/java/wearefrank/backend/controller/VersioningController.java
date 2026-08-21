package wearefrank.backend.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
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

    public VersioningController(VersioningService versioningService, GitIdentityService gitIdentityService) {
        this.versioningService = versioningService;
        this.gitIdentityService = gitIdentityService;
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
        return header(req, "X-Git-Provider", "github");
    }

    private GitHubConfig githubConfig(HttpServletRequest req) {
        return new GitHubConfig(
                token(req, "X-Github-Token", "github"),
                header(req, "X-Github-Repo"),
                header(req, "X-Github-Branch"),
                header(req, "X-Github-File-Path"));
    }

    private GitLabConfig gitlabConfig(HttpServletRequest req) {
        return new GitLabConfig(
                token(req, "X-Gitlab-Token", "gitlab"),
                header(req, "X-Gitlab-Host"),
                header(req, "X-Gitlab-Project"),
                header(req, "X-Gitlab-Branch"),
                header(req, "X-Gitlab-File-Path"));
    }

    /**
     * A token sent by the browser still wins, so deployments without a brokered identity
     * provider keep working on personal access tokens. Otherwise the token comes from the
     * user's Keycloak account link and never touches the browser at all.
     */
    private String token(HttpServletRequest req, String headerName, String brokerAlias) {
        String fromHeader = header(req, headerName);
        if (!fromHeader.isBlank()) return fromHeader;
        return gitIdentityService.brokeredToken(brokerAlias).orElse("");
    }

    private GiteaConfig giteaConfig(HttpServletRequest req) {
        return new GiteaConfig(
                header(req, "X-Gitea-Token"),
                header(req, "X-Gitea-Host"),
                header(req, "X-Gitea-Repo"),
                header(req, "X-Gitea-Branch"),
                header(req, "X-Gitea-File-Path"));
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
