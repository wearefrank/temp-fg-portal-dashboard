package wearefrank.backend.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import wearefrank.backend.dto.MetricsDto;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class MetricsService {

    private final ApisixClient apisixClient;
    private final PrometheusClient prometheusClient;
    private final ObjectMapper objectMapper;

    public MetricsService(ApisixClient apisixClient, PrometheusClient prometheusClient, ObjectMapper objectMapper) {
        this.apisixClient = apisixClient;
        this.prometheusClient = prometheusClient;
        this.objectMapper = objectMapper;
    }

    public String getHealthcheck() {
        return apisixClient.controlGet("/v1/healthcheck");
    }

    public List<Object> getLiveRoutes() {
        return getLiveEntities("/v1/routes", "routes");
    }

    public List<Object> getLiveUpstreams() {
        return getLiveEntities("/v1/upstreams", "upstreams");
    }

    public List<Object> getLiveServices() {
        return getLiveEntities("/v1/services", "services");
    }

    // the control API answers with a [{key, value}, ...] array for each entity type
    @SuppressWarnings("unchecked")
    private List<Object> getLiveEntities(String path, String label) {
        try {
            Object parsed = objectMapper.readValue(apisixClient.controlGet(path), Object.class);
            if (parsed instanceof List<?> list) {
                return (List<Object>) list;
            }
            return List.of();
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse live " + label, e);
        }
    }

    public String prometheusQuery(String query) {
        return prometheusClient.query(query);
    }

    // startTime=null → last hour, startTime=0 → from the oldest data in Prometheus TSDB
    public String prometheusRangeQuery(String query, Long startTime, String step) {
        long now = System.currentTimeMillis() / 1000;
        long resolvedStart;
        if (startTime == null) {
            resolvedStart = now - 3600;
        } else if (startTime == 0) {
            resolvedStart = prometheusClient.getTsdbMinTime();
        } else {
            resolvedStart = startTime;
        }
        String resolvedStep = (step != null) ? step : "60";
        return prometheusClient.rangeQuery(query, resolvedStart, now, resolvedStep);
    }

    // health of the Prometheus server. The metrics below come from the APISIX exporter, which
    // stays reachable whether or not Prometheus is running - so it cannot answer this question.
    public boolean isPrometheusHealthy() {
        return prometheusClient.isHealthy();
    }

    // raw text/plain scrape - passed through unchanged for the frontend to display
    public String getPrometheusRaw() {
        return apisixClient.metricsGet("/apisix/prometheus/metrics");
    }

    public MetricsDto getPrometheusMetrics() {
        String raw = apisixClient.metricsGet("/apisix/prometheus/metrics");
        return parseMetrics(raw);
    }

    // extracts the handful of metrics the dashboard actually needs from the raw Prometheus text format
    private MetricsDto parseMetrics(String raw) {
        long totalRequests = parseSimpleGauge(raw, "apisix_http_requests_total");
        Map<String, Long> connections = parseLabelledGauge(raw, "apisix_nginx_http_current_connections", "state");
        String version = parseLabelValue(raw, "apisix_node_info", "version");
        String hostname = parseLabelValue(raw, "apisix_node_info", "hostname");
        return new MetricsDto(totalRequests, connections, version, hostname);
    }

    // matches a bare gauge line: "metric_name 123.0"
    // truncates the decimal part since all relevant APISIX counters are integers
    private long parseSimpleGauge(String raw, String metricName) {
        Pattern p = Pattern.compile("^" + Pattern.quote(metricName) + "\\s+(\\S+)$", Pattern.MULTILINE);
        Matcher m = p.matcher(raw);
        if (m.find()) {
            try { return Long.parseLong(m.group(1).split("\\.")[0]); } catch (NumberFormatException ignored) {}
        }
        return 0;
    }

    // matches labelled gauge lines: "metric_name{..., labelKey="value", ...} 42"
    private Map<String, Long> parseLabelledGauge(String raw, String metricName, String labelKey) {
        Map<String, Long> result = new HashMap<>();
        Pattern p = Pattern.compile(
                Pattern.quote(metricName) + "\\{[^}]*" + Pattern.quote(labelKey) + "=\"([^\"]+)\"[^}]*\\}\\s+(\\S+)",
                Pattern.MULTILINE
        );
        Matcher m = p.matcher(raw);
        while (m.find()) {
            try { result.put(m.group(1), Long.parseLong(m.group(2).split("\\.")[0])); } catch (NumberFormatException ignored) {}
        }
        return result;
    }

    // extracts a single label value from any line for that metric (e.g. version string from apisix_node_info)
    private String parseLabelValue(String raw, String metricName, String labelKey) {
        Pattern p = Pattern.compile(
                Pattern.quote(metricName) + "\\{[^}]*" + Pattern.quote(labelKey) + "=\"([^\"]+)\"",
                Pattern.MULTILINE
        );
        Matcher m = p.matcher(raw);
        return m.find() ? m.group(1) : null;
    }
}
