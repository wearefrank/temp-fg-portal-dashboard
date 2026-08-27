package wearefrank.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
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
 * The logs equivalent of {@link MetricsService}'s Prometheus half: resolves the query
 * window, then either hands the Loki response straight back or flattens it into rows the
 * dashboard table can render.
 *
 * The gateway writes two kinds of line and keeps them in separate Loki streams, so every
 * entry point takes a {@link LogKind} to say which one to read - see {@code toEntry} for
 * how each is taken apart, and {@code LogKind} for why they are separate at all.
 */
@Service
public class LogsService {

    private static final int DEFAULT_LIMIT = 100;
    // Loki's own default cap is 5000; staying well under it keeps a mistyped limit from
    // pulling a week of traffic into the browser.
    private static final int MAX_LIMIT = 1000;
    /** Fallback retention when LOKI_RETENTION_HOURS is unset: 336h, two weeks. */
    private static final long DEFAULT_RETENTION_HOURS = 336L;
    /** Default comparison window for {@link #messageVolume}. */
    private static final long WEEK_SECONDS = 7 * 24 * 3600L;
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
    private final List<String> namespaces;
    private final String namespaceLabel;
    private final long retentionSeconds;

    public LogsService(LokiClient lokiClient, ObjectMapper objectMapper,
                       // Every query this service builds gets pinned to these namespaces, the
                       // caller's own selector included - see buildPipeline. A comma-separated
                       // list scopes the console to several at once and the tables show them
                       // merged. Empty means no pinning, which is what a single-tenant Loki
                       // wants.
                       @Value("${LOKI_NAMESPACE:}") String namespace,
                       // Which label carries it. "namespace" is what the gateway's
                       // loki-logger pushes (config/apisix.yaml) and what a Kubernetes
                       // service-discovery scrape produces; some collectors relabel it to
                       // kubernetes_namespace instead.
                       @Value("${LOKI_NAMESPACE_LABEL:namespace}") String namespaceLabel,
                       // What startTime=0 resolves to, in hours - Loki has no equivalent of
                       // Prometheus' TSDB min-time endpoint, so the console has to be told
                       // how far back asking for "everything" is worth reaching. Match it to
                       // retention_period on the Loki being queried.
                       //
                       // The two failure directions are not symmetric. Set longer than the
                       // real retention, a query merely widens over lines already deleted,
                       // which costs nothing and returns the same rows. Set shorter, "all"
                       // silently stops short of data Loki still holds - so when the real
                       // value is unknown, guess high.
                       @Value("${LOKI_RETENTION_HOURS:" + DEFAULT_RETENTION_HOURS + "}") long retentionHours) {
        this.lokiClient = lokiClient;
        this.objectMapper = objectMapper;
        this.namespaces = parseNamespaces(namespace);
        this.namespaceLabel = (namespaceLabel == null || namespaceLabel.isBlank())
                ? "namespace" : namespaceLabel.trim();
        // A non-positive setting would make startTime=0 resolve to an empty or inverted
        // window - "all" returning nothing at all - so it falls back rather than obeying.
        this.retentionSeconds = (retentionHours > 0 ? retentionHours : DEFAULT_RETENTION_HOURS) * 3600L;
    }

    /**
     * Splits LOKI_NAMESPACE into the set to scope to.
     *
     * Blanks are dropped rather than kept, so a trailing comma or a value assembled by a
     * template that left a slot empty narrows to what is actually named instead of pinning
     * to a namespace called "". Duplicates are dropped too, in first-seen order - repeating
     * one in the alternation changes nothing about what matches and only makes the query
     * harder to read in a log.
     *
     * An empty result is the unpinned case, which is also what an unset variable gives.
     */
    private static List<String> parseNamespaces(String raw) {
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        List<String> parsed = new ArrayList<>();
        for (String part : raw.split(",")) {
            String trimmed = part.trim();
            if (!trimmed.isEmpty() && !parsed.contains(trimmed)) {
                parsed.add(trimmed);
            }
        }
        return List.copyOf(parsed);
    }

    // raw passthrough, same contract as prometheusRangeQuery:
    // startTime=null -> last hour, startTime=0 -> the whole retention window
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

