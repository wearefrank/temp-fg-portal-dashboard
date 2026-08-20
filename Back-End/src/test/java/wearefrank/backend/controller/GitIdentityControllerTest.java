package wearefrank.backend.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import wearefrank.backend.service.GitIdentityService;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(GitIdentityController.class)
class GitIdentityControllerTest {

    @Autowired
    MockMvc mockMvc;

    @MockitoBean
    GitIdentityService gitIdentityService;

    /** The session holding the pending link, plus the correlator Keycloak echoes back. */
    private record StartedLink(MockHttpSession session, String linkState, String redirectUri) {
    }

    /**
     * Runs a real link request and digs the correlator out of the redirect_uri the
     * controller handed to Keycloak - that is the only place it is exposed.
     */
    private StartedLink startLink(String provider) throws Exception {
        when(gitIdentityService.isAvailable(provider)).thenReturn(true);
        when(gitIdentityService.linkUrl(eq(provider), any(), any())).thenAnswer(invocation ->
                Optional.of("http://keycloak/link?redirect_uri=" + invocation.getArgument(1, String.class)));

        MvcResult result = mockMvc.perform(post("/api/git/" + provider + "/link"))
                .andExpect(status().isOk())
                .andReturn();

        String body = result.getResponse().getContentAsString();
        String redirectUri = body.substring(body.indexOf("redirect_uri=") + "redirect_uri=".length())
                .replaceAll("[\"}].*", "");
        String linkState = redirectUri.substring(redirectUri.indexOf("linkState=") + "linkState=".length())
                .replaceAll("&.*", "");
        assertThat(linkState).isNotBlank();

        return new StartedLink((MockHttpSession) result.getRequest().getSession(false), linkState, redirectUri);
    }

