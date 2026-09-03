package wearefrank.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import wearefrank.backend.dto.LogKind;
import wearefrank.backend.dto.RouteSeriesDto;
import wearefrank.backend.dto.RouteStatsDto;
import wearefrank.backend.dto.RouteStatsResultDto;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.BiConsumer;

/**
 * Per-route traffic: counts and latency aggregated by Loki, joined onto the routes APISIX is
 * running. Metric queries only, never log lines, so one route is one row whatever the window
 * holds. Two round trips - no single LogQL expression counts and averages at once.
 *
 * Loki rather than Prometheus because APISIX's prometheus plugin is off in production; where
 * it is on, PromQL answers this far more cheaply.
 */
@Service
public class RouteStatsService {

    private static final Logger log = LoggerFactory.getLogger(RouteStatsService.class);

    private static final long DEFAULT_WINDOW_SECONDS = 3600L;
    private static final long NANOS_PER_SECOND = 1_000_000_000L;
    /**
     * An answer is reused for half a bucket, so it is never more than half a bar stale.
     * Not a flat 30s: that matched the dashboard's tick and missed on every refresh.
     */
    private static final long CACHE_TTL_BUCKET_FRACTION = 2L;
    private static final long MIN_CACHE_TTL_MILLIS = 10_000L;
    private static final long MAX_CACHE_TTL_MILLIS = 120_000L;
    /**
     * How long a closed window can still gain lines - loki-logger batches for 60s before
     * pushing. Mirrors {@code rangeCanChange} on the front end.
     */
    private static final long SETTLED_AFTER_MILLIS = 5 * 60_000L;
    /** A settled window cannot answer differently however often it is asked, so it is held longer. */
    private static final long SETTLED_CACHE_TTL_MILLIS = 30 * 60_000L;
    /** One entry per distinct window; a handful is plenty. */
    private static final int CACHE_MAX_ENTRIES = 32;
    private static final long NANOS_PER_MILLI = 1_000_000L;

    /** Bucket widths to choose between, coarsest last. Round numbers so the axis reads plainly. */
    private static final long[] STEP_LADDER =
            {5, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 43200, 86400};
    /**
     * Enough buckets that an hour-long outage shows up in a week, few enough to fit the panel.
     * A week lands on hourly buckets.
     */
    private static final int TARGET_BUCKETS = 200;

    private final LokiClient lokiClient;
    private final ApisixClient apisixClient;
    private final LokiScope scope;
    private final ObjectMapper objectMapper;
    private final Map<String, Cached> cache = new ConcurrentHashMap<>();

    public RouteStatsService(LokiClient lokiClient, ApisixClient apisixClient, LokiScope scope,
                             ObjectMapper objectMapper) {
        this.lokiClient = lokiClient;
        this.apisixClient = apisixClient;
        this.scope = scope;
        this.objectMapper = objectMapper;
    }

    private record Cached(RouteStatsResultDto result, long expiresAtMillis) {}

    /**
     * The table.
     *
     * @param windowSeconds how far back from the anchor. Null is an hour, 0 the retention
     *                      window - the same spelling {@code /logs/page} takes.
     * @param anchor        nanosecond instant the window ends at, or null for now.
     * @param search        case-insensitive line filter.
     */
    public RouteStatsResultDto routeStats(Long windowSeconds, String anchor, String search) {
        long window = resolveWindow(windowSeconds);
        Long anchorNanos = parseAnchor(anchor);

        // A relative window keys without its "now", so two requests seconds apart share an
        // answer. An absolute one carries its anchor and keys separately.
        String key = window + "|" + (anchorNanos == null ? "" : anchorNanos) + "|" + (search == null ? "" : search);
        long nowMillis = System.currentTimeMillis();
        Cached hit = cache.get(key);
        if (hit != null && hit.expiresAtMillis() > nowMillis) {
            return hit.result();
        }

        RouteStatsResultDto result = build(window, anchorNanos, search);
        evictIfFull(nowMillis);
        cache.put(key, new Cached(result, nowMillis + cacheTtlMillis(window, anchorNanos, nowMillis)));
        return result;
    }