    /**
     * The columns a table of this kind should draw, in order - see {@link LogFields}.
     *
     * Answers about the shape of a line rather than about any lines, so it touches Loki not
     * at all; the kind still goes through {@link #resolveKind} so a typo is the same 400
     * here as everywhere else.
     */
    public List<LogFieldDto> describeFields(String type) {
        return LogFields.describe(resolveKind(type));
    }

    /**
     * Which of the two streams the caller means. Anything that is not one of the kinds is a
     * 400 rather than a silent fall back to the access log - a typo answering with audit
     * lines reads like the error log is empty, which is the wrong thing to be reassured by.
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
    public LogCountDto countLogs(String type, String query, String search, Long startTime) {
        return countLogs(resolveKind(type), query, search, startTime, null);
    }

    LogCountDto countLogs(LogKind kind, String query, String search, Long startTime, Long anchorNanos) {
        long now = System.currentTimeMillis() / 1000;
        // Counting as of the anchor rather than now, so the total a pager was drawn from
        // stays put while the user clicks through it.
        long end = anchorNanos != null ? anchorNanos / NANOS_PER_SECOND : now;
        long start = resolveStart(startTime, now);
        return countBetween(kind, query, search, start, end, anchorNanos);
    }

    /**
     * The count itself, over an explicit span.
     *
     * count_over_time needs a range and an evaluation point rather than two absolute ends,
     * so the span is expressed as a range of (end - start) seconds evaluated at end. Split
     * out of countLogs because the week-over-week panel needs a window that does not end at
     * now, which the startTime-shaped signature above cannot express.
     *
     * @param evalNanos where to evaluate, or null for now. Must agree with {@code endSec}:
     *                  a range measured from one instant and evaluated at another counts a
     *                  different span than the one asked for.
     */
    private LogCountDto countBetween(LogKind kind, String query, String search,
                                     long startSec, long endSec, Long evalNanos) {
        String logql = "sum(count_over_time(" + buildPipeline(kind, query, search) + "[" + (endSec - startSec) + "s]))";
        String body = lokiClient.instantQuery(logql, evalNanos);
        try {
            JsonNode result = objectMapper.readTree(body).path("data").path("result");
            // An empty vector means nothing matched, which is a count of zero rather than
            // an error - a fresh Loki with no traffic yet answers exactly this way.
            long count = result.isEmpty() ? 0L : (long) result.get(0).path("value").get(1).asDouble();
            return new LogCountDto(count, logql, endSec - startSec);
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse Loki count response: " + e.getMessage(), e);
        }
    }

    /**
     * This window against the one before it - a week against the previous week, by default.
     *
     * The two spans are adjacent and disjoint: the current one covers (now-w, now] and the
     * previous one (now-2w, now-w]. That is done by evaluating the previous count at the
     * boundary rather than at now, because count_over_time has no offset of its own - asking
     * for [2w] and subtracting would count the boundary line into both halves.
     *
     * Two round trips rather than one range query with a 1w step: a range query would hand
     * back buckets aligned to Loki's own step boundaries, not to "the last seven days", and
     * the panel would silently compare two spans of unequal length.
     */
    public MessageVolumeDto messageVolume(String type, String query, String search, Long windowSeconds) {
        LogKind kind = resolveKind(type);
        long window = resolveVolumeWindow(windowSeconds);
        long now = System.currentTimeMillis() / 1000;
        long boundary = now - window;

        LogCountDto currentCount = countBetween(kind, query, search, boundary, now, null);
        LogCountDto previousCount = countBetween(kind, query, search,
                boundary - window, boundary, boundary * NANOS_PER_SECOND);

        long current = currentCount.count();
        long previous = previousCount.count();
        // Null rather than a number when there is nothing to compare against. A previous
        // window of zero is not a -100%/+infinity story, and it is exactly what a window
        // older than Loki's retention returns, so the UI has to be able to tell the two
        // apart from a real drop to nothing.
        Double changePercent = previous == 0
                ? null
                : Math.round((current - previous) * 1000.0 / previous) / 10.0;

        return new MessageVolumeDto(current, previous, changePercent, window, currentCount.query());
    }

