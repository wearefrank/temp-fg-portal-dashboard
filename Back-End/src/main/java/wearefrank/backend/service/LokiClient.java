package wearefrank.backend.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * Read side of the gateway's access log. The write side is APISIX's loki-logger plugin -
 * see the loki-logger block in config/apisix.yaml for the labels and the line format this
 * client gets back. Nothing here ever pushes.
 *
 * Shaped after {@link PrometheusClient}: a thin HTTP wrapper that hands the response body
 * back untouched, with the parsing left to {@link LogsService}.
 */
@Service
public class LokiClient {

    private final String baseUrl;
    private final String tenantId;
    private final HttpClient httpClient;

    public LokiClient(
            @Value("${LOKI_URL:http://localhost:3100}") String baseUrl,
            // Only does anything against a Loki running with auth_enabled: true. The local
            // one ignores the header and files every line under the "fake" tenant, whatever
            // the plugin's tenant_id says - so this stays empty for the compose stack.
            @Value("${LOKI_TENANT_ID:}") String tenantId,
            HttpClient httpClient) {
        this.baseUrl = baseUrl;
        this.tenantId = tenantId;
        this.httpClient = httpClient;
    }

    /**
     * Range query over a LogQL selector. direction "backward" returns the newest entries
     * first, which is what the limit then truncates - "forward" with a limit would hand
     * back the oldest lines in the window instead.
     */
    public String queryRange(String logql, long startNanos, long endNanos, int limit, String direction) {
        String url = baseUrl + "/loki/api/v1/query_range"
                + "?query=" + URLEncoder.encode(logql, StandardCharsets.UTF_8)
                // Nanoseconds, which is what Loki works in. Taking them here rather than
                // seconds keeps the conversion in one place (LogsService) and lets a caller
                // pass an exact line timestamp as the paging cursor - rounding that to a
                // second would re-serve or skip every other line sharing it.
                + "&start=" + startNanos
                + "&end=" + endNanos
                + "&limit=" + limit
                + "&direction=" + URLEncoder.encode(direction, StandardCharsets.UTF_8);
        return get(url);
    }

    /**
     * Instant query, for the metric-style LogQL the counters use
     * (sum(count_over_time(...))). The range form above returns log lines; this one
     * returns a single scalar per series.
     *
     * @param timeNanos evaluate as of this instant, or null for now. Paging pins it so the
     *                  total cannot move between one page request and the next - without
     *                  it, lines arriving mid-session change how many pages there are.
     */
    public String instantQuery(String logql, Long timeNanos) {
        String url = baseUrl + "/loki/api/v1/query?query=" + URLEncoder.encode(logql, StandardCharsets.UTF_8);
        if (timeNanos != null) {
            url += "&time=" + timeNanos;
        }
        return get(url);
    }

    private String get(String url) {
        try {
            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(15))
                    .GET();
            if (!tenantId.isBlank()) {
                builder.header("X-Scope-OrgID", tenantId);
            }
            HttpResponse<String> response = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                throw new RuntimeException("Loki returned " + response.statusCode());
            }
            return response.body();
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("Failed to reach Loki: " + e.getMessage(), e);
        }
    }
}