    /** Half a bucket, floored and capped - or far longer once the window has settled. */
    long cacheTtlMillis(long window, Long anchorNanos, long nowMillis) {
        if (anchorNanos != null && anchorNanos / NANOS_PER_MILLI < nowMillis - SETTLED_AFTER_MILLIS) {
            return SETTLED_CACHE_TTL_MILLIS;
        }
        long halfBucket = resolveStep(window) * 1000 / CACHE_TTL_BUCKET_FRACTION;
        return Math.min(MAX_CACHE_TTL_MILLIS, Math.max(MIN_CACHE_TTL_MILLIS, halfBucket));
    }

    /**
     * Makes room, expired entries first, then the one closest to expiring - settled windows
     * are held long enough that a run of zooms could leave nothing expired.
     */
    private void evictIfFull(long nowMillis) {
        if (cache.size() < CACHE_MAX_ENTRIES) return;
        cache.entrySet().removeIf(e -> e.getValue().expiresAtMillis() <= nowMillis);
        while (cache.size() >= CACHE_MAX_ENTRIES) {
            Map.Entry<String, Cached> soonest = cache.entrySet().stream()
                    .min(Comparator.comparingLong(e -> e.getValue().expiresAtMillis()))
                    .orElse(null);
            if (soonest == null) return;
            cache.remove(soonest.getKey());
        }
    }

    private RouteStatsResultDto build(long window, Long anchorNanos, String search) {
        long step = resolveStep(window);
        // Rounded up to whole buckets: a part-bucket is drawn full-width and reads as a drop
        // in traffic that never happened.
        int buckets = (int) Math.ceil(window / (double) step);
        long covered = buckets * step;

        long endSec = anchorNanos == null ? System.currentTimeMillis() / 1000 : anchorNanos / NANOS_PER_SECOND;
        // Snapped down to a step multiple, where Loki puts its evaluation points whatever
        // start it is handed. An unaligned grid over-counts the oldest bucket and drops the
        // newest; the cost is that the bucket in progress goes undrawn.
        long alignedEnd = (endSec / step) * step;
        // One step in from the window's edge, since each point counts the step behind it.
        long firstBucket = alignedEnd - covered + step;
        List<Long> bucketTimes = new ArrayList<>(buckets);
        for (int i = 0; i < buckets; i++) {
            bucketTimes.add(firstBucket + (long) i * step);
        }

        String pipeline = scope.pipeline(LogKind.AUDIT, null, search);
        String countQuery = countQuery(pipeline, step);
        String latencyQuery = latencyQuery(pipeline, covered);

        Map<String, Row> rows = new LinkedHashMap<>();
        boolean routesUnavailable = !addConfiguredRoutes(rows);
        List<RouteSeriesDto> series = readSeries(
                lokiClient.metricRangeQuery(countQuery, firstBucket * NANOS_PER_SECOND,
                        alignedEnd * NANOS_PER_SECOND, step),
                rows, firstBucket, step, buckets);
        // Same aligned instant and span as the counts, so both columns describe the same
        // traffic - up to one bucket off the log table's window.
        addLatency(rows, lokiClient.instantQuery(latencyQuery, alignedEnd * NANOS_PER_SECOND));

        List<RouteStatsDto> routes = rows.values().stream()
                .map(Row::toDto)
                // Busiest first, then by id so the silent routes keep a stable order.
                .sorted(Comparator.comparingLong(RouteStatsDto::total).reversed()
                        .thenComparing(r -> r.routeId() == null ? "" : r.routeId()))
                .toList();

        return new RouteStatsResultDto(routes, bucketTimes, step, series, covered,
                countQuery, latencyQuery, routesUnavailable);
    }

    /** The finest width keeping the count under {@link #TARGET_BUCKETS}, or the coarsest there is. */
    long resolveStep(long windowSeconds) {
        for (long step : STEP_LADDER) {
            if (windowSeconds <= step * TARGET_BUCKETS) {
                return step;
            }
        }
        return STEP_LADDER[STEP_LADDER.length - 1];
    }

