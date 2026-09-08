package wearefrank.backend.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import wearefrank.backend.config.GitLockProperties;
import wearefrank.backend.service.GitIdentityService;
import wearefrank.backend.service.VersioningService;
import wearefrank.backend.service.versioning.GitHubConfig;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * A deployment that supplies the token as well, so users enter nothing at all. The
 * service-account token has to win over anything the browser sends, otherwise a user could
 * still act as themselves against the pinned repository.
 */
@WebMvcTest({VersioningController.class, GitSettingsController.class})
@EnableConfigurationProperties(GitLockProperties.class)
@TestPropertySource(properties = {
        "git.locked.enabled=true",
        "git.locked.provider=github",
        "git.locked.repo=ops/gateway-config",
        "git.locked.branch=main",
        "git.locked.file-path=config/apisix.yaml",
        "git.locked.token=service-account-token"
})
class VersioningControllerServiceTokenTest {

    private static final GitHubConfig PINNED = new GitHubConfig(
            "service-account-token", "ops/gateway-config", "main", "config/apisix.yaml");

    @Autowired
    MockMvc mockMvc;

    @MockitoBean
    VersioningService versioningService;

    @MockitoBean
    GitIdentityService gitIdentityService;

    @Test
    void listVersions_usesTheServiceToken_whenNoneIsSent() throws Exception {
        when(versioningService.listVersions(PINNED)).thenReturn(List.of());

        mockMvc.perform(get("/api/versions"))
                .andExpect(status().isOk());
    }

    @Test
    void listVersions_ignoresATokenSentByTheBrowser() throws Exception {
        when(versioningService.listVersions(PINNED)).thenReturn(List.of());

        mockMvc.perform(get("/api/versions").header("X-Github-Token", "someones-own-token"))
                .andExpect(status().isOk());
    }

    @Test
    void settings_describeThePinnedConnection() throws Exception {
        mockMvc.perform(get("/api/git/settings"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.locked").value(true))
                .andExpect(jsonPath("$.repo").value("ops/gateway-config"));
    }

    @Test
    void settings_neverCarryTheTokenItself() throws Exception {
        String body = mockMvc.perform(get("/api/git/settings"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(body).doesNotContain("service-account-token");
    }
}
