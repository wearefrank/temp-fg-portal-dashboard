package wearefrank.backend.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;
import wearefrank.backend.dto.LogEntryDto;
import wearefrank.backend.dto.LogPageDto;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class LogsServiceTest {

    @Mock
    LokiClient lokiClient;

    LogsService logsService;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /**
     * One of the plugin's records, nested the way loki-logger.log_format in
     * config/apisix.yaml describes it - including the nginx variables arriving as strings.
     */
    private static final String ACCESS_LINE = """
            {"level":"INFO","timestamp":"2026-08-25T12:00:00+02:00","route_name":"centric",\
            "source_addr":"172.18.0.4",\
            "request":{"request_method":"GET","request_path":"/anything/x","request_host":"apisix"},\
            "response":{"status":"200","upstream_latency_ms":"0.012",\
            "upstream_endpoint":{"address":"172.18.0.7:8080"}},\
            "audit":{"route_id":"12"}}""";

    // 1700000000s in nanoseconds, which is 2023-11-14T22:13:20Z
    private static final String TS = "1700000000000000000";

    private static String streams(String... streams) {
        return "{\"status\":\"success\",\"data\":{\"resultType\":\"streams\",\"result\":["
                + String.join(",", streams) + "]}}";
    }

    /** One Loki stream from alternating timestamp/line arguments. */
    private static String stream(String... tsAndLine) {
        StringBuilder sb = new StringBuilder("{\"stream\":{\"app_name\":\"apisix\"},\"values\":[");
        for (int i = 0; i < tsAndLine.length; i += 2) {
            if (i > 0) sb.append(",");
            // valueToTree gives the JSON-escaped form, so a line with quotes in it still
            // produces a valid stream. Stringified explicitly - StringBuilder.append would
            // otherwise bind the generic return to its CharSequence overload.
            String encodedLine = MAPPER.valueToTree(tsAndLine[i + 1]).toString();
            sb.append("[\"").append(tsAndLine[i]).append("\",").append(encodedLine).append("]");
        }
        return sb.append("]}").toString();
    }

    private void lokiReturns(String body) {
        when(lokiClient.queryRange(anyString(), anyLong(), anyLong(), anyInt(), anyString())).thenReturn(body);
    }

    @BeforeEach
    void setUp() {
        logsService = new LogsService(lokiClient, new ObjectMapper().findAndRegisterModules());
    }

    @Test
    void getRecentLogs_flattensNestedAccessLogLine() {
        lokiReturns(streams(stream(TS, ACCESS_LINE)));

        List<LogEntryDto> entries = logsService.getRecentLogs(null, null, null, null, null);

        assertThat(entries).hasSize(1);
        LogEntryDto entry = entries.getFirst();
        assertThat(entry.timestamp()).isEqualTo("2023-11-14T22:13:20Z");
        assertThat(entry.level()).isEqualTo("INFO");
        assertThat(entry.routeName()).isEqualTo("centric");
        assertThat(entry.routeId()).isEqualTo("12");
        assertThat(entry.method()).isEqualTo("GET");
        assertThat(entry.path()).isEqualTo("/anything/x");
        assertThat(entry.host()).isEqualTo("apisix");
        assertThat(entry.status()).isEqualTo(200);
        assertThat(entry.source()).isEqualTo("172.18.0.4");
        assertThat(entry.upstream()).isEqualTo("172.18.0.7:8080");
    }

    @Test
    void getRecentLogs_convertsUpstreamResponseTimeFromSecondsToMillis() {
        lokiReturns(streams(stream(TS, ACCESS_LINE)));

        assertThat(logsService.getRecentLogs(null, null, null, null, null).getFirst().latencyMs()).isEqualTo(12.0);
    }

    @Test
    void getRecentLogs_takesFirstHop_whenLatencyListsSeveralUpstreams() {
        String line = ACCESS_LINE.replace("\"upstream_latency_ms\":\"0.012\"",
                                          "\"upstream_latency_ms\":\"0.012, 0.500\"");
        lokiReturns(streams(stream(TS, line)));

        assertThat(logsService.getRecentLogs(null, null, null, null, null).getFirst().latencyMs()).isEqualTo(12.0);
    }

    @Test
    void getRecentLogs_leavesFieldsNull_whenNginxWroteADash() {
        String line = ACCESS_LINE
                .replace("\"upstream_latency_ms\":\"0.012\"", "\"upstream_latency_ms\":\"-\"")
                .replace("\"address\":\"172.18.0.7:8080\"", "\"address\":\"-\"");
        lokiReturns(streams(stream(TS, line)));

        LogEntryDto entry = logsService.getRecentLogs(null, null, null, null, null).getFirst();
        assertThat(entry.latencyMs()).isNull();
        assertThat(entry.upstream()).isNull();
        assertThat(entry.status()).isEqualTo(200);
    }

    @Test
    void getRecentLogs_keepsNonJsonLine_asRaw() {
        lokiReturns(streams(stream(TS, "plain error text")));

        LogEntryDto entry = logsService.getRecentLogs(null, null, null, null, null).getFirst();
        assertThat(entry.raw()).isEqualTo("plain error text");
        assertThat(entry.method()).isNull();
        assertThat(entry.status()).isNull();
        assertThat(entry.timestamp()).isEqualTo("2023-11-14T22:13:20Z");
    }

    @Test
    void getRecentLogs_sortsNewestFirst_acrossStreams() {
        lokiReturns(streams(
                stream("1700000000000000000", "oldest"),
                stream("1700000002000000000", "newest", "1700000001000000000", "middle")));

        assertThat(logsService.getRecentLogs(null, null, null, null, null))
                .extracting(LogEntryDto::raw)
                .containsExactly("newest", "middle", "oldest");
    }

    @Test
    void getRecentLogs_truncatesToLimit_afterSorting() {
        lokiReturns(streams(
                stream("1700000000000000000", "a"),
                stream("1700000001000000000", "b"),
                stream("1700000002000000000", "c")));

        assertThat(logsService.getRecentLogs(null, null, null, null, 2))
                .extracting(LogEntryDto::raw)
                .containsExactly("c", "b");
    }

    /**
     * What the running gateway actually emits: loki-logger writes $status and
     * $upstream_response_time as JSON numbers, not the quoted strings the log_format's
     * "$status" template suggests. Both forms have to parse - a captured line from the
     * compose stack, verbatim.
     */
    @Test
    void getRecentLogs_readsStatusAndLatency_whenEmittedAsJsonNumbers() {
        String line = """
                {"level":"INFO","response":{"upstream_latency_ms":0.001,"status":200,                "upstream_endpoint":{"scheme":"http","address":"172.18.0.7:8080",                "host":"djuma-mock:8080","uri":"/anything/messages/974"}},                "audit":{"route_id":"centric-to-djuma-route"},                "request":{"request_method":"GET","request_path":"/clo/djuma/messages/974",                "request_host":"apisix"},"route_id":"centric-to-djuma-route",                "timestamp":"2026-08-25T09:54:32+00:00","gemeente_code":"0484",                "source_addr":"172.18.0.9","route_name":"centric-to-djuma-route"}""";
        lokiReturns(streams(stream(TS, line)));

        LogEntryDto entry = logsService.getRecentLogs(null, null, null, null, null).getFirst();
        assertThat(entry.status()).isEqualTo(200);
        // 0.001 seconds, so 1ms - not 0.001ms, whatever the field is called.
        assertThat(entry.latencyMs()).isEqualTo(1.0);
        assertThat(entry.routeName()).isEqualTo("centric-to-djuma-route");
        assertThat(entry.routeId()).isEqualTo("centric-to-djuma-route");
        assertThat(entry.method()).isEqualTo("GET");
        assertThat(entry.path()).isEqualTo("/clo/djuma/messages/974");
        assertThat(entry.upstream()).isEqualTo("172.18.0.7:8080");
        assertThat(entry.source()).isEqualTo("172.18.0.9");
    }

    @Test
    void getRecentLogs_returnsEmptyList_whenLokiHasNoMatchingStreams() {
        lokiReturns(streams());

        assertThat(logsService.getRecentLogs(null, null, null, null, null)).isEmpty();
    }

    @Test
    void getRecentLogs_throwsRuntimeException_onUnparseableResponse() {
        lokiReturns("not json");

        assertThatThrownBy(() -> logsService.getRecentLogs(null, null, null, null, null))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Failed to parse Loki response");
    }

    @Test
    void logRangeQuery_fallsBackToDefaultSelector_whenQueryBlank() {
        lokiReturns(streams());

        logsService.logRangeQuery("  ", null, null, null, null, null);

        verify(lokiClient).queryRange(eq(LogsService.DEFAULT_SELECTOR), anyLong(), anyLong(), anyInt(), anyString());
    }

    @Test
    void logRangeQuery_passesGivenSelectorThrough() {
        lokiReturns(streams());

        logsService.logRangeQuery("{namespace=\"local\"}", null, null, null, null, null);

        verify(lokiClient).queryRange(eq("{namespace=\"local\"}"), anyLong(), anyLong(), anyInt(), anyString());
    }

    @Test
    void logRangeQuery_defaultsToLastHour_whenStartTimeNull() {
        lokiReturns(streams());
        long now = System.currentTimeMillis() / 1000;

        logsService.logRangeQuery(null, null, null, null, null, null);

        ArgumentCaptor<Long> start = ArgumentCaptor.forClass(Long.class);
        ArgumentCaptor<Long> end = ArgumentCaptor.forClass(Long.class);
        verify(lokiClient).queryRange(anyString(), start.capture(), end.capture(), anyInt(), anyString());
        // bounds reach LokiClient already converted to nanoseconds
        assertThat(end.getValue() - start.getValue()).isEqualTo(3600L * 1_000_000_000L);
        assertThat(end.getValue()).isBetween(now * 1_000_000_000L, (now + 5) * 1_000_000_000L);
    }

    @Test
    void logRangeQuery_usesRetentionWindow_whenStartTimeZero() {
        lokiReturns(streams());

        logsService.logRangeQuery(null, null, 0L, null, null, null);

        ArgumentCaptor<Long> start = ArgumentCaptor.forClass(Long.class);
        ArgumentCaptor<Long> end = ArgumentCaptor.forClass(Long.class);
        verify(lokiClient).queryRange(anyString(), start.capture(), end.capture(), anyInt(), anyString());
        assertThat(end.getValue() - start.getValue()).isEqualTo(7 * 24 * 3600L * 1_000_000_000L);
    }

    @Test
    void logRangeQuery_honoursExplicitStartTime() {
        lokiReturns(streams());

        logsService.logRangeQuery(null, null, 1700000000L, null, null, null);

        verify(lokiClient).queryRange(anyString(), eq(1700000000L * 1_000_000_000L), anyLong(),
                anyInt(), anyString());
    }

    @Test
    void logRangeQuery_capsLimit() {
        lokiReturns(streams());

        logsService.logRangeQuery(null, null, null, null, 99_999, null);

        verify(lokiClient).queryRange(anyString(), anyLong(), anyLong(), eq(1000), anyString());
    }

    @Test
    void logRangeQuery_fallsBackToDefaultLimit_whenLimitNotPositive() {
        lokiReturns(streams());

        logsService.logRangeQuery(null, null, null, null, 0, null);

        verify(lokiClient).queryRange(anyString(), anyLong(), anyLong(), eq(100), anyString());
    }

    @Test
    void logRangeQuery_fallsBackToBackward_onUnknownDirection() {
        lokiReturns(streams());

        logsService.logRangeQuery(null, null, null, null, null, "sideways");

        verify(lokiClient).queryRange(anyString(), anyLong(), anyLong(), anyInt(), eq("backward"));
    }

    @Test
    void logRangeQuery_passesForwardThrough() {
        lokiReturns(streams());

        logsService.logRangeQuery(null, null, null, null, null, "forward");

        verify(lokiClient).queryRange(anyString(), anyLong(), anyLong(), anyInt(), eq("forward"));
    }

    // --- search pipeline -----------------------------------------------------------

    @Test
    void buildPipeline_returnsSelectorUnchanged_whenNoSearch() {
        assertThat(logsService.buildPipeline(null, null)).isEqualTo(LogsService.DEFAULT_SELECTOR);
        assertThat(logsService.buildPipeline(null, "   ")).isEqualTo(LogsService.DEFAULT_SELECTOR);
    }

    @Test
    void buildPipeline_appendsCaseInsensitiveLineFilter() {
        assertThat(logsService.buildPipeline(null, "timeout"))
                .isEqualTo("{app_name=\"apisix\"} |~ \"(?i)timeout\"");
    }

    @Test
    void buildPipeline_keepsCustomSelector() {
        assertThat(logsService.buildPipeline("{namespace=\"local\"}", "boom"))
                .isEqualTo("{namespace=\"local\"} |~ \"(?i)boom\"");
    }

    /**
     * A path like /clo/djuma/* is an ordinary thing to paste into a search box, and every
     * character in it means something to a regex engine. Escaped, it matches literally.
     */
    @Test
    void buildPipeline_escapesRegexMetacharacters() {
        assertThat(logsService.buildPipeline(null, "/clo/djuma/*"))
                .isEqualTo("{app_name=\"apisix\"} |~ \"(?i)/clo/djuma/\\\\*\"");
        assertThat(logsService.buildPipeline(null, "a.b+c"))
                .isEqualTo("{app_name=\"apisix\"} |~ \"(?i)a\\\\.b\\\\+c\"");
    }

    /**
     * The search term ends up inside a quoted LogQL string. A bare quote would close it
     * early and let the rest of the box be read as query syntax, so it has to come back
     * escaped rather than terminating the literal.
     */
    @Test
    void buildPipeline_escapesQuotes_soSearchCannotBreakOutOfTheLiteral() {
        // Every quote from the search box comes back with a backslash in front of it, so
        // the literal runs to the very end and the "or {job=..}" is matched as text rather
        // than becoming part of the query.
        assertThat(logsService.buildPipeline(null, "\" or {job=\"x\"} #"))
                .isEqualTo("{app_name=\"apisix\"} |~ \"(?i)\\\" or \\\\{job=\\\"x\\\"\\\\} #\"");
    }

    @Test
    void buildPipeline_escapesBackslashesBeforeQuotes() {
        // a lone backslash must not end up escaping the closing quote
        assertThat(logsService.buildPipeline(null, "c:\\temp"))
                .isEqualTo("{app_name=\"apisix\"} |~ \"(?i)c:\\\\\\\\temp\"");
    }

    @Test
    void getRecentLogs_passesTheSearchFilterToLoki() {
        lokiReturns(streams());

        logsService.getRecentLogs(null, "timeout", null, null, null);

        verify(lokiClient).queryRange(eq("{app_name=\"apisix\"} |~ \"(?i)timeout\""),
                anyLong(), anyLong(), anyInt(), anyString());
    }

    // --- count ---------------------------------------------------------------------

    private static String vector(String value) {
        return "{\"status\":\"success\",\"data\":{\"resultType\":\"vector\",\"result\":"
                + "[{\"metric\":{},\"value\":[1700000000,\"" + value + "\"]}]}}";
    }

    @Test
    void countLogs_readsTheScalarOutOfTheVector() {
        when(lokiClient.instantQuery(anyString(), any())).thenReturn(vector("4213"));

        assertThat(logsService.countLogs(null, null, null).count()).isEqualTo(4213L);
    }

    @Test
    void countLogs_returnsZero_whenNothingMatched() {
        // Loki answers an unmatched count with an empty vector, not a zero sample
        when(lokiClient.instantQuery(anyString(), any()))
                .thenReturn("{\"status\":\"success\",\"data\":{\"resultType\":\"vector\",\"result\":[]}}");

        assertThat(logsService.countLogs(null, "nothing-matches-this", null).count()).isZero();
    }

    @Test
    void countLogs_countsOverTheSameWindowTheTableShows() {
        when(lokiClient.instantQuery(anyString(), any())).thenReturn(vector("1"));

        logsService.countLogs(null, null, null);

        ArgumentCaptor<String> logql = ArgumentCaptor.forClass(String.class);
        verify(lokiClient).instantQuery(logql.capture(), any());
        // default window is the last hour, so the range must say 3600s
        assertThat(logql.getValue()).isEqualTo("sum(count_over_time({app_name=\"apisix\"}[3600s]))");
    }

    @Test
    void countLogs_includesTheSearchFilterInTheCount() {
        when(lokiClient.instantQuery(anyString(), any())).thenReturn(vector("7"));

        logsService.countLogs(null, "timeout", null);

        ArgumentCaptor<String> logql = ArgumentCaptor.forClass(String.class);
        verify(lokiClient).instantQuery(logql.capture(), any());
        assertThat(logql.getValue())
                .isEqualTo("sum(count_over_time({app_name=\"apisix\"} |~ \"(?i)timeout\"[3600s]))");
    }

    @Test
    void countLogs_throwsRuntimeException_onUnparseableResponse() {
        when(lokiClient.instantQuery(anyString(), any())).thenReturn("not json");

        assertThatThrownBy(() -> logsService.countLogs(null, null, null))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Failed to parse Loki count response");
    }

    // --- paging cursor -------------------------------------------------------------

    @Test
    void getRecentLogs_exposesTheNanosecondTimestampAsTheCursor() {
        lokiReturns(streams(stream("1787661302684000000", ACCESS_LINE)));

        LogEntryDto entry = logsService.getRecentLogs(null, null, null, null, null).getFirst();

        // exact, and a string - this is what gets handed back as endCursor
        assertThat(entry.tsNanos()).isEqualTo("1787661302684000000");
    }

    @Test
    void getRecentLogs_defaultsTheWindowEndToNow_whenNoCursor() {
        lokiReturns(streams());
        long nowNanos = (System.currentTimeMillis() / 1000) * 1_000_000_000L;

        logsService.getRecentLogs(null, null, null, null, null);

        ArgumentCaptor<Long> end = ArgumentCaptor.forClass(Long.class);
        verify(lokiClient).queryRange(anyString(), anyLong(), end.capture(), anyInt(), anyString());
        assertThat(end.getValue()).isBetween(nowNanos, nowNanos + 5_000_000_000L);
    }

    /**
     * The cursor has to reach Loki digit-for-digit. Rounding it to milliseconds - which is
     * what happens if it is carried as a JSON number anywhere along the way - would re-serve
     * or skip every line sharing that millisecond.
     */
    @Test
    void getRecentLogs_passesTheCursorThroughWithFullNanosecondPrecision() {
        lokiReturns(streams());

        logsService.getRecentLogs(null, null, null, "1787661302684123456", null);

        verify(lokiClient).queryRange(anyString(), anyLong(), eq(1787661302684123456L), anyInt(), anyString());
    }

    @Test
    void getRecentLogs_keepsTheStartOfTheWindow_whenPagingBackwards() {
        lokiReturns(streams());

        logsService.getRecentLogs(null, null, 1700000000L, "1787661302684000000", null);

        // start stays pinned to the range the user picked; only the end moves as you page
        verify(lokiClient).queryRange(anyString(), eq(1700000000L * 1_000_000_000L),
                eq(1787661302684000000L), anyInt(), anyString());
    }

    @Test
    void getRecentLogs_rejectsAMalformedCursorAsBadRequest() {
        assertThatThrownBy(() -> logsService.getRecentLogs(null, null, null, "not-a-timestamp", null))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("400");
    }

    @Test
    void getRecentLogs_treatsABlankCursorAsAbsent() {
        lokiReturns(streams());
        long nowNanos = (System.currentTimeMillis() / 1000) * 1_000_000_000L;

        logsService.getRecentLogs(null, null, null, "   ", null);

        ArgumentCaptor<Long> end = ArgumentCaptor.forClass(Long.class);
        verify(lokiClient).queryRange(anyString(), anyLong(), end.capture(), anyInt(), anyString());
        assertThat(end.getValue()).isBetween(nowNanos, nowNanos + 5_000_000_000L);
    }

    @Test
    void getRecentLogs_appliesSearchAndCursorTogether() {
        lokiReturns(streams());

        logsService.getRecentLogs(null, "timeout", null, "1787661302684000000", null);

        verify(lokiClient).queryRange(eq("{app_name=\"apisix\"} |~ \"(?i)timeout\""),
                anyLong(), eq(1787661302684000000L), anyInt(), anyString());
    }

    // --- numbered pages ------------------------------------------------------------

    /** A stream of n lines, newest first, each carrying its index so pages can be identified. */
    private static String numberedStream(int n) {
        String[] pairs = new String[n * 2];
        for (int i = 0; i < n; i++) {
            pairs[i * 2] = String.valueOf(1_700_000_000_000_000_000L + (long) (n - i) * 1_000_000L);
            pairs[i * 2 + 1] = "line-" + i;
        }
        return streams(stream(pairs));
    }

    private void countReturns(long total) {
        when(lokiClient.instantQuery(anyString(), any())).thenReturn(vector(String.valueOf(total)));
    }

    @Test
    void getPage_returnsTheSliceForThatPage() {
        countReturns(30);
        // page 3 of 10 means fetching 30 newest and keeping the last 10
        lokiReturns(numberedStream(30));

        LogPageDto page = logsService.getPage(null, null, null, null, 3, 10, null);

        assertThat(page.page()).isEqualTo(3);
        assertThat(page.pageSize()).isEqualTo(10);
        assertThat(page.entries()).extracting(LogEntryDto::raw)
                .containsExactly("line-20", "line-21", "line-22", "line-23", "line-24",
                                 "line-25", "line-26", "line-27", "line-28", "line-29");
    }

    @Test
    void getPage_overFetchesExactlyPageTimesPageSize() {
        countReturns(500);
        lokiReturns(numberedStream(40));

        logsService.getPage(null, null, null, null, 4, 10, null);

        // one round trip, asking for everything down to the end of page 4
        verify(lokiClient).queryRange(anyString(), anyLong(), anyLong(), eq(40), eq("backward"));
    }

    @Test
    void getPage_computesTotalPagesFromTheCount() {
        countReturns(93);
        lokiReturns(numberedStream(25));

        LogPageDto page = logsService.getPage(null, null, null, null, 1, 25, null);

        assertThat(page.totalCount()).isEqualTo(93);
        assertThat(page.totalPages()).isEqualTo(4); // ceil(93/25)
        assertThat(page.depthCapped()).isFalse();
    }

    @Test
    void getPage_clampsAPageNumberPastTheEnd() {
        countReturns(30);
        lokiReturns(numberedStream(30));

        // asking for page 99 of 3 lands on 3 rather than erroring or returning nothing
        assertThat(logsService.getPage(null, null, null, null, 99, 10, null).page()).isEqualTo(3);
    }

    @Test
    void getPage_treatsAZeroOrNegativePageAsTheFirst() {
        countReturns(30);
        lokiReturns(numberedStream(10));

        assertThat(logsService.getPage(null, null, null, null, 0, 10, null).page()).isEqualTo(1);
        assertThat(logsService.getPage(null, null, null, null, -5, 10, null).page()).isEqualTo(1);
    }

    @Test
    void getPage_reportsOnePageAndNoRows_whenNothingMatches() {
        countReturns(0);
        lokiReturns(streams());

        LogPageDto page = logsService.getPage(null, "nothing-matches-this", null, null, 1, 25, null);

        assertThat(page.entries()).isEmpty();
        assertThat(page.totalCount()).isZero();
        assertThat(page.totalPages()).isEqualTo(1);
    }

    /**
     * Loki will not return more than 5000 entries, and a numbered page is cut from a single
     * over-fetch, so past that depth the pager has to say so rather than pretend.
     */
    @Test
    void getPage_flagsDepthCapped_whenThereAreMoreLinesThanPagingCanReach() {
        countReturns(50_000);
        lokiReturns(numberedStream(25));

        LogPageDto page = logsService.getPage(null, null, null, null, 1, 25, null);

        assertThat(page.totalCount()).isEqualTo(50_000);
        assertThat(page.totalPages()).isEqualTo(200);  // 5000 / 25, not 2000
        assertThat(page.depthCapped()).isTrue();
    }

    @Test
    void getPage_pinsTheAnchorSoPagesCannotShift() {
        countReturns(30);
        lokiReturns(numberedStream(20));

        LogPageDto page = logsService.getPage(null, null, null, "1787661302684000000", 2, 10, null);

        assertThat(page.anchor()).isEqualTo("1787661302684000000");
        verify(lokiClient).queryRange(anyString(), anyLong(), eq(1787661302684000000L), anyInt(), anyString());
    }

    /**
     * Regression: count_over_time covers (T-range, T] while query_range covers [start, end).
     * Counting at the anchor itself therefore includes a line the rows exclude, and the last
     * page comes back holding one row more than totalPages allows for - seen against a live
     * Loki as 255 rows walked against a total of 254. Counting a nanosecond earlier lines the
     * two windows up exactly.
     */
    @Test
    void getPage_countsOverTheSameWindowTheRowsCameFrom() {
        countReturns(30);
        lokiReturns(numberedStream(10));

        logsService.getPage(null, null, null, "1787661302684000000", 1, 10, null);

        verify(lokiClient).instantQuery(anyString(), eq(1787661302684000000L - 1));
    }

    @Test
    void getPage_returnsAFreshAnchor_whenNoneWasGiven() {
        countReturns(5);
        lokiReturns(numberedStream(5));
        long nowNanos = (System.currentTimeMillis() / 1000) * 1_000_000_000L;

        LogPageDto page = logsService.getPage(null, null, null, null, 1, 25, null);

        assertThat(Long.parseLong(page.anchor())).isBetween(nowNanos, nowNanos + 5_000_000_000L);
    }

    @Test
    void getPage_appliesTheSearchFilter() {
        countReturns(3);
        lokiReturns(numberedStream(3));

        logsService.getPage(null, "timeout", null, null, 1, 25, null);

        verify(lokiClient).queryRange(eq("{app_name=\"apisix\"} |~ \"(?i)timeout\""),
                anyLong(), anyLong(), anyInt(), anyString());
    }

    @Test
    void getPage_walksBackwardByDefault() {
        countReturns(30);
        lokiReturns(numberedStream(10));

        LogPageDto page = logsService.getPage(null, null, null, null, 1, 10, null);

        assertThat(page.direction()).isEqualTo("backward");
        verify(lokiClient).queryRange(anyString(), anyLong(), anyLong(), anyInt(), eq("backward"));
    }

    @Test
    void getPage_walksForwardWhenAsked() {
        countReturns(30);
        lokiReturns(numberedStream(10));

        LogPageDto page = logsService.getPage(null, null, null, null, 1, 10, "forward");

        assertThat(page.direction()).isEqualTo("forward");
        verify(lokiClient).queryRange(anyString(), anyLong(), anyLong(), anyInt(), eq("forward"));
    }

    /**
     * parseStreams normalises every response to newest-first, so a forward page has to be
     * flipped back or "oldest first" would return the newest rows in ascending order - which
     * looks plausible and is the wrong end of the window entirely.
     */
    @Test
    void getPage_returnsForwardPagesOldestFirst() {
        countReturns(3);
        // numberedStream emits line-0 newest .. line-2 oldest
        lokiReturns(numberedStream(3));

        LogPageDto page = logsService.getPage(null, null, null, null, 1, 3, "forward");

        assertThat(page.entries()).extracting(LogEntryDto::raw)
                .containsExactly("line-2", "line-1", "line-0");
    }

    @Test
    void getPage_rejectsAnUnknownDirectionInFavourOfBackward() {
        countReturns(10);
        lokiReturns(numberedStream(10));

        assertThat(logsService.getPage(null, null, null, null, 1, 10, "sideways").direction())
                .isEqualTo("backward");
    }

    @Test
    void getPage_fallsBackToADefaultPageSize() {
        countReturns(10);
        lokiReturns(numberedStream(10));

        assertThat(logsService.getPage(null, null, null, null, 1, null, null).pageSize()).isEqualTo(25);
        assertThat(logsService.getPage(null, null, null, null, 1, 0, null).pageSize()).isEqualTo(25);
    }
}