    /**
     * Window length for the comparison. A week by default, which is what the dashboard
     * asks for; anything non-positive is a caller mistake rather than a request for "all",
     * since a window of zero has no previous window to sit beside.
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
     * Loki has no offset: it was measured accepting the parameter and ignoring it, which is
     * worse than rejecting it, since an offset pager would look like it worked while serving
     * page 1 over and over. So a page is cut from a single over-fetch of page*pageSize lines
     * taken newest-first, which costs one round trip and gives real random access - at the
     * price of a depth ceiling, reported as depthCapped rather than hidden.
     *
     * {@code sort} names the column to order by and {@code direction} which way: "forward"
     * is ascending, anything else descending. Time is Loki's own ordering and stays on the
     * over-fetch above; any other column is ordered here, over the whole reachable window
     * rather than over the page - see {@code sortedPage}.
     */
    public LogPageDto getPage(String type, String query, String search, Long windowSeconds,
                              String anchor, Integer page, Integer pageSize, String direction,
                              String sort) {
        LogKind kind = resolveKind(type);
        long now = System.currentTimeMillis() / 1000;
        long anchorNanos = resolveEndNanos(anchor, now);
        // Both ends of the window hang off the anchor, so a page asked for ten minutes into
        // a session covers exactly the same span as the first one. Taking the window as a
        // duration rather than an absolute start is what makes that possible - the caller
        // never has to know what "now" was when paging began.
        long window = (windowSeconds == null) ? 3600L
                : (windowSeconds == 0 ? retentionSeconds : windowSeconds);
        long startSec = (anchorNanos / NANOS_PER_SECOND) - window;

        int size = resolvePageSize(pageSize);
        int reachablePages = Math.max(1, MAX_FETCH / size);

        // Evaluated one nanosecond before the anchor, on purpose. count_over_time covers
        // (T-range, T] while query_range covers [start, end) - opposite ends included. Left
        // alone they disagree by one whenever a line sits exactly on a boundary, which shows
        // up as a last page holding one row more than the total allows for. Shifting the
        // evaluation point by 1ns makes the counted span exactly [start, anchor).
        long total = countLogs(kind, query, search, startSec, anchorNanos - 1).count();
        int totalPages = total == 0 ? 1 : (int) Math.min(reachablePages, (total + size - 1) / size);
        boolean depthCapped = total > (long) reachablePages * size;

        // Clamped rather than 404'd: a page number can go stale simply because the search
        // narrowed, and dropping the user on an error for that is worse than the last page.
        int requested = (page == null || page < 1) ? 1 : page;
        int resolvedPage = Math.min(requested, totalPages);

        // "forward" is ascending - oldest-first for time, A-Z for a text column.
        String resolvedDirection = "forward".equals(direction) ? "forward" : "backward";
        boolean ascending = "forward".equals(resolvedDirection);
        String resolvedSort = LogSort.resolve(sort);

        String pipeline = buildPipeline(kind, query, search);
        long startNanos = startSec * NANOS_PER_SECOND;

        List<LogEntryDto> entries = LogSort.isTime(resolvedSort)
                ? timePage(pipeline, startNanos, anchorNanos, resolvedPage, size, resolvedDirection)
                : sortedPage(pipeline, startNanos, anchorNanos, resolvedPage, size,
                        reachablePages * size, resolvedSort, ascending);

        return new LogPageDto(entries, resolvedPage, size, total, totalPages,
                String.valueOf(anchorNanos), depthCapped, resolvedDirection, resolvedSort);
    }

    /**
     * A page in time order, which Loki resolves itself: it fills the response from whichever
     * end `direction` names, so the over-fetch only has to be deep enough to reach the page.
     */
    private List<LogEntryDto> timePage(String pipeline, long startNanos, long anchorNanos,
                                       int page, int size, String direction) {
        int needed = page * size;
        String body = lokiClient.queryRange(pipeline, startNanos, anchorNanos, needed, direction);

        // parseStreams normalises to newest-first; for a forward page the caller asked for
        // the opposite, and the slice below has to come off the same end Loki filled from.
        List<LogEntryDto> overFetched = new ArrayList<>(parseStreams(body, needed));
        if ("forward".equals(direction)) {
            Collections.reverse(overFetched);
        }
        return slice(overFetched, page, size);
    }

