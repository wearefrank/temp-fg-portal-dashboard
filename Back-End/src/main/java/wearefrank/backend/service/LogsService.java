package wearefrank.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import wearefrank.backend.dto.LogCountDto;
import wearefrank.backend.dto.LogEntryDto;
import wearefrank.backend.dto.LogPageDto;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * The logs equivalent of {@link MetricsService}'s Prometheus half: resolves the query
 * window, then either hands the Loki response straight back or flattens it into rows the
 * dashboard table can render.
 */
@Service
public class LogsService {

    /**
     * Every line the gateway writes carries app_name="apisix" (loki-logger.log_labels in
     * config/apisix.yaml), so this selects the access log and nothing else that may be
     * sharing the Loki instance.
     */
    public static final String DEFAULT_SELECTOR = "{app_name=\"apisix\"}";

    private static final int DEFAULT_LIMIT = 100;
    // Loki's own default cap is 5000; staying well under it keeps a mistyped limit from
    // pulling a week of traffic into the browser.
    private static final int MAX_LIMIT = 1000;
    // What startTime=0 resolves to. Loki has no equivalent of Prometheus' TSDB min-time
    // endpoint, and config/loki.yaml drops anything older than this anyway.
    private static final long RETENTION_SECONDS = 7 * 24 * 3600L;
    private static final long NANOS_PER_SECOND = 1_000_000_000L;
    /**
     * Loki refuses a query asking for more than this (max_entries_limit_per_query, and its
     * default is what the compose stack runs). A numbered page is cut from one over-fetch of
     * page*pageSize lines, so this is also the deepest any page number can reach.
     */
    private static final int MAX_FETCH = 5000;
    private static final int DEFAULT_PAGE_SIZE = 25;

    private final LokiClient lokiClient;
    private final ObjectMapper objectMapper;

    public LogsService(LokiClient lokiClient, ObjectMapper objectMapper) {
        this.lokiClient = lokiClient;
        this.objectMapper = objectMapper;
    }

    // raw passthrough, same contract as prometheusRangeQuery:
    // startTime=null -> last hour, startTime=0 -> the whole retention window
    public String logRangeQuery(String query, String search, Long startTime, String endCursor,
                                Integer limit, String direction) {
        long now = System.currentTimeMillis() / 1000;
        String resolvedDirection = "forward".equals(direction) ? "forward" : "backward";
        return lokiClient.queryRange(
                buildPipeline(query, search),
                resolveStart(startTime, now) * NANOS_PER_SECOND,
                resolveEndNanos(endCursor, now),
                resolveLimit(limit), resolvedDirection);
    }

    public List<LogEntryDto> getRecentLogs(String query, String search, Long startTime,
                                           String endCursor, Integer limit) {
        String body = logRangeQuery(query, search, startTime, endCursor, limit, "backward");
        return parseStreams(body, resolveLimit(limit));
    }

