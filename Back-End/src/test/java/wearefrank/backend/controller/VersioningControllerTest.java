package wearefrank.backend.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import wearefrank.backend.dto.ConfigVersionDto;
import wearefrank.backend.service.GitIdentityService;
import wearefrank.backend.service.VersioningService;
import wearefrank.backend.service.versioning.GitHubConfig;
import wearefrank.backend.service.versioning.GitLabConfig;
import wearefrank.backend.service.versioning.GiteaConfig;

import java.util.List;
import java.util.Optional;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(VersioningController.class)
class VersioningControllerTest {

    @Autowired
    MockMvc mockMvc;

    @MockitoBean
    VersioningService versioningService;

    // Returns no brokered token by default, so these tests keep exercising the header path.
    @MockitoBean
    GitIdentityService gitIdentityService;

    @Test
    void listVersions_defaultsToGithub_whenNoProviderHeaderGiven() throws Exception {
        GitHubConfig expectedConfig = new GitHubConfig("tok", "owner/repo", "main", "routes.yaml");
        when(versioningService.listVersions(expectedConfig))
                .thenReturn(List.of(new ConfigVersionDto.Summary("v1", "msg", "2026-01-01", "http://url", "alice")));

        mockMvc.perform(get("/api/versions")
                        .header("X-Github-Token", "tok")
                        .header("X-Github-Repo", "owner/repo")
                        .header("X-Github-Branch", "main")
                        .header("X-Github-File-Path", "routes.yaml"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("v1"))
                .andExpect(jsonPath("$[0].message").value("msg"))
                .andExpect(jsonPath("$[0].author").value("alice"));
    }

    @Test
    void listVersions_usesEmptyStringHeaders_whenNoneProvided() throws Exception {
        GitHubConfig expectedConfig = new GitHubConfig("", "", "", "");
        when(versioningService.listVersions(expectedConfig)).thenReturn(List.of());

        mockMvc.perform(get("/api/versions"))
                .andExpect(status().isOk())
                .andExpect(content().json("[]"));
    }

    @Test
    void listVersions_usesGitlabConfig_whenProviderHeaderIsGitlab() throws Exception {
        GitLabConfig expectedConfig = new GitLabConfig("tok", "gitlab.example.com", "42", "main", "routes.yaml");
        when(versioningService.listVersions(expectedConfig))
                .thenReturn(List.of(new ConfigVersionDto.Summary("v2", "gitlab msg", "2026-02-02", "http://gl", "bob")));

        mockMvc.perform(get("/api/versions")
                        .header("X-Git-Provider", "gitlab")
                        .header("X-Gitlab-Token", "tok")
                        .header("X-Gitlab-Host", "gitlab.example.com")
                        .header("X-Gitlab-Project", "42")
                        .header("X-Gitlab-Branch", "main")
                        .header("X-Gitlab-File-Path", "routes.yaml"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("v2"));
    }

    @Test
    void listVersions_usesGiteaConfig_whenProviderHeaderIsGitea() throws Exception {
        GiteaConfig expectedConfig = new GiteaConfig("tok", "gitea.example.com", "owner/repo", "main", "routes.yaml");
        when(versioningService.listVersions(expectedConfig))
                .thenReturn(List.of(new ConfigVersionDto.Summary("v3", "gitea msg", "2026-03-03", "http://ge", "carol")));

        mockMvc.perform(get("/api/versions")
                        .header("X-Git-Provider", "gitea")
                        .header("X-Gitea-Token", "tok")
                        .header("X-Gitea-Host", "gitea.example.com")
                        .header("X-Gitea-Repo", "owner/repo")
                        .header("X-Gitea-Branch", "main")
                        .header("X-Gitea-File-Path", "routes.yaml"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("v3"));
    }

    @Test
    void listVersions_providerHeaderIsCaseInsensitive() throws Exception {
        GitLabConfig expectedConfig = new GitLabConfig("", "", "", "", "");
        when(versioningService.listVersions(expectedConfig)).thenReturn(List.of());

        mockMvc.perform(get("/api/versions").header("X-Git-Provider", "GitLab"))
                .andExpect(status().isOk());
    }

    @Test
    void getVersion_returnsVersionForId() throws Exception {
        GitHubConfig expectedConfig = new GitHubConfig("tok", "owner/repo", "main", "routes.yaml");
        when(versioningService.getVersion("v1", expectedConfig))
                .thenReturn(new ConfigVersionDto("v1", "msg", "2026-01-01", "yaml content"));

        mockMvc.perform(get("/api/versions/v1")
                        .header("X-Github-Token", "tok")
                        .header("X-Github-Repo", "owner/repo")
                        .header("X-Github-Branch", "main")
                        .header("X-Github-File-Path", "routes.yaml"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("v1"))
                .andExpect(jsonPath("$.content").value("yaml content"));
    }

    @Test
    void saveVersion_postsMessageAndContent_returnsSummary() throws Exception {
        GitHubConfig expectedConfig = new GitHubConfig("tok", "owner/repo", "main", "routes.yaml");
        when(versioningService.saveVersion("commit msg", "yaml: true", expectedConfig))
                .thenReturn(new ConfigVersionDto.Summary("v4", "commit msg", "2026-04-04", "http://url", "dave"));

        mockMvc.perform(post("/api/versions")
                        .header("X-Github-Token", "tok")
                        .header("X-Github-Repo", "owner/repo")
                        .header("X-Github-Branch", "main")
                        .header("X-Github-File-Path", "routes.yaml")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"message\":\"commit msg\",\"content\":\"yaml: true\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("v4"))
                .andExpect(jsonPath("$.message").value("commit msg"));
    }

    @Test
    void readCurrentFile_returnsPlainTextContent() throws Exception {
        GitHubConfig expectedConfig = new GitHubConfig("tok", "owner/repo", "main", "routes.yaml");
        when(versioningService.readCurrentFile(expectedConfig)).thenReturn("routes:\n  - id: r1\n");

        mockMvc.perform(get("/api/versions/file")
                        .header("X-Github-Token", "tok")
                        .header("X-Github-Repo", "owner/repo")
                        .header("X-Github-Branch", "main")
                        .header("X-Github-File-Path", "routes.yaml"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.TEXT_PLAIN))
                .andExpect(content().string("routes:\n  - id: r1\n"));
    }

    @Test
    void fileExists_returnsTrue_whenServiceReportsTrue() throws Exception {
        GitHubConfig expectedConfig = new GitHubConfig("tok", "owner/repo", "main", "routes.yaml");
        when(versioningService.fileExists(expectedConfig)).thenReturn(true);

        mockMvc.perform(get("/api/versions/exists")
                        .header("X-Github-Token", "tok")
                        .header("X-Github-Repo", "owner/repo")
                        .header("X-Github-Branch", "main")
                        .header("X-Github-File-Path", "routes.yaml"))
                .andExpect(status().isOk())
                .andExpect(content().string("true"));
    }

    @Test
    void fileExists_returnsFalse_whenServiceReportsFalse() throws Exception {
        GitHubConfig expectedConfig = new GitHubConfig("", "", "", "");
        when(versioningService.fileExists(expectedConfig)).thenReturn(false);

        mockMvc.perform(get("/api/versions/exists"))
                .andExpect(status().isOk())
                .andExpect(content().string("false"));
    }

    // --- Tokens brokered through Keycloak ---

    @Test
    void listVersions_usesTheBrokeredToken_whenNoTokenHeaderIsSent() throws Exception {
        when(gitIdentityService.brokeredToken("github")).thenReturn(Optional.of("gho_brokered"));
        GitHubConfig expectedConfig = new GitHubConfig("gho_brokered", "owner/repo", "main", "routes.yaml");
        when(versioningService.listVersions(expectedConfig))
                .thenReturn(List.of(new ConfigVersionDto.Summary("v1", "msg", "2026-01-01", "http://url", "alice")));

        mockMvc.perform(get("/api/versions")
                        .header("X-Github-Repo", "owner/repo")
                        .header("X-Github-Branch", "main")
                        .header("X-Github-File-Path", "routes.yaml"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("v1"));
    }

    @Test
    void listVersions_prefersTheHeaderToken_soThePersonalAccessTokenFallbackKeepsWorking() throws Exception {
        when(gitIdentityService.brokeredToken("github")).thenReturn(Optional.of("gho_brokered"));
        GitHubConfig expectedConfig = new GitHubConfig("pat", "owner/repo", "main", "routes.yaml");
        when(versioningService.listVersions(expectedConfig))
                .thenReturn(List.of(new ConfigVersionDto.Summary("v1", "msg", "2026-01-01", "http://url", "alice")));

        mockMvc.perform(get("/api/versions")
                        .header("X-Github-Token", "pat")
                        .header("X-Github-Repo", "owner/repo")
                        .header("X-Github-Branch", "main")
                        .header("X-Github-File-Path", "routes.yaml"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("v1"));
    }

    @Test
    void listVersions_usesTheBrokeredGitlabToken_whenNoTokenHeaderIsSent() throws Exception {
        when(gitIdentityService.brokeredToken("gitlab")).thenReturn(Optional.of("glpat_brokered"));
        GitLabConfig expectedConfig =
                new GitLabConfig("glpat_brokered", "https://gitlab.com", "owner/project", "main", "routes.yaml");
        when(versioningService.listVersions(expectedConfig)).thenReturn(List.of());

        mockMvc.perform(get("/api/versions")
                        .header("X-Git-Provider", "gitlab")
                        .header("X-Gitlab-Host", "https://gitlab.com")
                        .header("X-Gitlab-Project", "owner/project")
                        .header("X-Gitlab-Branch", "main")
                        .header("X-Gitlab-File-Path", "routes.yaml"))
                .andExpect(status().isOk())
                .andExpect(content().json("[]"));
    }
}