    /**
     * A page ordered by a column Loki knows nothing about.
     *
     * The whole reachable window is fetched and ordered here, then sliced - which is the only
     * honest way to do it. Ordering the page instead would sort twenty-five rows and present
     * the result as though it had sorted the window: page 2 of "slowest first" would then
     * hold requests faster than everything on page 1.
     *
     * What it costs is that the over-fetch is the full depth budget on every page rather than
     * page*pageSize, so a sorted page beyond the first is one larger Loki query. And the
     * ordering covers what paging can reach, not what the window holds - past that ceiling
     * depthCapped is already true, and it now means the sort is over the newest lines rather
     * than all of them.
     */
    private List<LogEntryDto> sortedPage(String pipeline, long startNanos, long anchorNanos,
                                         int page, int size, int budget, String sort, boolean ascending) {
        // Always backward: the budget is a depth from the anchor, so the reachable window is
        // the newest lines in it whichever way the column is being ordered.
        String body = lokiClient.queryRange(pipeline, startNanos, anchorNanos, budget, "backward");
        List<LogEntryDto> window = new ArrayList<>(parseStreams(body, budget));
        window.sort(LogSort.comparator(sort, ascending));
        return slice(window, page, size);
    }

    private List<LogEntryDto> slice(List<LogEntryDto> entries, int page, int size) {
        return entries.stream()
                .skip((long) (page - 1) * size)
                .limit(size)
                .toList();
    }

    private int resolvePageSize(Integer pageSize) {
        if (pageSize == null || pageSize < 1) return DEFAULT_PAGE_SIZE;
        // A page bigger than the whole fetch budget would make every page number unreachable.
        return Math.min(pageSize, MAX_FETCH);
    }

    private long resolveStart(Long startTime, long now) {
        if (startTime == null) return now - 3600;
        if (startTime == 0) return now - retentionSeconds;
        return startTime;
    }

    /**
     * Builds the LogQL: a stream selector, plus a case-insensitive line filter when the
     * user typed something in the search box.
     *
     * The kind decides the selector only when the caller supplied none. A caller-supplied
     * ?query= replaces it outright, kind included - the two tables differ by which stream
     * they select, and a query that names its own stream has already made that choice.
     *
     * The search term is escaped twice on purpose. It is interpolated into a regular
     * expression inside a quoted LogQL string, so it has to survive both: regex-escaped
     * first so that a "." or "(" in the box matches literally instead of being read as a
     * pattern, then string-escaped so a quote or backslash cannot close the literal early
     * and graft arbitrary LogQL onto the query.
     */
    String buildPipeline(LogKind kind, String query, String search) {
        String selector = (query != null && !query.isBlank()) ? query.trim() : kind.selector();
        selector = forceNamespace(selector);
        if (search == null || search.isBlank()) {
            return selector;
        }
        return selector + " |~ \"(?i)" + logqlString(regexEscape(search.trim())) + "\"";
    }

    /**
     * Pins the selector to the configured namespaces by adding the label matcher to it.
     * Matchers inside a selector are ANDed, so this can only ever narrow what comes back -
     * a caller asking for a namespace outside the set gets an empty result rather than that
     * namespace's lines.
     *
     * Done here rather than by prefixing DEFAULT_SELECTOR, because ?query= lets the caller
     * replace the selector outright; a default the caller can drop is not a filter.
     *
     * No-op when LOKI_NAMESPACE is empty, which is the single-tenant case.
     */
    private String forceNamespace(String selector) {
        if (namespaces.isEmpty()) {
            return selector;
        }
        int[] braces = selectorBraces(selector);
        int open = braces[0];
        int close = braces[1];
        String existing = selector.substring(open + 1, close).trim();
        String forced = namespaceLabel + namespaceMatcher();
        return selector.substring(0, open + 1)
                + (existing.isEmpty() ? forced : forced + ", " + existing)
                + selector.substring(close);
    }