    @Test
    void identity_reportsTheLinkedAccountNameFromKeycloak() throws Exception {
        when(gitIdentityService.providers()).thenReturn(List.of("github", "gitlab"));
        when(gitIdentityService.isAvailable("github")).thenReturn(true);
        when(gitIdentityService.isAvailable("gitlab")).thenReturn(true);
        when(gitIdentityService.linkedAccounts()).thenReturn(Map.of(
                "github", new GitIdentityService.LinkedAccount(true, "octocat"),
                "gitlab", new GitIdentityService.LinkedAccount(false, null)));

        mockMvc.perform(get("/api/git/identity"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.github.linked").value(true))
                .andExpect(jsonPath("$.github.username").value("octocat"))
                .andExpect(jsonPath("$.gitlab.linked").value(false))
                .andExpect(jsonPath("$.gitlab.username").doesNotExist());

        // The account API answered for both, so no token probing was needed.
        verify(gitIdentityService, never()).brokeredToken(any());
    }

    @Test
    void identity_reportsProvidersThisDeploymentDoesNotBrokerAsUnavailable() throws Exception {
        when(gitIdentityService.providers()).thenReturn(List.of("github", "gitlab"));
        when(gitIdentityService.isAvailable("github")).thenReturn(true);
        when(gitIdentityService.isAvailable("gitlab")).thenReturn(false);
        when(gitIdentityService.linkedAccounts()).thenReturn(Map.of(
                "github", new GitIdentityService.LinkedAccount(true, "octocat")));

        mockMvc.perform(get("/api/git/identity"))
                .andExpect(jsonPath("$.github.available").value(true))
                .andExpect(jsonPath("$.gitlab.available").value(false))
                .andExpect(jsonPath("$.gitlab.linked").value(false));
    }

    @Test
    void identity_fallsBackToProbingTheToken_whenTheAccountApiIsUnreachable() throws Exception {
        when(gitIdentityService.providers()).thenReturn(List.of("github"));
        when(gitIdentityService.isAvailable("github")).thenReturn(true);
        when(gitIdentityService.linkedAccounts()).thenReturn(Map.of());
        when(gitIdentityService.brokeredToken("github")).thenReturn(Optional.of("gho_secret"));

        mockMvc.perform(get("/api/git/identity"))
                .andExpect(jsonPath("$.github.linked").value(true))
                .andExpect(jsonPath("$.github.username").doesNotExist());
    }

    @Test
    void identity_neverLeaksTheBrokeredToken() throws Exception {
        when(gitIdentityService.providers()).thenReturn(List.of("github"));
        when(gitIdentityService.isAvailable("github")).thenReturn(true);
        when(gitIdentityService.linkedAccounts()).thenReturn(Map.of());
        when(gitIdentityService.brokeredToken("github")).thenReturn(Optional.of("gho_secret"));

        MvcResult result = mockMvc.perform(get("/api/git/identity")).andReturn();

        assertThat(result.getResponse().getContentAsString()).doesNotContain("gho_secret");
    }

    @Test
    void startLink_returnsTheKeycloakUrlInsteadOfRedirecting() throws Exception {
        when(gitIdentityService.linkUrl(eq("github"), any(), any()))
                .thenReturn(Optional.of("http://keycloak/realms/frank/broker/github/link?hash=x"));

        mockMvc.perform(post("/api/git/github/link"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.url").value("http://keycloak/realms/frank/broker/github/link?hash=x"));
    }

    @Test
    void startLink_pointsKeycloakAtTheCallbackForThisProvider() throws Exception {
        StartedLink started = startLink("github");

        assertThat(started.linkState()).isNotBlank();
        assertThat(started.session()).isNotNull();
        assertThat(started.redirectUri()).contains("/api/git/link/callback").contains("provider=github");
    }

    /**
     * Keycloak refuses a redirect_uri carrying an OIDC-reserved parameter name, so the
     * callback correlator must not be called "state" (or "nonce", "code", "session_state").
     */
    @Test
    void startLink_keepsOidcReservedNamesOutOfTheRedirectUri() throws Exception {
        String query = startLink("github").redirectUri().replaceFirst("^[^?]*\\??", "");

        for (String reserved : List.of("state", "nonce", "code", "session_state", "iss")) {
            assertThat(query.matches(".*(^|&)" + reserved + "=.*"))
                    .as("redirect_uri query must not contain the reserved parameter '%s': %s", reserved, query)
                    .isFalse();
        }
    }

    @Test
    void startLink_failsWhenTheProviderIsNotBrokered() throws Exception {
        when(gitIdentityService.linkUrl(any(), any(), any())).thenReturn(Optional.empty());

        // GlobalExceptionHandler is outside this slice, so the ResponseStatusException shows through.
        mockMvc.perform(post("/api/git/github/link"))
                .andExpect(status().isServiceUnavailable());
    }

    @Test
    void completeLink_redirectsToTheSettingsPanel_whenTheStateMatches() throws Exception {
        StartedLink started = startLink("github");

        mockMvc.perform(get("/api/git/link/callback")
                        .param("provider", "github")
                        .param("linkState", started.linkState())
                        .session(started.session()))
                .andExpect(status().isFound())
                .andExpect(header().string("Location", "/history?settings=1&linked=github"));
    }

    @Test
    void completeLink_rejectsAnUnknownState() throws Exception {
        StartedLink started = startLink("github");

        mockMvc.perform(get("/api/git/link/callback")
                        .param("provider", "github")
                        .param("linkState", "not-the-state-we-issued")
                        .session(started.session()))
                .andExpect(header().string("Location", "/history?settings=1&linkError=unexpected"));
    }

    @Test
    void completeLink_rejectsACallbackForADifferentProvider() throws Exception {
        StartedLink started = startLink("github");

        mockMvc.perform(get("/api/git/link/callback")
                        .param("provider", "gitlab")
                        .param("linkState", started.linkState())
                        .session(started.session()))
                .andExpect(header().string("Location", "/history?settings=1&linkError=unexpected"));
    }

    @Test
    void completeLink_rejectsACallbackNobodyStarted() throws Exception {
        mockMvc.perform(get("/api/git/link/callback")
                        .param("provider", "github")
                        .param("linkState", "anything"))
                .andExpect(header().string("Location", "/history?settings=1&linkError=unexpected"));
    }

    @Test
    void completeLink_acceptsTheCallbackOnlyOnce() throws Exception {
        StartedLink started = startLink("github");

        mockMvc.perform(get("/api/git/link/callback")
                        .param("provider", "github").param("linkState", started.linkState()).session(started.session()))
                .andExpect(header().string("Location", "/history?settings=1&linked=github"));

        mockMvc.perform(get("/api/git/link/callback")
                        .param("provider", "github").param("linkState", started.linkState()).session(started.session()))
                .andExpect(header().string("Location", "/history?settings=1&linkError=unexpected"));
    }

    /**
     * Keycloak names the parameter link_error, not error. Reading the wrong one makes a
     * failed link look like a success and bounces the user back with no explanation.
     */
    @Test
    void completeLink_readsKeycloaksLinkErrorParameter() throws Exception {
        StartedLink started = startLink("github");

        mockMvc.perform(get("/api/git/link/callback")
                        .param("provider", "github")
                        .param("linkState", started.linkState())
                        .param("link_error", "not_logged_in")
                        .session(started.session()))
                .andExpect(header().string("Location", "/history?settings=1&linkError=not_logged_in"));
    }

    @Test
    void completeLink_alsoAcceptsAPlainErrorParameter() throws Exception {
        StartedLink started = startLink("github");

        mockMvc.perform(get("/api/git/link/callback")
                        .param("provider", "github")
                        .param("linkState", started.linkState())
                        .param("error", "not_allowed")
                        .session(started.session()))
                .andExpect(header().string("Location", "/history?settings=1&linkError=not_allowed"));
    }
}
