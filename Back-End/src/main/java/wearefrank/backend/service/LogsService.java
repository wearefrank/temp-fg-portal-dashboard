package wearefrank.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import wearefrank.backend.dto.LogCountDto;
import wearefrank.backend.dto.LogEntryDto;
import wearefrank.backend.dto.LogField;
import wearefrank.backend.dto.LogFieldDto;
import wearefrank.backend.dto.LogFieldType;
import wearefrank.backend.dto.LogFields;
import wearefrank.backend.dto.LogKind;
import wearefrank.backend.dto.LogPageDto;
import wearefrank.backend.dto.LogSearchField;
import wearefrank.backend.dto.LogSort;
import wearefrank.backend.dto.MessageVolumeDto;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Reads logs from Loki, either raw or flattened into rows for the dashboard table.
 *
 * The gateway writes two kinds of line into separate streams, so every entry point takes a
 * {@link LogKind} to say which one to read.
 */
@Service
public class LogsService {

    private static final int DEFAULT_LIMIT = 100;
    // Loki's own cap is 5000; staying under it keeps a mistyped limit from pulling a week
    // of traffic into the browser.
    private static final int MAX_LIMIT = 1000;
    /** Default comparison window for {@link #messageVolume}. */
    private static final long WEEK_SECONDS = 7 * 24 * 3600L;
    private static final long NANOS_PER_SECOND = 1_000_000_000L;
    /**
     * Loki refuses a query asking for more than this. A page is cut from one over-fetch,
     * so this is also the deepest any page number can reach.
     */
    private static final int MAX_FETCH = 5000;
    private static final int DEFAULT_PAGE_SIZE = 25;

    private final LokiClient lokiClient;
    private final ObjectMapper objectMapper;
    private final LokiScope scope;

    public LogsService(LokiClient lokiClient, ObjectMapper objectMapper, LokiScope scope) {
        this.lokiClient = lokiClient;
        this.objectMapper = objectMapper;
        this.scope = scope;
    }

    // raw passthrough: startTime=null -> last hour, startTime=0 -> the whole retention window
    public String logRangeQuery(String type, String query, String search, Long startTime,
                                String endCursor, Integer limit, String direction) {
        long now = System.currentTimeMillis() / 1000;
        String resolvedDirection = "forward".equals(direction) ? "forward" : "backward";
        return lokiClient.queryRange(
                buildPipeline(resolveKind(type), query, search),
                resolveStart(startTime, now) * NANOS_PER_SECOND,
                resolveEndNanos(endCursor, now),
                resolveLimit(limit), resolvedDirection);
    }

    public List<LogEntryDto> getRecentLogs(String type, String query, String search, Long startTime,
                                           String endCursor, Integer limit) {
        String body = logRangeQuery(type, query, search, startTime, endCursor, limit, "backward");
        return parseStreams(body, resolveLimit(limit));
    }

    /** The columns a table of this kind should draw, in order - see {@link LogFields}. */
    public List<LogFieldDto> describeFields(String type) {
        return LogFields.describe(resolveKind(type));
    }