    /**
     * The matcher's operator and value, for a label already written out by the caller.
     *
     * One namespace stays an exact {@code ="ns"} rather than a one-branch alternation: it is
     * the cheaper matcher for Loki to answer and the plainer one to read in a query log, and
     * it keeps every existing single-namespace deployment's queries byte-identical.
     *
     * Several become {@code =~"a|b"}. Each value is regex-escaped on its own and the bars are
     * added after, so a namespace holding a metacharacter matches literally instead of
     * widening the set - escaping the joined string would escape the bars too and leave one
     * literal namespace called "a|b". Loki anchors a label regex as {@code ^(?:re)$}, so the
     * alternation binds across the whole value without grouping it here.
     */
    private String namespaceMatcher() {
        if (namespaces.size() == 1) {
            return "=\"" + logqlString(namespaces.get(0)) + "\"";
        }
        StringBuilder alternation = new StringBuilder();
        for (String ns : namespaces) {
            if (alternation.length() > 0) {
                alternation.append('|');
            }
            alternation.append(regexEscape(ns));
        }
        return "=~\"" + logqlString(alternation.toString()) + "\"";
    }

    /**
     * Positions of the stream selector's braces, skipping any that sit inside a string
     * literal - {@code {app_name="apisix"} |= "{"} has three braces and only two of them
     * delimit the selector.
     *
     * A caller query holding a second selector is rejected instead of being half-pinned:
     * this only ever edits one of them, so a two-selector query would come back with the
     * namespace enforced on the first and wide open on the second.
     */
    private int[] selectorBraces(String selector) {
        int open = -1;
        int close = -1;
        char quote = 0;
        for (int i = 0; i < selector.length(); i++) {
            char c = selector.charAt(i);
            if (quote != 0) {
                // Backticks are LogQL's raw strings: no escapes inside them, so a backslash
                // there is just a backslash and cannot hide the closing backtick.
                if (c == '\\' && quote == '"') {
                    i++;
                } else if (c == quote) {
                    quote = 0;
                }
            } else if (c == '"' || c == '`') {
                quote = c;
            } else if (c == '{') {
                if (open >= 0) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                            "query must hold a single stream selector while LOKI_NAMESPACE is set");
                }
                open = i;
            } else if (c == '}' && open >= 0 && close < 0) {
                close = i;
            }
        }
        if (open < 0 || close < 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "query must contain a stream selector, e.g. {app_name=\"apisix\"}");
        }
        return new int[]{open, close};
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
    // numeric timestamp rather than its formatted form - plus the namespace off the stream
    // it came out of, which the line itself does not carry
    private record RawLine(long tsNanos, String line, String namespace) {}

    private List<LogEntryDto> parseStreams(String body, int limit) {
        List<RawLine> lines = new ArrayList<>();
        try {
            JsonNode result = objectMapper.readTree(body).path("data").path("result");
            for (JsonNode stream : result) {
                // Read once per stream rather than per line: every line in a Loki stream
                // shares its label set by definition. Read under the configured label so a
                // collector that relabels to kubernetes_namespace still resolves; null when
                // the stream carries none, which is the whole answer for a Loki that is not
                // labelled by namespace at all.
                String namespace = text(stream.path("stream"), namespaceLabel);
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
        // Loki orders entries within a stream, not across them, so anything matching more
        // than one label set comes back interleaved. The table wants newest first overall.
        lines.sort(Comparator.comparingLong(RawLine::tsNanos).reversed());
        return lines.stream().limit(limit).map(this::toEntry).toList();
    }

    /**
     * Which of the two shapes a line is, decided by the line rather than by the stream it
     * came out of: a JSON object is one of the plugin's access records, anything else is
     * read as an nginx error line.
     *
     * Content rather than the ?type= the caller asked for, because the two are not always
     * in agreement. APISIX writes the odd non-JSON line into the access stream, and a Loki
     * shared with something else can hold either kind under either label. Sniffing costs a
     * parse that was happening anyway and means neither table can be made to render a line
     * against the wrong set of fields.
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
     * The loki-logger plugin's access record, flattened out of its nesting.
     *
     * Which key holds what is not written here but in {@link LogFields}, so that the same
     * declaration serves the mapping and the columns the dashboard draws.
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
     * Binds the mapped fields onto the record by name, which is why a {@link LogField}'s id
     * has to be a component of {@link LogEntryDto} - {@code LogFieldsTest} enforces it.
     * Anything the line did not carry is simply absent from the map and lands as null.
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
     * variable as a string, so "$status" arrives as "200" and has to be read back out.
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
