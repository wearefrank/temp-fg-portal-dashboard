package wearefrank.backend.config;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * What a signed-out browser has to be able to fetch before it can sign in.
 *
 * These go over real HTTP rather than through MockMvc on purpose: the bug this guards
 * against lived in the seam between {@link SecurityConfig}'s matchers and
 * {@link WebConfig}'s catch-all resource handler, and only shows up with both in the same
 * running application. It is also invisible in development - the vite dev server answers
 * /assets itself and proxies only /api, so the security chain never sees an asset request
 * there. It appears the moment the frontend is bundled into the jar, which is every
 * deployed console.
 *
 * IN_MEMORY keeps an identity provider out of the picture; the paths asserted here are in
 * the shared chain, so they hold for OIDC too.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "console.security.auth.type=IN_MEMORY",
                "console.security.auth.in-memory.users[0].username=admin",
                "console.security.auth.in-memory.users[0].password={noop}secret",
                "console.security.auth.in-memory.users[0].roles=gateway-admin"
        })
class LoginPageAccessTest {

    // Redirects stay unfollowed: a 302 to the login page is the failure being tested for,
    // and following it would turn that into an indistinguishable 200.
    private final HttpClient client = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    @Value("${local.server.port}")
    int port;

    /**
     * The regression. Authenticating /assets/** sends the login page's own bundle to the
     * login page, so it never boots and the browser shows a blank page with nothing but a
     * MIME type complaint in the console.
     */
    @Test
    void servesTheLoginPageBundleWithoutASession() throws Exception {
        HttpResponse<String> script = get("/assets/index-test.js");

        assertThat(script.statusCode()).isEqualTo(200);
        assertThat(script.body()).contains("mounted");
        // The tags vite emits carry crossorigin, so the browser fetches these in CORS mode
        // and rejects anything whose type does not match - a redirected HTML body included.
        assertThat(contentType(script)).contains("javascript");

        HttpResponse<String> stylesheet = get("/assets/index-test.css");

        assertThat(stylesheet.statusCode()).isEqualTo(200);
        assertThat(contentType(stylesheet)).contains("text/css");
    }

    /** The page those two belong to. Permitted already, but it is half of the same guarantee. */
    @Test
    void servesTheLoginPageItselfWithoutASession() throws Exception {
        HttpResponse<String> response = get("/login");

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(contentType(response)).contains("text/html");
        assertThat(response.body()).contains("/assets/index-test.js");
    }

    /**
     * The other side of it: opening up the bundle must not open up anything that reads or
     * writes gateway state. Without this, a permitAll broad enough to fix the blank page
     * would pass the test above just as happily.
     */
    @Test
    void stillRefusesApiCallsWithoutASession() throws Exception {
        // 401 rather than a redirect - /api/** has its own entry point so that an expired
        // session surfaces in the frontend as an error instead of as login-page HTML.
        assertThat(get("/api/config").statusCode()).isEqualTo(401);
    }

    /**
     * An unknown route is a client-side one: WebConfig hands back the SPA shell so the
     * router can resolve it. That must stay behind authentication, or the fallback becomes
     * a way to reach the application without logging in.
     */
    @Test
    void stillRequiresASessionForApplicationRoutes() throws Exception {
        HttpResponse<String> response = navigateTo("/dashboard");

        assertThat(response.statusCode()).isEqualTo(302);
        assertThat(response.headers().firstValue("Location").orElseThrow()).endsWith("/login");
    }

    /**
     * Why the browser reported the blocked bundle as an empty MIME type rather than as the
     * login page's text/html, and why this was so unrecognisable from the console output.
     *
     * formLogin's redirect is registered as an entry point behind a media type matcher, so
     * only a request that says it wants HTML is sent to the login page. A module script or
     * stylesheet asks for {@code &#42;/&#42;} or {@code text/css}, misses that matcher, and falls
     * through to the 401 registered for /api/** - which writes a status and nothing else. No body, no
     * Content-Type, and with nosniff set the browser refuses it and logs a type of "".
     *
     * Nothing about that is wrong on its own, and it is asserted so it stays deliberate:
     * the answer was never to make the entry point chattier, it was to stop asset requests
     * from reaching it.
     */
    @Test
    void answersNonNavigationRequestsWithABodylessUnauthorized() throws Exception {
        HttpResponse<String> response = get("/some/route/that/is/not/permitted");

        assertThat(response.statusCode()).isEqualTo(401);
        assertThat(response.body()).isEmpty();
        assertThat(contentType(response)).isEmpty();
        assertThat(response.headers().firstValue("X-Content-Type-Options")).contains("nosniff");
    }

    /** How a script, stylesheet or fetch() asks: no Accept preference for HTML. */
    private HttpResponse<String> get(String path) throws Exception {
        return send(HttpRequest.newBuilder().uri(uri(path)).GET().build());
    }

    /** How the address bar asks. The Accept header is what routes it to the login page. */
    private HttpResponse<String> navigateTo(String path) throws Exception {
        return send(HttpRequest.newBuilder()
                .uri(uri(path))
                .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                .GET()
                .build());
    }

    private HttpResponse<String> send(HttpRequest request) throws Exception {
        return client.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private URI uri(String path) {
        return URI.create("http://localhost:" + port + path);
    }

    private String contentType(HttpResponse<String> response) {
        return response.headers().firstValue("Content-Type").orElse("");
    }
}