    /**
     * Upper bound of the query window, in nanoseconds.
     *
     * The cursor arrives as a string rather than a number because a nanosecond timestamp is
     * around 1.8e18, well past the 2^53 a JSON number survives intact - parsed as one it
     * comes back rounded to the microsecond and pages start overlapping.
     *
     * Loki treats `end` as exclusive, so handing back the oldest line of the previous page
     * returns the next one down rather than repeating it.
     */
    private long resolveEndNanos(String endCursor, long now) {
        if (endCursor == null || endCursor.isBlank()) {
            return now * NANOS_PER_SECOND;
        }
        try {
            return Long.parseLong(endCursor.trim());
        } catch (NumberFormatException e) {
            // A malformed cursor is the caller's mistake, so say 400. Left as a plain
            // RuntimeException it would come back as the handler's blanket 502 and read
            // like Loki was down.
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "endCursor must be a nanosecond timestamp, got: " + endCursor);
        }
    }

    /**
     * How many lines match, counted by Loki over the whole window rather than by counting
     * the page that came back. Without this the UI can only ever report its own limit.
     */
    public LogCountDto countLogs(String query, String search, Long startTime) {
        return countLogs(query, search, startTime, null);
    }

    LogCountDto countLogs(String query, String search, Long startTime, Long anchorNanos) {
        long now = System.currentTimeMillis() / 1000;
        // Counting as of the anchor rather than now, so the total a pager was drawn from
        // stays put while the user clicks through it.
        long end = anchorNanos != null ? anchorNanos / NANOS_PER_SECOND : now;
        long start = resolveStart(startTime, now);
        // count_over_time needs a range, and it has to match the window the table shows or
        // the total describes a different slice of time than the rows underneath it.
        String logql = "sum(count_over_time(" + buildPipeline(query, search) + "[" + (end - start) + "s]))";
        String body = lokiClient.instantQuery(logql, anchorNanos);
        try {
            JsonNode result = objectMapper.readTree(body).path("data").path("result");
            // An empty vector means nothing matched, which is a count of zero rather than
            // an error - a fresh Loki with no traffic yet answers exactly this way.
            long count = result.isEmpty() ? 0L : (long) result.get(0).path("value").get(1).asDouble();
            return new LogCountDto(count, logql);
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse Loki count response: " + e.getMessage(), e);
        }
    }

    /**
     * One numbered page.
     *
     * Loki has no offset: it was measured accepting the parameter and ignoring it, which is
     * worse than rejecting it, since an offset pager would look like it worked while serving
     * page 1 over and over. So a page is cut from a single over-fetch of page*pageSize lines
     * taken newest-first, which costs one round trip and gives real random access - at the
     * price of a depth ceiling, reported as depthCapped rather than hidden.
     */
    public LogPageDto getPage(String query, String search, Long windowSeconds, String anchor,
                              Integer page, Integer pageSize, String direction) {
        long now = System.currentTimeMillis() / 1000;
        long anchorNanos = resolveEndNanos(anchor, now);
        // Both ends of the window hang off the anchor, so a page asked for ten minutes into
        // a session covers exactly the same span as the first one. Taking the window as a
        // duration rather than an absolute start is what makes that possible - the caller
        // never has to know what "now" was when paging began.
        long window = (windowSeconds == null) ? 3600L
                : (windowSeconds == 0 ? RETENTION_SECONDS : windowSeconds);
        long startSec = (anchorNanos / NANOS_PER_SECOND) - window;

        int size = resolvePageSize(pageSize);
        int reachablePages = Math.max(1, MAX_FETCH / size);

        // Evaluated one nanosecond before the anchor, on purpose. count_over_time covers
        // (T-range, T] while query_range covers [start, end) - opposite ends included. Left
        // alone they disagree by one whenever a line sits exactly on a boundary, which shows
        // up as a last page holding one row more than the total allows for. Shifting the
        // evaluation point by 1ns makes the counted span exactly [start, anchor).
        long total = countLogs(query, search, startSec, anchorNanos - 1).count();
        int totalPages = total == 0 ? 1 : (int) Math.min(reachablePages, (total + size - 1) / size);
        boolean depthCapped = total > (long) reachablePages * size;

        // Clamped rather than 404'd: a page number can go stale simply because the search
        // narrowed, and dropping the user on an error for that is worse than the last page.
        int requested = (page == null || page < 1) ? 1 : page;
        int resolvedPage = Math.min(requested, totalPages);

        // Sorting by time is Loki's `direction`, not a client-side reorder: "forward" walks
        // the window oldest-first. Sorting the twenty-five rows already in the browser would
        // only reorder the page, which is a different and much less useful thing.
        String resolvedDirection = "forward".equals(direction) ? "forward" : "backward";

        int needed = resolvedPage * size;
        String body = lokiClient.queryRange(
                buildPipeline(query, search),
                startSec * NANOS_PER_SECOND,
                anchorNanos, needed, resolvedDirection);

        // parseStreams normalises to newest-first; for a forward page the caller asked for
        // the opposite, and the slice below has to come off the same end Loki filled from.
        List<LogEntryDto> overFetched = new ArrayList<>(parseStreams(body, needed));
        if ("forward".equals(resolvedDirection)) {
            java.util.Collections.reverse(overFetched);
        }
        List<LogEntryDto> entries = overFetched.stream()
                .skip((long) (resolvedPage - 1) * size)
                .limit(size)
                .toList();

        return new LogPageDto(entries, resolvedPage, size, total, totalPages,
                String.valueOf(anchorNanos), depthCapped, resolvedDirection);
    }

    private int resolvePageSize(Integer pageSize) {
        if (pageSize == null || pageSize < 1) return DEFAULT_PAGE_SIZE;
        // A page bigger than the whole fetch budget would make every page number unreachable.
        return Math.min(pageSize, MAX_FETCH);
    }

    private long resolveStart(Long startTime, long now) {
        if (startTime == null) return now - 3600;
        if (startTime == 0) return now - RETENTION_SECONDS;
        return startTime;
    }

    /**
     * Builds the LogQL: a stream selector, plus a case-insensitive line filter when the
     * user typed something in the search box.
     *
     * The search term is escaped twice on purpose. It is interpolated into a regular
     * expression inside a quoted LogQL string, so it has to survive both: regex-escaped
     * first so that a "." or "(" in the box matches literally instead of being read as a
     * pattern, then string-escaped so a quote or backslash cannot close the literal early
     * and graft arbitrary LogQL onto the query.
     */
    String buildPipeline(String query, String search) {
        String selector = (query != null && !query.isBlank()) ? query.trim() : DEFAULT_SELECTOR;
        if (search == null || search.isBlank()) {
            return selector;
        }
        return selector + " |~ \"(?i)" + logqlString(regexEscape(search.trim())) + "\"";
    }

    // Loki runs Go's RE2, which has no \Q...\E, so the metacharacters are escaped by hand.
    private String regexEscape(String raw) {
        StringBuilder escaped = new StringBuilder(raw.length() * 2);
        for (char c : raw.toCharArray()) {
            if ("\\.+*?()|[]{}^$".indexOf(c) >= 0) {
                escaped.append('\\');
            }
            escaped.append(c);
        }
        return escaped.toString();
    }

    // Escapes for a double-quoted LogQL string literal. Backslashes first: doing it after
    // the quotes would also escape the backslashes this method just added.
    private String logqlString(String raw) {
        return raw.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private int resolveLimit(Integer limit) {
        if (limit == null || limit < 1) return DEFAULT_LIMIT;
        return Math.min(limit, MAX_LIMIT);
    }

    // one [timestampNanos, line] pair, kept as a pair so the sort below can use the
    // numeric timestamp rather than its formatted form
    private record RawLine(long tsNanos, String line) {}

    private List<LogEntryDto> parseStreams(String body, int limit) {
        List<RawLine> lines = new ArrayList<>();
        try {
            JsonNode result = objectMapper.readTree(body).path("data").path("result");
            for (JsonNode stream : result) {
                for (JsonNode value : stream.path("values")) {
                    try {
                        lines.add(new RawLine(Long.parseLong(value.path(0).asText()), value.path(1).asText()));
                    } catch (NumberFormatException ignored) {
                        // a value pair without a usable timestamp is not a log line
                    }
                }
            }
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse Loki response: " + e.getMessage(), e);
        }
        // Loki orders entries within a stream, not across them, so anything matching more
        // than one label set comes back interleaved. The table wants newest first overall.
        lines.sort(Comparator.comparingLong(RawLine::tsNanos).reversed());
        return lines.stream().limit(limit).map(this::toEntry).toList();
    }

    private LogEntryDto toEntry(RawLine raw) {
        String timestamp = Instant.ofEpochSecond(raw.tsNanos() / 1_000_000_000L, raw.tsNanos() % 1_000_000_000L)
                .toString();

        JsonNode json;
        try {
            json = objectMapper.readTree(raw.line());
        } catch (Exception e) {
            json = null;
        }
        // Not everything in the stream is one of the plugin's records - an error log, or a
        // line from something else pushing to the same Loki. Keep it readable through raw
        // instead of dropping it or guessing at fields that are not there.
        if (json == null || !json.isObject()) {
            return new LogEntryDto(timestamp, String.valueOf(raw.tsNanos()), null, null, null,
                    null, null, null, null, null, null, null, raw.line());
        }

        JsonNode request = json.path("request");
        JsonNode response = json.path("response");
        return new LogEntryDto(
                timestamp,
                String.valueOf(raw.tsNanos()),
                text(json, "level"),
                text(json, "route_name"),
                text(json.path("audit"), "route_id"),
                text(request, "request_method"),
                text(request, "request_path"),
                text(request, "request_host"),
                integer(response, "status"),
                latencyMs(text(response, "upstream_latency_ms")),
                text(json, "source_addr"),
                text(response.path("upstream_endpoint"), "address"),
                raw.line());
    }

    private String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        if (value.isMissingNode() || value.isNull()) return null;
        String asText = value.asText();
        // nginx writes "-" for a variable that was never set on this request.
        return (asText.isEmpty() || "-".equals(asText)) ? null : asText;
    }

    // the plugin interpolates nginx variables as strings, so "$status" arrives as "200"
    private Integer integer(JsonNode node, String field) {
        String asText = text(node, field);
        if (asText == null) return null;
        try {
            return Integer.valueOf(asText.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /**
     * The log_format calls this field upstream_latency_ms, but it holds
     * $upstream_response_time, which nginx reports in seconds - hence the x1000. A request
     * that hit more than one upstream carries them comma-separated; the first is the one
     * that served the response.
     */
    private Double latencyMs(String value) {
        if (value == null) return null;
        String first = value.split(",")[0].trim();
        try {
            return Double.parseDouble(first) * 1000;
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
