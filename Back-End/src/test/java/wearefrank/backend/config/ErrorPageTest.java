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
 * That an error reaching a browser is answered by the console's own page rather than by
 * Spring Boot's Whitelabel Error Page.
 *
 * The pages are static files under resources/static/error, picked up by
 * DefaultErrorViewResolver on name alone - nothing wires them up, so nothing fails loudly
 * when they are moved, renamed, or dropped from the image. That is what these assert.
 *
 * Real HTTP rather than MockMvc for the same reason as {@link LoginPageAccessTest}: the
 * error page is chosen during the container's ERROR dispatch, which MockMvc does not run.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "console.security.auth.type=IN_MEMORY",
                "console.security.auth.in-memory.users[0].username=admin",
                "console.security.auth.in-memory.users[0].password={noop}secret",
                "console.security.auth.in-memory.users[0].roles=gateway-admin"
        })
class ErrorPageTest {

    /**
     * The sentence the page being replaced is recognisable by. Matched on this rather than
     * on its title, which the pages themselves mention.
     */
    private static final String WHITELABEL = "no explicit mapping for /error";

    private final HttpClient client = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    @Value("${local.server.port}")
    int port;

    /**
     * The case that prompted these: a login against a password with no encoder prefix
     * throws IllegalArgumentException, which is not an AuthenticationException, so it
     * escapes the filter chain as a 500. Whatever the cause, the browser must not be told
     * "this application has no explicit mapping for /error".
     *
     * /error is requested directly rather than by provoking a real exception - with no
     * status attribute set, BasicErrorController treats it as a 500, which is exactly the
     * resolution path an ERROR dispatch takes.
     */
    @Test
    void rendersTheConsolesOwnPageForServerErrors() throws Exception {
        HttpResponse<String> response = navigateTo("/error");

        assertThat(response.statusCode()).isEqualTo(500);
        assertThat(contentType(response)).contains("text/html");
        assertThat(response.body()).contains("Something went wrong");
        // Where the detail actually is. The page saying so is the whole point of replacing
        // one that says nothing.
        assertThat(response.body()).contains("server log");
        assertThat(response.body()).doesNotContain(WHITELABEL);
    }

    /**
     * The 4xx half. A POST to the login page reaches the resource handler, which serves GET
     * and HEAD only - the same 405 a hand-typed URL or a stale bookmark produces.
     */
    @Test
    void rendersTheConsolesOwnPageForClientErrors() throws Exception {
        HttpResponse<String> response = send(HttpRequest.newBuilder()
                .uri(uri("/login"))
                .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                .POST(HttpRequest.BodyPublishers.noBody())
                .build());

        assertThat(response.statusCode()).isEqualTo(405);
        assertThat(contentType(response)).contains("text/html");
        assertThat(response.body()).contains("was not accepted");
        assertThat(response.body()).doesNotContain(WHITELABEL);
    }

    /**
     * The frontend reads errors as JSON, and a page of HTML in place of one would be a
     * parse failure rather than a message. Content negotiation already arranges this; it is
     * asserted so that adding an error page cannot quietly take it away.
     */
    @Test
    void stillAnswersApiCallersWithJson() throws Exception {
        HttpResponse<String> response = send(HttpRequest.newBuilder()
                .uri(uri("/error"))
                .header("Accept", "application/json")
                .GET()
                .build());

        assertThat(contentType(response)).contains("application/json");
        assertThat(response.body()).doesNotContain("<html");
    }

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