    /**
     * Turns Loki's matrix into one zero-filled series per route and status, folding the totals
     * in on the way. Reindexed by rounding, since Loki sends no sample for an empty bucket.
     */
    private List<RouteSeriesDto> readSeries(String body, Map<String, Row> rows, long firstBucket, long step, int buckets) {
        List<RouteSeriesDto> series = new ArrayList<>();
        try {
            JsonNode result = objectMapper.readTree(body).path("data").path("result");
            for (JsonNode node : result) {
                String routeId = label(node.path("metric"), "route_id");
                String status = label(node.path("metric"), "status");
                Row row = rows.computeIfAbsent(routeId, Row::new);
                // Only if the config gave none - the control API has the current name, the
                // log whatever the route was called at the time.
                if (row.routeName == null) {
                    row.routeName = text(node.path("metric"), "route_name");
                }

                long[] counts = new long[buckets];
                long total = 0;
                for (JsonNode value : node.path("values")) {
                    if (!value.isArray() || value.size() < 2) continue;
                    double parsed;
                    try {
                        parsed = Double.parseDouble(value.get(1).asText());
                    } catch (NumberFormatException e) {
                        continue;
                    }
                    if (Double.isNaN(parsed)) continue;
                    int slot = (int) Math.round((value.get(0).asDouble() - firstBucket) / (double) step);
                    if (slot < 0 || slot >= buckets) continue;
                    long count = Math.round(parsed);
                    counts[slot] += count;
                    total += count;
                }
                row.add(status, total);

                List<Long> boxed = new ArrayList<>(buckets);
                for (long count : counts) {
                    boxed.add(count);
                }
                series.add(new RouteSeriesDto(routeId, status, List.copyOf(boxed)));
            }
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse Loki route series response: " + e.getMessage(), e);
        }
        return series;
    }

    /**
     * One request in, grouped by route and status code, counted per bucket. The range selector
     * is the step, so the buckets tile rather than overlap and summing them gives the total.
     *
     * The json parser gets explicit expressions - a bare {@code | json} would label every key
     * of the nested record. Series come back at routes x codes, so a gateway with hundreds of
     * routes could push past Loki's max_query_series.
     */
    String countQuery(String pipeline, long step) {
        return "sum by (route_id, route_name, status) (count_over_time("
                + pipeline
                + " | json route_id=\"audit.route_id\", route_name=\"route_name\", status=\"response.status\""
                + " [" + step + "s]))";
    }

    /**
     * Mean upstream time per route, in seconds - the caller scales it. Empty and "-" mean
     * APISIX answered it itself and are dropped rather than counted as zero; label_format
     * keeps the first of several upstreams, and {@code __error__=""} catches the rest.
     */
    String latencyQuery(String pipeline, long window) {
        return "avg_over_time("
                + pipeline
                + " | json route_id=\"audit.route_id\", latency=\"response.upstream_latency_ms\""
                + " | latency != \"\" | latency != \"-\""
                + " | label_format latency=`{{ regexReplaceAllLiteral \",.*\" .latency \"\" }}`"
                + " | unwrap latency | __error__=\"\""
                + " [" + window + "s]) by (route_id)";
    }

    /**
     * Seeds a row per configured route, so a route nobody has called still shows up at zero.
     *
     * @return false when the control API is unreachable, which costs the Live column and the
     *         silent routes but not the counts.
     */
    private boolean addConfiguredRoutes(Map<String, Row> rows) {
        try {
            for (JsonNode route : fetchRoutes()) {
                String id = text(route, "id");
                if (id == null) continue;
                Row row = rows.computeIfAbsent(id, Row::new);
                row.configured = true;
                row.uri = text(route, "uri");
                row.routeName = text(route, "name");
                // APISIX defaults status to 1, so a route that does not carry one is enabled.
                row.live = route.path("status").isMissingNode() || route.path("status").asInt(1) == 1;
            }
            return true;
        } catch (RuntimeException e) {
            log.warn("Route stats: APISIX control API unavailable, showing Loki counts only: {}", e.getMessage());
            return false;
        }
    }

