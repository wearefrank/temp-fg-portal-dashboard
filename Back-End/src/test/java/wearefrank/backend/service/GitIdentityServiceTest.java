package wearefrank.backend.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.OAuth2AccessToken;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.io.IOException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class GitIdentityServiceTest {

    private static final String ISSUER = "http://keycloak/realms/frank";
    private static final String CLIENT_ID = "frank-confidential";

    private HttpClient httpClient;
    private OAuth2AuthorizedClientManager authorizedClientManager;
    private GitIdentityService service;

    @BeforeEach
    void setUp() {
        httpClient = mock(HttpClient.class);
        authorizedClientManager = mock(OAuth2AuthorizedClientManager.class);
        service = newService(ISSUER, "github,gitlab");

        // The service reads the current request and authentication out of the thread context.
        RequestContextHolder.setRequestAttributes(
                new ServletRequestAttributes(new MockHttpServletRequest(), new MockHttpServletResponse()));
        SecurityContextHolder.getContext().setAuthentication(
                new TestingAuthenticationToken("alice", "n/a"));
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
        SecurityContextHolder.clearContext();
    }

    private GitIdentityService newService(String issuer, String providers) {
        return new GitIdentityService(httpClient, new ObjectMapper(), authorizedClientManager,
                "OIDC", issuer, CLIENT_ID, providers);
    }

    @SuppressWarnings("unchecked")
    private void keycloakResponds(int status, String body) throws Exception {
        HttpResponse<String> response = mock(HttpResponse.class);
        lenient().when(response.statusCode()).thenReturn(status);
        lenient().when(response.body()).thenReturn(body);
        doReturn(response).when(httpClient).send(any(), any());
    }

    private void withAuthorizedClient(String accessToken) {
        ClientRegistration registration = ClientRegistration.withRegistrationId("keycloak")
                .clientId(CLIENT_ID)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri("{baseUrl}/login/oauth2/code/keycloak")
                .authorizationUri(ISSUER + "/protocol/openid-connect/auth")
                .tokenUri(ISSUER + "/protocol/openid-connect/token")
                .build();

        OAuth2AccessToken token = new OAuth2AccessToken(
                OAuth2AccessToken.TokenType.BEARER, accessToken, Instant.now(), Instant.now().plusSeconds(300));

        when(authorizedClientManager.authorize(any()))
                .thenReturn(new OAuth2AuthorizedClient(registration, "alice", token));
    }

    @Test
    void brokeredToken_returnsTheStoredProviderToken() throws Exception {
        withAuthorizedClient("kc-access-token");
        keycloakResponds(200, "{\"access_token\":\"gho_secret\",\"refresh_token\":\"r\"}");

        assertThat(service.brokeredToken("github")).contains("gho_secret");
    }

    @Test
    void brokeredToken_callsTheBrokerEndpointWithTheKeycloakToken() throws Exception {
        withAuthorizedClient("kc-access-token");
        keycloakResponds(200, "{\"access_token\":\"gho_secret\"}");

        service.brokeredToken("github");

        ArgumentCaptor<HttpRequest> captor = ArgumentCaptor.forClass(HttpRequest.class);
        verify(httpClient).send(captor.capture(), any());
        assertThat(captor.getValue().uri().toString()).isEqualTo(ISSUER + "/broker/github/token");
        assertThat(captor.getValue().headers().firstValue("Authorization")).contains("Bearer kc-access-token");
    }

    @Test
    void brokeredToken_isEmpty_whenTheUserHasNotLinkedTheProvider() throws Exception {
        withAuthorizedClient("kc-access-token");
        keycloakResponds(400, "{\"error\":\"invalid_request\"}");

        assertThat(service.brokeredToken("github")).isEmpty();
    }

    @Test
    void brokeredToken_isEmpty_ratherThanThrowing_whenKeycloakIsUnreachable() throws Exception {
        withAuthorizedClient("kc-access-token");
        doThrow(new IOException("connection refused")).when(httpClient).send(any(), any());

        // Throwing here would become a 502 and take the personal-access-token fallback down with it.
        assertThat(service.brokeredToken("github")).isEmpty();
    }

    @Test
    void brokeredToken_isEmpty_whenThereIsNoKeycloakSession() throws Exception {
        when(authorizedClientManager.authorize(any())).thenReturn(null);

        assertThat(service.brokeredToken("github")).isEmpty();
        verify(httpClient, never()).send(any(), any());
    }

    @Test
    void brokeredToken_skipsProvidersThisDeploymentDoesNotBroker() throws Exception {
        assertThat(service.brokeredToken("gitea")).isEmpty();
        verify(httpClient, never()).send(any(), any());
    }

    @Test
    void isAvailable_isFalse_withoutAnIssuer() {
        assertThat(newService("", "github,gitlab").isAvailable("github")).isFalse();
    }

    @Test
    void providers_keepTheConfiguredOrderAndIgnoreBlanks() {
        assertThat(newService(ISSUER, " gitlab , , github ").providers())
                .containsExactly("gitlab", "github");
    }

    @Test
    void brokeredToken_readsGithubsFormUrlencodedResponse() throws Exception {
        withAuthorizedClient("kc-access-token");
        // GitHub answers form-urlencoded unless the provider's githubJsonFormat option is on,
        // and Keycloak passes that body straight through.
        keycloakResponds(200, "access_token=gho_secret&scope=repo%2Cuser&token_type=bearer");

        assertThat(service.brokeredToken("github")).contains("gho_secret");
    }

    @Test
    void extractAccessToken_handlesBothShapesAndRejectsJunk() {
        assertThat(service.extractAccessToken("{\"access_token\":\"a\"}")).isEqualTo("a");
        assertThat(service.extractAccessToken("access_token=b&scope=repo")).isEqualTo("b");
        assertThat(service.extractAccessToken("scope=repo&access_token=c")).isEqualTo("c");
        assertThat(service.extractAccessToken("token_type=bearer&scope=repo")).isEmpty();
        assertThat(service.extractAccessToken("{\"error\":\"nope\"}")).isEmpty();
        assertThat(service.extractAccessToken("not a token at all")).isEmpty();
        assertThat(service.extractAccessToken("")).isEmpty();
        assertThat(service.extractAccessToken(null)).isEmpty();
    }

    @Test
    void linkedAccounts_parsesKeycloaksAccountApi() throws Exception {
        withAuthorizedClient("kc-access-token");
        keycloakResponds(200, """
                [ {"providerAlias":"github","connected":true,"linkedUsername":"octocat","displayName":"GitHub"},
                  {"providerAlias":"gitlab","connected":false,"linkedUsername":null,"displayName":"GitLab"} ]""");

        var accounts = service.linkedAccounts();

        assertThat(accounts).containsOnlyKeys("github", "gitlab");
        assertThat(accounts.get("github").connected()).isTrue();
        assertThat(accounts.get("github").username()).isEqualTo("octocat");
        assertThat(accounts.get("gitlab").connected()).isFalse();
        assertThat(accounts.get("gitlab").username()).isNull();
    }

    @Test
    void linkedAccounts_callsTheAccountEndpointOnce() throws Exception {
        withAuthorizedClient("kc-access-token");
        keycloakResponds(200, "[]");

        service.linkedAccounts();

        ArgumentCaptor<HttpRequest> captor = ArgumentCaptor.forClass(HttpRequest.class);
        verify(httpClient).send(captor.capture(), any());
        assertThat(captor.getValue().uri().toString()).isEqualTo(ISSUER + "/account/linked-accounts");
    }

    @Test
    void linkedAccounts_isEmpty_whenTheAccountApiRefuses() throws Exception {
        withAuthorizedClient("kc-access-token");
        keycloakResponds(403, "{\"error\":\"forbidden\"}");

        // Empty means "could not tell", which makes the caller probe instead of reporting unlinked.
        assertThat(service.linkedAccounts()).isEmpty();
    }

    @Test
    void linkedAccounts_isEmpty_ratherThanThrowing_whenKeycloakIsUnreachable() throws Exception {
        withAuthorizedClient("kc-access-token");
        doThrow(new IOException("connection refused")).when(httpClient).send(any(), any());

        assertThat(service.linkedAccounts()).isEmpty();
    }

    @Test
    void linkHash_matchesKeycloaksUnpaddedBase64UrlSha256() throws Exception {
        byte[] expected = MessageDigest.getInstance("SHA-256")
                .digest("nonce-1session-2frank-confidentialgithub".getBytes(StandardCharsets.UTF_8));

        assertThat(GitIdentityService.linkHash("nonce-1", "session-2", CLIENT_ID, "github"))
                .isEqualTo(Base64.getUrlEncoder().withoutPadding().encodeToString(expected))
                .doesNotContain("=");
    }

    @Test
    void linkUrl_isEmpty_whenThePrincipalCarriesNoSessionState() {
        // A TestingAuthenticationToken is not an OidcUser, so there is no session_state to hash.
        Optional<String> url = service.linkUrl("github", "http://console/callback", "nonce-1");

        assertThat(url).isEmpty();
    }
}