    /**
     * Which stream the caller means. An unknown kind is a 400 rather than a fall back to
     * the audit log, where a typo would look like the error log is simply empty.
     */
    private LogKind resolveKind(String type) {
        LogKind kind = LogKind.fromParam(type);
        if (kind == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "type must be one of audit, error - got: " + type);
        }
        return kind;
    }

    /**
     * Upper bound of the query window, in nanoseconds.
     *
     * The cursor is a string because a nanosecond timestamp is bigger than the 2^53 a JSON
     * number survives; rounded to the microsecond, pages start overlapping. Loki treats
     * `end` as exclusive, so passing back the previous page's oldest line does not repeat it.
     */
    private long resolveEndNanos(String endCursor, long now) {
        if (endCursor == null || endCursor.isBlank()) {
            return now * NANOS_PER_SECOND;
        }
        try {
            return Long.parseLong(endCursor.trim());
        } catch (NumberFormatException e) {
            // 400, not the handler's blanket 502 - otherwise a bad cursor reads like Loki is down.
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "endCursor must be a nanosecond timestamp, got: " + endCursor);
        }
    }

    /**
     * How many lines match, counted by Loki over the whole window. Counting the returned
     * page instead would only ever report the limit back.
     */
    public LogCountDto countLogs(String type, String query, String search, String searchField, Long startTime) {
        return countLogs(resolveKind(type), query, search, searchField, startTime, null);
    }

    LogCountDto countLogs(LogKind kind, String query, String search, String searchField,
                          Long startTime, Long anchorNanos) {
        long now = System.currentTimeMillis() / 1000;
        // Counted as of the anchor, so the total a pager was drawn from stays put while
        // the user clicks through it.
        long end = anchorNanos != null ? anchorNanos / NANOS_PER_SECOND : now;
        long start = resolveStart(startTime, now);
        return countBetween(kind, query, search, searchField, start, end, anchorNanos);
    }

    /**
     * The count over an explicit span. count_over_time takes a range plus an evaluation
     * point, not two absolute ends, so the span is (end - start) seconds evaluated at end.
     *
     * @param evalNanos where to evaluate, or null for now. Must agree with {@code endSec},
     *                  or the counted span is not the one asked for.
     */
    private LogCountDto countBetween(LogKind kind, String query, String search, String searchField,
                                     long startSec, long endSec, Long evalNanos) {
        String column = searchColumn(search, searchField);
        String pipeline = buildPipeline(kind, query, search, column);
        if (column != null) {
            return countColumn(pipeline, search, column, startSec, endSec, evalNanos);
        }
        String logql = "sum(count_over_time(" + pipeline + "[" + (endSec - startSec) + "s]))";
        String body = lokiClient.instantQuery(logql, evalNanos);
        try {
            JsonNode result = objectMapper.readTree(body).path("data").path("result");
            // An empty vector means nothing matched, so zero - what a fresh Loki answers.
            long count = result.isEmpty() ? 0L : (long) result.get(0).path("value").get(1).asDouble();
            return new LogCountDto(count, logql, endSec - startSec);
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse Loki count response: " + e.getMessage(), e);
        }
    }

    /**
     * The count when the search names a column. Loki matches whole lines, so the lines come
     * back and are counted here - capped at the fetch budget, reported as depthCapped.
     */
    private LogCountDto countColumn(String pipeline, String search, String column,
                                    long startSec, long endSec, Long evalNanos) {
        long endNanos = evalNanos != null ? evalNanos : endSec * NANOS_PER_SECOND;
        long count = window(pipeline, startSec * NANOS_PER_SECOND, endNanos, MAX_FETCH).stream()
                .filter(entry -> LogSearchField.matches(entry, column, search))
                .count();
        return new LogCountDto(count, pipeline, endSec - startSec);
    }

    /** The column the search is confined to, or null when it runs over the whole line. */
    private static String searchColumn(String search, String searchField) {
        String column = LogSearchField.resolve(searchField);
        return (search == null || search.isBlank()) ? null : column;
    }

    /** The newest {@code budget} lines of a window - see {@link #MAX_FETCH}. */
    private List<LogEntryDto> window(String pipeline, long startNanos, long endNanos, int budget) {
        return parseStreams(lokiClient.queryRange(pipeline, startNanos, endNanos, budget, "backward"), budget);
    }

    /**
     * This window against the one before it - a week against the previous week, by default.
     *
     * The spans are adjacent and disjoint: (now-w, now] and (now-2w, now-w]. The previous
     * count is evaluated at the boundary because count_over_time has no offset; asking for
     * [2w] and subtracting would count a boundary line into both halves.
     *
     * Two round trips rather than one range query with a 1w step, whose buckets align to
     * Loki's step boundaries instead of to "the last seven days".
     */
    public MessageVolumeDto messageVolume(String type, String query, String search, Long windowSeconds) {
        LogKind kind = resolveKind(type);
        long window = resolveVolumeWindow(windowSeconds);
        long now = System.currentTimeMillis() / 1000;
        long boundary = now - window;

        LogCountDto currentCount = countBetween(kind, query, search, null, boundary, now, null);
        LogCountDto previousCount = countBetween(kind, query, search, null,
                boundary - window, boundary, boundary * NANOS_PER_SECOND);

        long current = currentCount.count();
        long previous = previousCount.count();
        // Null when there is nothing to compare against. A previous window of zero is also
        // what a window older than retention returns, so the UI must tell that apart from
        // a real drop to nothing.
        Double changePercent = previous == 0
                ? null
                : Math.round((current - previous) * 1000.0 / previous) / 10.0;

        return new MessageVolumeDto(current, previous, changePercent, window, currentCount.query());
    }

    /**
     * Window length for the comparison, a week by default. Non-positive is a caller mistake:
     * a window of zero has no previous window to sit beside.
     */
    private long resolveVolumeWindow(Long windowSeconds) {
        if (windowSeconds == null) return WEEK_SECONDS;
        if (windowSeconds <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "windowSeconds must be positive, got: " + windowSeconds);
        }
        return windowSeconds;
    }

    /**
     * One numbered page.
     *
     * Loki has no offset - it accepts the parameter and ignores it - so a page is cut from
     * a single over-fetch of page*pageSize lines, newest-first. That is one round trip and
     * real random access, at the price of a depth ceiling reported as depthCapped.
     *
     * {@code sort} names the column and {@code direction} the order ("forward" is ascending).
     * Time is Loki's own ordering; any other column is sorted here over the whole reachable
     * window - see {@code sortedPage}. {@code searchField} narrows the search to one column,
     * which Loki also cannot do - see {@code columnSearchPage}.
     */
    public LogPageDto getPage(String type, String query, String search, String searchField,
                              Long windowSeconds, String anchor, Integer page, Integer pageSize,
                              String direction, String sort) {
        LogKind kind = resolveKind(type);
        long now = System.currentTimeMillis() / 1000;
        long anchorNanos = resolveEndNanos(anchor, now);
        // Both ends hang off the anchor, so a page asked for ten minutes into a session
        // covers the same span as the first one.
        long window = (windowSeconds == null) ? 3600L
                : (windowSeconds == 0 ? scope.retentionSeconds() : windowSeconds);
        long startSec = (anchorNanos / NANOS_PER_SECOND) - window;

        int size = resolvePageSize(pageSize);
        int reachablePages = Math.max(1, MAX_FETCH / size);
        int budget = reachablePages * size;

        // Clamped rather than 404'd: a page number goes stale simply because the search narrowed.
        int requested = (page == null || page < 1) ? 1 : page;

        // "forward" is ascending - oldest-first for time, A-Z for a text column.
        String resolvedDirection = "forward".equals(direction) ? "forward" : "backward";
        boolean ascending = "forward".equals(resolvedDirection);
        String resolvedSort = LogSort.resolve(sort);
        String column = searchColumn(search, searchField);

        String pipeline = buildPipeline(kind, query, search, column);
        long startNanos = startSec * NANOS_PER_SECOND;

        if (column != null) {
            return columnSearchPage(pipeline, startNanos, anchorNanos, requested, size, budget,
                    resolvedSort, ascending, resolvedDirection, search, column);
        }

        // Evaluated 1ns before the anchor on purpose: count_over_time covers (T-range, T]
        // while query_range covers [start, end), so a line sitting on the boundary would be
        // counted but not returned - a last page holding one row more than the total allows.
        long total = countLogs(kind, query, search, null, startSec, anchorNanos - 1).count();
        int totalPages = total == 0 ? 1 : (int) Math.min(reachablePages, (total + size - 1) / size);
        boolean depthCapped = total > (long) budget;

        int resolvedPage = Math.min(requested, totalPages);

        List<LogEntryDto> entries = LogSort.isTime(resolvedSort)
                ? timePage(pipeline, startNanos, anchorNanos, resolvedPage, size, resolvedDirection)
                : sortedPage(pipeline, startNanos, anchorNanos, resolvedPage, size,
                        budget, resolvedSort, ascending);

        return new LogPageDto(entries, resolvedPage, size, total, totalPages,
                String.valueOf(anchorNanos), depthCapped, resolvedDirection, resolvedSort, null);
    }

    /**
     * A page whose search names one column. Loki matches lines, not columns, so the whole
     * reachable window comes back and both the matching and the count happen here - making
     * even page 1 a full-depth fetch.
     *
     * Counting Loki's line-filter matches instead would number the pages off a superset and
     * offer pages that turn out to be empty. A window that fills the budget reports
     * depthCapped: the matches are the newest ones, not all of them.
     */
    private LogPageDto columnSearchPage(String pipeline, long startNanos, long anchorNanos,
                                        int requested, int size, int budget, String sort,
                                        boolean ascending, String direction, String search,
                                        String column) {
        List<LogEntryDto> fetched = window(pipeline, startNanos, anchorNanos, budget);
        List<LogEntryDto> matched = new ArrayList<>(fetched.stream()
                .filter(entry -> LogSearchField.matches(entry, column, search))
                .toList());

        long total = matched.size();
        int totalPages = total == 0 ? 1 : (int) ((total + size - 1) / size);
        int resolvedPage = Math.min(requested, totalPages);

        matched.sort(LogSort.comparator(sort, ascending));

        return new LogPageDto(slice(matched, resolvedPage, size), resolvedPage, size, total, totalPages,
                String.valueOf(anchorNanos), fetched.size() >= budget, direction, sort, column);
    }

    /**
     * A page in time order, which Loki resolves itself: it fills from whichever end
     * `direction` names, so the over-fetch only has to reach the page.
     */
    private List<LogEntryDto> timePage(String pipeline, long startNanos, long anchorNanos,
                                       int page, int size, String direction) {
        int needed = page * size;
        String body = lokiClient.queryRange(pipeline, startNanos, anchorNanos, needed, direction);

        // parseStreams normalises to newest-first, so a forward page has to be flipped back:
        // the slice must come off the same end Loki filled from.
        List<LogEntryDto> overFetched = new ArrayList<>(parseStreams(body, needed));
        if ("forward".equals(direction)) {
            Collections.reverse(overFetched);
        }
        return slice(overFetched, page, size);
    }

    /**
     * A page ordered by a column Loki knows nothing about, so the whole reachable window is
     * fetched, sorted here, then sliced. Sorting only the page would order twenty-five rows
     * and pass it off as the window: page 2 of "slowest first" could beat page 1.
     *
     * The cost is a full-budget fetch on every page, and an ordering that covers what paging
     * can reach rather than the whole window - which is what depthCapped already says.
     */
    private List<LogEntryDto> sortedPage(String pipeline, long startNanos, long anchorNanos,
                                         int page, int size, int budget, String sort, boolean ascending) {
        // Always backward: the budget is a depth from the anchor, whichever way the column sorts.
        List<LogEntryDto> reachable = new ArrayList<>(window(pipeline, startNanos, anchorNanos, budget));
        reachable.sort(LogSort.comparator(sort, ascending));
        return slice(reachable, page, size);
    }

    private List<LogEntryDto> slice(List<LogEntryDto> entries, int page, int size) {
        return entries.stream()
                .skip((long) (page - 1) * size)
                .limit(size)
                .toList();
    }

    private int resolvePageSize(Integer pageSize) {
        if (pageSize == null || pageSize < 1) return DEFAULT_PAGE_SIZE;
        // A page bigger than the fetch budget would make every page number unreachable.
        return Math.min(pageSize, MAX_FETCH);
    }

    private long resolveStart(Long startTime, long now) {
        if (startTime == null) return now - 3600;
        if (startTime == 0) return now - scope.retentionSeconds();
        return startTime;
    }

    /** The LogQL for a kind, pinned and line-filtered - see {@link LokiScope#pipeline}. */
    String buildPipeline(LogKind kind, String query, String search) {
        return buildPipeline(kind, query, search, null);
    }

    /**
     * The same, for a search aimed at one column - null means the whole line.
     *
     * The line filter stays on where the column's text is part of the line, since it is then
     * a superset of the matches and only saves work - see {@link LogSearchField#prefiltersLine}.
     * Otherwise Loki gets an unfiltered pipeline and every match is decided here.
     */
    String buildPipeline(LogKind kind, String query, String search, String column) {
        return scope.pipeline(kind, query, LogSearchField.prefiltersLine(column) ? search : null);
    }

    private int resolveLimit(Integer limit) {
        if (limit == null || limit < 1) return DEFAULT_LIMIT;
        return Math.min(limit, MAX_LIMIT);
    }

    // One [timestampNanos, line] pair, kept numeric so the sort below does not use the
    // formatted timestamp, plus the namespace off the stream - the line itself has none.
    private record RawLine(long tsNanos, String line, String namespace) {}

    private List<LogEntryDto> parseStreams(String body, int limit) {
        List<RawLine> lines = new ArrayList<>();
        try {
            JsonNode result = objectMapper.readTree(body).path("data").path("result");
            for (JsonNode stream : result) {
                // Once per stream: every line in a Loki stream shares its label set. Read
                // under the configured label, so a collector that relabels still resolves;
                // null when the stream carries none.
                String namespace = text(stream.path("stream"), scope.namespaceLabel());
                for (JsonNode value : stream.path("values")) {
                    try {
                        lines.add(new RawLine(Long.parseLong(value.path(0).asText()),
                                value.path(1).asText(), namespace));
                    } catch (NumberFormatException ignored) {
                        // a value pair without a usable timestamp is not a log line
                    }
                }
            }
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse Loki response: " + e.getMessage(), e);
        }
        // Loki orders within a stream, not across them, so multiple label sets come back
        // interleaved. The table wants newest first overall.
        lines.sort(Comparator.comparingLong(RawLine::tsNanos).reversed());
        return lines.stream().limit(limit).map(this::toEntry).toList();
    }

    /**
     * Which shape a line is, decided by the line and not by the stream it came from: a JSON
     * object is an access record, anything else is read as an nginx error line.
     *
     * APISIX writes the odd non-JSON line into the access stream, and a shared Loki can hold
     * either kind under either label, so the ?type= is not always right. The parse was
     * happening anyway, and this way neither table can render a line against wrong fields.
     */
    private LogEntryDto toEntry(RawLine raw) {
        String timestamp = Instant.ofEpochSecond(raw.tsNanos() / 1_000_000_000L, raw.tsNanos() % 1_000_000_000L)
                .toString();
        String tsNanos = String.valueOf(raw.tsNanos());

        JsonNode json;
        try {
            json = objectMapper.readTree(raw.line());
        } catch (Exception e) {
            json = null;
        }
        return (json == null || !json.isObject())
                ? errorEntry(raw.namespace(), timestamp, tsNanos, raw.line())
                : auditEntry(raw.namespace(), timestamp, tsNanos, raw.line(), json);
    }

    /**
     * The loki-logger plugin's access record, flattened out of its nesting. Which key holds
     * what lives in {@link LogFields}, so one declaration serves both the mapping and the
     * columns the dashboard draws.
     */
    private LogEntryDto auditEntry(String namespace, String timestamp, String tsNanos, String line, JsonNode json) {
        Map<String, Object> fields = new HashMap<>();
        for (LogField field : LogFields.ALL) {
            if (!field.fills(LogKind.AUDIT)) continue;
            for (String path : field.auditPaths()) {
                String value = textAtPath(json, path);
                // First path that resolves wins - a later one is a fallback, not an override.
                if (value != null) {
                    fields.put(field.id(), coerce(field.type(), value));
                    break;
                }
            }
        }
        return entry(LogKind.AUDIT, namespace, timestamp, tsNanos, line, fields);
    }

    /** An nginx error line, or - when it matches nothing - its text kept as the message. */
    private LogEntryDto errorEntry(String namespace, String timestamp, String tsNanos, String line) {
        Map<String, String> parsed = NginxErrorLine.parse(line).asMap();
        Map<String, Object> fields = new HashMap<>();
        for (LogField field : LogFields.ALL) {
            if (!field.fills(LogKind.ERROR)) continue;
            String value = parsed.get(field.errorSource());
            if (value != null) {
                fields.put(field.id(), coerce(field.type(), value));
            }
        }
        return entry(LogKind.ERROR, namespace, timestamp, tsNanos, line, fields);
    }

    /**
     * Binds the mapped fields onto the record by name, so a {@link LogField}'s id has to be
     * a component of {@link LogEntryDto} - {@code LogFieldsTest} enforces it. Anything the
     * line did not carry is absent from the map and lands as null.
     */
    private LogEntryDto entry(LogKind kind, String namespace, String timestamp, String tsNanos,
                              String line, Map<String, Object> fields) {
        // The five that describe the line rather than come out of it - see LogFields.STRUCTURAL.
        fields.put("type", kind.param());
        fields.put("namespace", namespace);
        fields.put("timestamp", timestamp);
        fields.put("tsNanos", tsNanos);
        fields.put("raw", line);
        return objectMapper.convertValue(fields, LogEntryDto.class);
    }

    /**
     * Turns the raw string into what the field means. The plugin interpolates every nginx
     * variable as a string, so "$status" arrives as "200".
     */
    private Object coerce(LogFieldType type, String value) {
        return switch (type) {
            case STATUS -> integer(value);
            case DURATION -> millis(value);
            case LEVEL -> value.toUpperCase(Locale.ROOT);
            default -> value;
        };
    }

    private Integer integer(String value) {
        try {
            return Integer.valueOf(value.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /**
     * nginx reports response times in seconds - hence the x1000. A request that hit more
     * than one upstream carries them comma-separated; the first served the response.
     */
    private Double millis(String value) {
        try {
            return Double.parseDouble(value.split(",")[0].trim()) * 1000;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** {@link #text} down a dot path, for the fields the log format nests. */
    private String textAtPath(JsonNode root, String path) {
        JsonNode node = root;
        String rest = path;
        for (int dot = rest.indexOf('.'); dot >= 0; dot = rest.indexOf('.')) {
            node = node.path(rest.substring(0, dot));
            rest = rest.substring(dot + 1);
        }
        return text(node, rest);
    }

    private String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        if (value.isMissingNode() || value.isNull()) return null;
        String asText = value.asText();
        // nginx writes "-" for a variable that was never set on this request.
        return (asText.isEmpty() || "-".equals(asText)) ? null : asText;
    }
}