    /** The control API answers with [{key, value}, ...]; older ones with the objects bare. */
    private List<JsonNode> fetchRoutes() {
        List<JsonNode> routes = new ArrayList<>();
        try {
            JsonNode parsed = objectMapper.readTree(apisixClient.controlGet("/v1/routes"));
            for (JsonNode node : parsed) {
                JsonNode value = node.path("value");
                routes.add(value.isObject() ? value : node);
            }
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse live routes: " + e.getMessage(), e);
        }
        return routes;
    }

    private void addLatency(Map<String, Row> rows, String body) {
        forEachSample(body, (metric, value) ->
                // Seconds out of nginx, milliseconds in the column. Rounded to a tenth.
                rows.computeIfAbsent(label(metric, "route_id"), Row::new).avgLatencyMs =
                        Math.round(value * 1000 * 10.0) / 10.0);
    }

    /** Walks an instant query's vector result: one label set and one number per series. */
    private void forEachSample(String body, BiConsumer<JsonNode, Double> consumer) {
        try {
            JsonNode result = objectMapper.readTree(body).path("data").path("result");
            for (JsonNode series : result) {
                JsonNode value = series.path("value");
                if (!value.isArray() || value.size() < 2) continue;
                double parsed;
                try {
                    parsed = Double.parseDouble(value.get(1).asText());
                } catch (NumberFormatException e) {
                    continue;
                }
                // Loki answers NaN for an aggregation with nothing under it; not a measurement.
                if (Double.isNaN(parsed)) continue;
                consumer.accept(series.path("metric"), parsed);
            }
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse Loki route stats response: " + e.getMessage(), e);
        }
    }

    /** Zero is the retention span, as elsewhere; a negative window is a caller mistake. */
    private long resolveWindow(Long windowSeconds) {
        if (windowSeconds == null) return DEFAULT_WINDOW_SECONDS;
        if (windowSeconds < 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "windowSeconds must not be negative, got: " + windowSeconds);
        }
        return windowSeconds == 0 ? scope.retentionSeconds() : windowSeconds;
    }

    /** Nanoseconds, as a string for the reason given on {@code LogEntryDto.tsNanos}. */
    private Long parseAnchor(String anchor) {
        if (anchor == null || anchor.isBlank()) return null;
        try {
            return Long.parseLong(anchor.trim());
        } catch (NumberFormatException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "anchor must be a nanosecond timestamp, got: " + anchor);
        }
    }

    /** A missing label reads as "", which is the bucket for traffic that matched no route. */
    private static String label(JsonNode metric, String name) {
        String value = metric.path(name).asText("");
        return "-".equals(value) ? "" : value;
    }

    /** As {@code LogsService.text}: nginx writes "-" for a variable that was never set. */
    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        if (value.isMissingNode() || value.isNull()) return null;
        String asText = value.asText();
        return (asText.isEmpty() || "-".equals(asText)) ? null : asText;
    }

    /** One row under construction, before the two queries have both been folded in. */
    private static final class Row {
        private final String routeId;
        private String routeName;
        private String uri;
        private Boolean live;
        private boolean configured;
        private Double avgLatencyMs;
        private long total;
        private long informational;
        private long success;
        private long redirect;
        private long clientError;
        private long serverError;
        private final Map<String, Long> byStatus = new TreeMap<>();

        private Row(String routeId) {
            this.routeId = routeId;
        }

        /** Adds one status code's count, into both the class it belongs to and the breakdown. */
        private void add(String status, long count) {
            total += count;
            byStatus.merge(status, count, Long::sum);
            switch (status.isEmpty() ? ' ' : status.charAt(0)) {
                case '1' -> informational += count;
                case '2' -> success += count;
                case '3' -> redirect += count;
                case '4' -> clientError += count;
                case '5' -> serverError += count;
                // Still counts towards the total, so the classes and the total never disagree.
                default -> { }
            }
        }

        private RouteStatsDto toDto() {
            return new RouteStatsDto(routeId, routeName, uri, live, configured,
                    total, informational, success, redirect, clientError, serverError,
                    percent(serverError), percent(clientError), avgLatencyMs, Map.copyOf(byStatus));
        }

        /** Null rather than 0 when nothing was counted - there is no rate without traffic. */
        private Double percent(long part) {
            return total == 0 ? null : Math.round(part * 1000.0 / total) / 10.0;
        }
    }
}
