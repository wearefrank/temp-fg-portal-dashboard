package wearefrank.backend.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import wearefrank.backend.config.GitLockProperties;
import wearefrank.backend.dto.ConfigVersionDto;
import wearefrank.backend.service.GitIdentityService;
import wearefrank.backend.service.VersioningService;
import wearefrank.backend.service.versioning.GitHubConfig;

import java.util.List;
import java.util.Optional;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The pinned connection has to hold against headers the browser controls, so every test
 * here sends contradicting ones and expects them thrown away.
 */
@WebMvcTest(VersioningController.class)
@EnableConfigurationProperties(GitLockProperties.class)
@TestPropertySource(properties = {
        "git.locked.enabled=true",
        "git.locked.provider=github",
        "git.locked.repo=ops/gateway-config",
        "git.locked.branch=main",
        "git.locked.file-path=config/apisix.yaml"
})
class VersioningControllerLockTest {

    private static final GitHubConfig PINNED =
            new GitHubConfig("tok", "ops/gateway-config", "main", "config/apisix.yaml");

    @Autowired
    MockMvc mockMvc;

    @MockitoBean
    VersioningService versioningService;

    @MockitoBean
    GitIdentityService gitIdentityService;

    @Test
    void listVersions_ignoresRepoBranchAndPathHeaders() throws Exception {
        when(gitIdentityService.brokeredToken("github")).thenReturn(Optional.empty());
        when(versioningService.listVersions(PINNED))
                .thenReturn(List.of(new ConfigVersionDto.Summary("v1", "msg", "2026-01-01", "http://url", "alice")));

        mockMvc.perform(get("/api/versions")
                        .header("X-Github-Token", "tok")
                        .header("X-Github-Repo", "attacker/other-repo")
                        .header("X-Github-Branch", "some-branch")
                        .header("X-Github-File-Path", "secrets.yaml"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("v1"));
    }

    @Test
    void listVersions_ignoresTheProviderHeader() throws Exception {
        when(gitIdentityService.brokeredToken("github")).thenReturn(Optional.empty());
        when(versioningService.listVersions(PINNED)).thenReturn(List.of());

        mockMvc.perform(get("/api/versions")
                        .header("X-Git-Provider", "gitea")
                        .header("X-Github-Token", "tok")
                        .header("X-Gitea-Repo", "attacker/other-repo"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isEmpty());
    }

    /**
     * No token is pinned in this class, so the browser's own still applies - that is the
     * deployment where users bring their own credential.
     */
    @Test
    void listVersions_stillTakesTheUsersOwnToken() throws Exception {
        when(gitIdentityService.brokeredToken("github")).thenReturn(Optional.empty());
        when(versioningService.listVersions(PINNED)).thenReturn(List.of());

        mockMvc.perform(get("/api/versions").header("X-Github-Token", "tok"))
                .andExpect(status().isOk());
    }

    @Test
    void readCurrentFile_readsThePinnedFile() throws Exception {
        when(gitIdentityService.brokeredToken("github")).thenReturn(Optional.empty());
        when(versioningService.readCurrentFile(PINNED)).thenReturn("routes: []");

        mockMvc.perform(get("/api/versions/file")
                        .header("X-Github-Token", "tok")
                        .header("X-Github-File-Path", "secrets.yaml"))
                .andExpect(status().isOk());
    }
}
