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
import wearefrank.backend.dto.LogKind;
import wearefrank.backend.dto.LogPageDto;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;
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

    /** What the audit selector resolves to when the caller supplies no query of their own. */
    private static final String AUDIT = "{app_name=\"apisix\", log_type=\"audit\"}";
    private static final String ERROR = "{app_name=\"apisix\", log_type=\"error\"}";

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

    /**
     * The other kind of line, captured off the gateway verbatim: nginx's own error log
     * format, with the plugin's whole configuration dumped into the middle of the message.
     * Kept intact because that blob is the hard part - it is full of commas, colons and
     * quoted keys, any of which a careless split of the trailing context would cut at.
     */
    private static final String ERROR_LINE = """
            2026/08/26 08:21:43 [info] 51#51: *5407 [lua] plugin.lua:898: conf_version(): \
            init plugin-level conf version: 2903643133, from {"_meta":[],"batch_max_size":1000,\
            "buffer_duration":60,"endpoint_addrs":["http://loki-gateway.monitoring.svc.cluster.local:80"],\
            "endpoint_uri":"/loki/api/v1/push","inactive_timeout":5,"include_req_body":false,\
            "include_resp_body":false,"keepalive":true,"keepalive_pool":5,"keepalive_timeout":60000,\
            "log_format":{"audit":{"route_id":"$route_id"},"gemeente_code":"TEST","level":"INFO",\
            "request":{"request_host":"$host","request_method":"$request_method","request_path":"$uri"},\
            "response":{"status":"$status","upstream_endpoint":{"address":"$upstream_addr",\
            "host":"$upstream_host","query":"$args","scheme":"$upstream_scheme","uri":"$upstream_uri"},\
            "upstream_latency_ms":"$upstream_response_time"},"route_name":"$route_name",\
            "source":"$http_x_forwarded_for","timestamp":"$time_iso8601"},"log_labels":{\
            "app_instance":"frank-gateway","app_name":"apisix","container":"apisix",\
            "instance":"wearefrank-gemeente-team-playground/frank-gateway:apisix","level":"INFO",\
            "log_type":"audit","namespace":"wearefrank-gemeente-team-playground","pod":"frank-gateway",\
            "service_name":"apisix"},"max_req_body_bytes":524288,"max_resp_body_bytes":524288,\
            "max_retry_count":0,"name":"loki logger","retry_delay":1,"ssl_verify":false,\
            "tenant_id":"local","timeout":3000} while logging request, client: 109.94.148.130, \
            server: _, request: "GET /test/anything HTTP/1.1", \
            upstream: "http://100.65.84.218:80/anything", \
            host: "playground.tst.eu1.wearefrank.cloud", \
            request_id: "d5ea29ea7e7f00b910d5e1e79e535cf9\"""";

    // 1700000000s in nanoseconds, which is 2023-11-14T22:13:20Z
    private static final String TS = "1700000000000000000";

    private static String streams(String... streams) {
        return "{\"status\":\"success\",\"data\":{\"resultType\":\"streams\",\"result\":["
                + String.join(",", streams) + "]}}";
    }

    /** One Loki stream from alternating timestamp/line arguments, carrying no namespace. */
    private static String stream(String... tsAndLine) {
        return labelledStream("{\"app_name\":\"apisix\"}", tsAndLine);
    }

    /**
     * The same, under a namespace label - what a Loki several namespaces push to returns,
     * one stream per label set.
     */
    private static String streamIn(String label, String namespace, String... tsAndLine) {
        return labelledStream("{\"app_name\":\"apisix\",\"" + label + "\":\"" + namespace + "\"}", tsAndLine);
    }

    private static String labelledStream(String labels, String... tsAndLine) {
        StringBuilder sb = new StringBuilder("{\"stream\":" + labels + ",\"values\":[");
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
        logsService = new LogsService(lokiClient, new ObjectMapper().findAndRegisterModules(), "", "namespace");
    }

    /** The same service as the one under test, but with LOKI_NAMESPACE set. */
    private LogsService pinnedTo(String namespace, String label) {
        return new LogsService(lokiClient, new ObjectMapper().findAndRegisterModules(), namespace, label);
    }

    /** The first entry of a default audit query, which is what most of these assert against. */
    private LogEntryDto onlyEntry() {
        return logsService.getRecentLogs(null, null, null, null, null, null).getFirst();
    }

    // --- audit lines ---------------------------------------------------------------

    @Test
    void getRecentLogs_flattensNestedAccessLogLine() {
        lokiReturns(streams(stream(TS, ACCESS_LINE)));

        List<LogEntryDto> entries = logsService.getRecentLogs(null, null, null, null, null, null);

        assertThat(entries).hasSize(1);
        LogEntryDto entry = entries.getFirst();
        assertThat(entry.type()).isEqualTo("audit");
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

    /** The error-only fields stay empty rather than being filled with something plausible. */
    @Test
    void getRecentLogs_leavesTheErrorFieldsEmptyOnAnAuditLine() {
        lokiReturns(streams(stream(TS, ACCESS_LINE)));

        LogEntryDto entry = onlyEntry();
        assertThat(entry.message()).isNull();
        assertThat(entry.module()).isNull();
        assertThat(entry.requestId()).isNull();
    }

    @Test
    void getRecentLogs_convertsUpstreamResponseTimeFromSecondsToMillis() {
        lokiReturns(streams(stream(TS, ACCESS_LINE)));

        assertThat(onlyEntry().latencyMs()).isEqualTo(12.0);
    }

    @Test
    void getRecentLogs_takesFirstHop_whenLatencyListsSeveralUpstreams() {
        String line = ACCESS_LINE.replace("\"upstream_latency_ms\":\"0.012\"",
                                          "\"upstream_latency_ms\":\"0.012, 0.500\"");
        lokiReturns(streams(stream(TS, line)));

        assertThat(onlyEntry().latencyMs()).isEqualTo(12.0);
    }

    @Test
    void getRecentLogs_leavesFieldsNull_whenNginxWroteADash() {
        String line = ACCESS_LINE
                .replace("\"upstream_latency_ms\":\"0.012\"", "\"upstream_latency_ms\":\"-\"")
                .replace("\"address\":\"172.18.0.7:8080\"", "\"address\":\"-\"");
        lokiReturns(streams(stream(TS, line)));

        LogEntryDto entry = onlyEntry();
        assertThat(entry.latencyMs()).isNull();
        assertThat(entry.upstream()).isNull();
        assertThat(entry.status()).isEqualTo(200);
    }

    /**
     * The production log_format fills `source` from $http_x_forwarded_for and never writes
     * source_addr - that field only exists in the compose config, which adds it because
     * APISIX leaves the forwarded header empty on its image. Reading only one of the two
     * left the Source column blank against a real gateway.
     */
    @Test
    void getRecentLogs_readsTheCallerAddressFromEitherSourceField() {
        String forwardedOnly = ACCESS_LINE.replace("\"source_addr\":\"172.18.0.4\"",
                                                   "\"source\":\"81.30.4.7\"");
        lokiReturns(streams(stream(TS, forwardedOnly)));

        assertThat(onlyEntry().source()).isEqualTo("81.30.4.7");
    }

    @Test
    void getRecentLogs_prefersSourceOverSourceAddr_whenBothArePresent() {
        String both = ACCESS_LINE.replace("\"source_addr\":\"172.18.0.4\"",
                                          "\"source\":\"81.30.4.7\",\"source_addr\":\"172.18.0.4\"");
        lokiReturns(streams(stream(TS, both)));

        assertThat(onlyEntry().source()).isEqualTo("81.30.4.7");
    }

    @Test
    void getRecentLogs_readsTheTenantOutOfGemeenteCode() {
        String line = ACCESS_LINE.replace("{\"level\":\"INFO\"", "{\"gemeente_code\":\"TEST\",\"level\":\"INFO\"");
        lokiReturns(streams(stream(TS, line)));

        assertThat(onlyEntry().gemeenteCode()).isEqualTo("TEST");
    }

    /** Some formats write route_id at the top level instead of nesting it under audit. */
    @Test
    void getRecentLogs_fallsBackToATopLevelRouteId() {
        String line = ACCESS_LINE.replace(",\"audit\":{\"route_id\":\"12\"}", ",\"route_id\":\"arr_1\"");
        lokiReturns(streams(stream(TS, line)));

        assertThat(onlyEntry().routeId()).isEqualTo("arr_1");
    }

    // --- error lines ---------------------------------------------------------------

    /**
     * The second kind of line, end to end. Everything nginx appended has to survive the
     * plugin configuration sitting in front of it.
     */
    @Test
    void getRecentLogs_takesApartAnNginxErrorLine() {
        lokiReturns(streams(stream(TS, ERROR_LINE)));

        LogEntryDto entry = onlyEntry();
        assertThat(entry.type()).isEqualTo("error");
        assertThat(entry.level()).isEqualTo("INFO");
        assertThat(entry.module()).isEqualTo("[lua] plugin.lua:898");
        assertThat(entry.message())
                .startsWith("conf_version(): init plugin-level conf version: 2903643133")
                .endsWith("while logging request");
        assertThat(entry.source()).isEqualTo("109.94.148.130");
        assertThat(entry.method()).isEqualTo("GET");
        assertThat(entry.path()).isEqualTo("/test/anything");
        assertThat(entry.host()).isEqualTo("playground.tst.eu1.wearefrank.cloud");
        assertThat(entry.upstream()).isEqualTo("http://100.65.84.218:80/anything");
        assertThat(entry.requestId()).isEqualTo("d5ea29ea7e7f00b910d5e1e79e535cf9");
        assertThat(entry.raw()).isEqualTo(ERROR_LINE);
    }

    /** No response was logged, so the access log's columns stay empty rather than zeroed. */
    @Test
    void getRecentLogs_leavesTheAuditFieldsEmptyOnAnErrorLine() {
        lokiReturns(streams(stream(TS, ERROR_LINE)));

        LogEntryDto entry = onlyEntry();
        assertThat(entry.status()).isNull();
        assertThat(entry.latencyMs()).isNull();
        assertThat(entry.routeName()).isNull();
        assertThat(entry.routeId()).isNull();
        assertThat(entry.gemeenteCode()).isNull();
    }

    /**
     * The line is read by its shape, not by the stream it was selected from. APISIX puts
     * the odd error line into the access stream, and one rendered against the audit columns
     * is a row of nothing.
     */
    @Test
    void getRecentLogs_readsAnErrorLineFoundInTheAuditStream() {
        lokiReturns(streams(stream(TS, ERROR_LINE)));

        assertThat(logsService.getRecentLogs("audit", null, null, null, null, null).getFirst().type())
                .isEqualTo("error");
    }

    @Test
    void getRecentLogs_readsAnAuditRecordFoundInTheErrorStream() {
        lokiReturns(streams(stream(TS, ACCESS_LINE)));

        assertThat(logsService.getRecentLogs("error", null, null, null, null, null).getFirst().type())
                .isEqualTo("audit");
    }

    /**
     * Anything that is neither shape keeps its text as the message. Left as an empty row
     * with only a timestamp it would look like the gateway had logged nothing.
     */
    @Test
    void getRecentLogs_keepsAnUnrecognisedLine_asTheMessage() {
        lokiReturns(streams(stream(TS, "plain error text")));

        LogEntryDto entry = onlyEntry();
        assertThat(entry.type()).isEqualTo("error");
        assertThat(entry.message()).isEqualTo("plain error text");
        assertThat(entry.raw()).isEqualTo("plain error text");
        assertThat(entry.level()).isNull();
        assertThat(entry.status()).isNull();
        assertThat(entry.timestamp()).isEqualTo("2023-11-14T22:13:20Z");
    }

    // --- stream selection ----------------------------------------------------------

    @Test
    void getRecentLogs_selectsTheAuditStreamByDefault() {
        lokiReturns(streams());

        logsService.getRecentLogs(null, null, null, null, null, null);

        verify(lokiClient).queryRange(eq(AUDIT), anyLong(), anyLong(), anyInt(), anyString());
    }

    @Test
    void getRecentLogs_selectsTheErrorStream_whenAskedForIt() {
        lokiReturns(streams());

        logsService.getRecentLogs("error", null, null, null, null, null);

        verify(lokiClient).queryRange(eq(ERROR), anyLong(), anyLong(), anyInt(), anyString());
    }

    @Test
    void getRecentLogs_acceptsTheTypeInAnyCase() {
        lokiReturns(streams());

        logsService.getRecentLogs("ERROR", null, null, null, null, null);

        verify(lokiClient).queryRange(eq(ERROR), anyLong(), anyLong(), anyInt(), anyString());
    }

    /**
     * A typo must not quietly serve the other log: an error table answering with access
     * lines - or with none - reads like the gateway is healthy.
     */
    @Test
    void getRecentLogs_rejectsAnUnknownType() {
        assertThatThrownBy(() -> logsService.getRecentLogs("warnings", null, null, null, null, null))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("400")
                .hasMessageContaining("audit, error");
    }

    @Test
    void getPage_selectsTheErrorStream() {
        countReturns(3);
        lokiReturns(numberedStream(3));

        logsService.getPage("error", null, null, null, null, 1, 25, null);

        verify(lokiClient).queryRange(eq(ERROR), anyLong(), anyLong(), anyInt(), anyString());
    }

    @Test
    void countLogs_countsWithinTheSelectedStream() {
        when(lokiClient.instantQuery(anyString(), any())).thenReturn(vector("3"));

        assertThat(logsService.countLogs("error", null, null, null).query())
                .startsWith("sum(count_over_time(" + ERROR + "[");
    }

    // --- raw range query -----------------------------------------------------------

    @Test
    void logRangeQuery_fallsBackToTheAuditSelector_whenQueryBlank() {
        lokiReturns(streams());

        logsService.logRangeQuery(null, "  ", null, null, null, null, null);

        verify(lokiClient).queryRange(eq(AUDIT), anyLong(), anyLong(), anyInt(), anyString());
    }

    @Test
    void logRangeQuery_passesGivenSelectorThrough() {
        lokiReturns(streams());

        logsService.logRangeQuery(null, "{namespace=\"local\"}", null, null, null, null, null);

        verify(lokiClient).queryRange(eq("{namespace=\"local\"}"), anyLong(), anyLong(), anyInt(), anyString());
    }

    /** A caller-supplied selector has already picked its stream, so the type is not merged in. */
    @Test
    void logRangeQuery_lettsAGivenSelectorReplaceTheTypeSelector() {
        lokiReturns(streams());

        logsService.logRangeQuery("error", "{app_name=\"apisix\"}", null, null, null, null, null);

        verify(lokiClient).queryRange(eq("{app_name=\"apisix\"}"), anyLong(), anyLong(), anyInt(), anyString());
    }

    @Test
    void logRangeQuery_defaultsToLastHour_whenStartTimeNull() {
        lokiReturns(streams());
        long now = System.currentTimeMillis() / 1000;

        logsService.logRangeQuery(null, null, null, null, null, null, null);

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

        logsService.logRangeQuery(null, null, null, 0L, null, null, null);

        ArgumentCaptor<Long> start = ArgumentCaptor.forClass(Long.class);
        ArgumentCaptor<Long> end = ArgumentCaptor.forClass(Long.class);
        verify(lokiClient).queryRange(anyString(), start.capture(), end.capture(), anyInt(), anyString());
        assertThat(end.getValue() - start.getValue()).isEqualTo(7 * 24 * 3600L * 1_000_000_000L);
    }

    @Test
    void logRangeQuery_honoursExplicitStartTime() {
        lokiReturns(streams());

        logsService.logRangeQuery(null, null, null, 1700000000L, null, null, null);

        verify(lokiClient).queryRange(anyString(), eq(1700000000L * 1_000_000_000L), anyLong(),
                anyInt(), anyString());
    }

    @Test
    void logRangeQuery_capsLimit() {
        lokiReturns(streams());

        logsService.logRangeQuery(null, null, null, null, null, 99_999, null);

        verify(lokiClient).queryRange(anyString(), anyLong(), anyLong(), eq(1000), anyString());
    }

    @Test
    void logRangeQuery_fallsBackToDefaultLimit_whenLimitNotPositive() {
        lokiReturns(streams());

        logsService.logRangeQuery(null, null, null, null, null, 0, null);

        verify(lokiClient).queryRange(anyString(), anyLong(), anyLong(), eq(100), anyString());
    }

    @Test
    void logRangeQuery_fallsBackToBackward_onUnknownDirection() {
        lokiReturns(streams());

        logsService.logRangeQuery(null, null, null, null, null, null, "sideways");

        verify(lokiClient).queryRange(anyString(), anyLong(), anyLong(), anyInt(), eq("backward"));
    }

    @Test
    void logRangeQuery_passesForwardThrough() {
        lokiReturns(streams());

        logsService.logRangeQuery(null, null, null, null, null, null, "forward");

        verify(lokiClient).queryRange(anyString(), anyLong(), anyLong(), anyInt(), eq("forward"));
    }

    // --- ordering and limits -------------------------------------------------------

    @Test
    void getRecentLogs_sortsNewestFirst_acrossStreams() {
        lokiReturns(streams(
                stream("1700000000000000000", "oldest"),
                stream("1700000002000000000", "newest", "1700000001000000000", "middle")));

        assertThat(logsService.getRecentLogs(null, null, null, null, null, null))
                .extracting(LogEntryDto::raw)
                .containsExactly("newest", "middle", "oldest");
    }

    @Test
    void getRecentLogs_truncatesToLimit_afterSorting() {
        lokiReturns(streams(
                stream("1700000000000000000", "a"),
                stream("1700000001000000000", "b"),
                stream("1700000002000000000", "c")));

        assertThat(logsService.getRecentLogs(null, null, null, null, null, 2))
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

        LogEntryDto entry = onlyEntry();
        assertThat(entry.status()).isEqualTo(200);
        // 0.001 seconds, so 1ms - not 0.001ms, whatever the field is called.
        assertThat(entry.latencyMs()).isEqualTo(1.0);
        assertThat(entry.routeName()).isEqualTo("centric-to-djuma-route");
        assertThat(entry.routeId()).isEqualTo("centric-to-djuma-route");
        assertThat(entry.method()).isEqualTo("GET");
        assertThat(entry.path()).isEqualTo("/clo/djuma/messages/974");
        assertThat(entry.upstream()).isEqualTo("172.18.0.7:8080");
        assertThat(entry.source()).isEqualTo("172.18.0.9");
        assertThat(entry.gemeenteCode()).isEqualTo("0484");
    }

    @Test
    void getRecentLogs_returnsEmptyList_whenLokiHasNoMatchingStreams() {
        lokiReturns(streams());

        assertThat(logsService.getRecentLogs(null, null, null, null, null, null)).isEmpty();
    }

    @Test
    void getRecentLogs_throwsRuntimeException_onUnparseableResponse() {
        lokiReturns("not json");

        assertThatThrownBy(() -> logsService.getRecentLogs(null, null, null, null, null, null))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Failed to parse Loki response");
    }

    // --- search pipeline -----------------------------------------------------------

    @Test
    void buildPipeline_returnsSelectorUnchanged_whenNoSearch() {
        assertThat(logsService.buildPipeline(LogKind.AUDIT, null, null)).isEqualTo(AUDIT);
        assertThat(logsService.buildPipeline(LogKind.AUDIT, null, "   ")).isEqualTo(AUDIT);
        assertThat(logsService.buildPipeline(LogKind.ERROR, null, null)).isEqualTo(ERROR);
    }

    @Test
    void buildPipeline_appendsCaseInsensitiveLineFilter() {
        assertThat(logsService.buildPipeline(LogKind.AUDIT, null, "timeout"))
                .isEqualTo(AUDIT + " |~ \"(?i)timeout\"");
    }

    @Test
    void buildPipeline_keepsCustomSelector() {
        assertThat(logsService.buildPipeline(LogKind.AUDIT, "{namespace=\"local\"}", "boom"))
                .isEqualTo("{namespace=\"local\"} |~ \"(?i)boom\"");
    }

    /**
     * A path like /clo/djuma/* is an ordinary thing to paste into a search box, and every
     * character in it means something to a regex engine. Escaped, it matches literally.
     */
    @Test
    void buildPipeline_escapesRegexMetacharacters() {
        assertThat(logsService.buildPipeline(LogKind.AUDIT, null, "/clo/djuma/*"))
                .isEqualTo(AUDIT + " |~ \"(?i)/clo/djuma/\\\\*\"");
        assertThat(logsService.buildPipeline(LogKind.AUDIT, null, "a.b+c"))
                .isEqualTo(AUDIT + " |~ \"(?i)a\\\\.b\\\\+c\"");
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
        assertThat(logsService.buildPipeline(LogKind.AUDIT, null, "\" or {job=\"x\"} #"))
                .isEqualTo(AUDIT + " |~ \"(?i)\\\" or \\\\{job=\\\"x\\\"\\\\} #\"");
    }

    @Test
    void buildPipeline_escapesBackslashesBeforeQuotes() {
        // a lone backslash must not end up escaping the closing quote
        assertThat(logsService.buildPipeline(LogKind.AUDIT, null, "c:\\temp"))
                .isEqualTo(AUDIT + " |~ \"(?i)c:\\\\\\\\temp\"");
    }

    // --- forced namespace ----------------------------------------------------------

    @Test
    void buildPipeline_pinsTheDefaultSelectorToTheConfiguredNamespace() {
        assertThat(pinnedTo("acceptance", "namespace").buildPipeline(LogKind.AUDIT, null, null))
                .isEqualTo("{namespace=\"acceptance\", app_name=\"apisix\", log_type=\"audit\"}");
    }

    @Test
    void buildPipeline_pinsAndKeepsTheSearchFilter() {
        assertThat(pinnedTo("acceptance", "namespace").buildPipeline(LogKind.ERROR, null, "timeout"))
                .isEqualTo("{namespace=\"acceptance\", app_name=\"apisix\", log_type=\"error\"} |~ \"(?i)timeout\"");
    }

    /**
     * The point of doing this in buildPipeline rather than in the kind's own selector:
     * ?query= replaces the selector outright, so a caller asking for another namespace
     * still gets the configured one ANDed in - which matches nothing rather than that
     * namespace's lines.
     */
    @Test
    void buildPipeline_pinsACallerSuppliedSelectorToo() {
        assertThat(pinnedTo("acceptance", "namespace").buildPipeline(LogKind.AUDIT, "{namespace=\"other\"}", null))
                .isEqualTo("{namespace=\"acceptance\", namespace=\"other\"}");
        assertThat(pinnedTo("acceptance", "namespace")
                .buildPipeline(LogKind.AUDIT, "{app_name=\"apisix\"} |= \"boom\"", null))
                .isEqualTo("{namespace=\"acceptance\", app_name=\"apisix\"} |= \"boom\"");
    }

    @Test
    void buildPipeline_pinsAnEmptyCallerSelectorWithoutLeavingAStrayComma() {
        assertThat(pinnedTo("acceptance", "namespace").buildPipeline(LogKind.AUDIT, "{}", null))
                .isEqualTo("{namespace=\"acceptance\"}");
    }

    @Test
    void buildPipeline_usesTheConfiguredLabelName() {
        assertThat(pinnedTo("acceptance", "kubernetes_namespace").buildPipeline(LogKind.AUDIT, null, null))
                .isEqualTo("{kubernetes_namespace=\"acceptance\", app_name=\"apisix\", log_type=\"audit\"}");
    }

    /** A brace inside a line filter is text, not the end of the selector. */
    @Test
    void buildPipeline_ignoresBracesInsideStringLiterals() {
        assertThat(pinnedTo("acceptance", "namespace")
                .buildPipeline(LogKind.AUDIT, "{app_name=\"apisix\"} |= \"{\"", null))
                .isEqualTo("{namespace=\"acceptance\", app_name=\"apisix\"} |= \"{\"");
    }

    /**
     * Only the first selector would get the matcher, so a query holding two is refused
     * rather than served with half of it pinned.
     */
    @Test
    void buildPipeline_rejectsASecondStreamSelector() {
        assertThatThrownBy(() -> pinnedTo("acceptance", "namespace")
                .buildPipeline(LogKind.AUDIT, "{app_name=\"apisix\"} or {app_name=\"other\"}", null))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("single stream selector");
    }

    @Test
    void buildPipeline_rejectsAQueryWithNoStreamSelector() {
        assertThatThrownBy(() -> pinnedTo("acceptance", "namespace")
                .buildPipeline(LogKind.AUDIT, "app_name=\"apisix\"", null))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("stream selector");
    }

    @Test
    void buildPipeline_leavesTheQueryAloneWhenNoNamespaceIsConfigured() {
        // and in particular does not reject the selector-less queries the check above would
        assertThat(logsService.buildPipeline(LogKind.AUDIT, "nonsense", null)).isEqualTo("nonsense");
    }

    @Test
    void countLogs_countsWithinTheForcedNamespace() {
        when(lokiClient.instantQuery(anyString(), any())).thenReturn(vector("3"));

        assertThat(pinnedTo("acceptance", "namespace").countLogs(null, null, null, null).query())
                .startsWith("sum(count_over_time({namespace=\"acceptance\", app_name=\"apisix\", log_type=\"audit\"}[");
    }

    @Test
    void getRecentLogs_queriesLokiWithinTheForcedNamespace() {
        lokiReturns(streams());

        pinnedTo("acceptance", "namespace").getRecentLogs(null, null, null, null, null, null);

        verify(lokiClient).queryRange(eq("{namespace=\"acceptance\", app_name=\"apisix\", log_type=\"audit\"}"),
                anyLong(), anyLong(), anyInt(), anyString());
    }

    @Test
    void getRecentLogs_passesTheSearchFilterToLoki() {
        lokiReturns(streams());

        logsService.getRecentLogs(null, null, "timeout", null, null, null);

        verify(lokiClient).queryRange(eq(AUDIT + " |~ \"(?i)timeout\""),
                anyLong(), anyLong(), anyInt(), anyString());
    }

    // --- several forced namespaces -------------------------------------------------

    /**
     * A list becomes one regex matcher rather than several matchers: repeating the label
     * would AND them, and no line is in two namespaces at once, so that selects nothing.
     */
    @Test
    void buildPipeline_pinsToEveryConfiguredNamespace() {
        assertThat(pinnedTo("gem-a,gem-b", "namespace").buildPipeline(LogKind.AUDIT, null, null))
                .isEqualTo("{namespace=~\"gem-a|gem-b\", app_name=\"apisix\", log_type=\"audit\"}");
    }

    @Test
    void buildPipeline_trimsAndDropsBlanksInTheNamespaceList() {
        assertThat(pinnedTo("  gem-a , , gem-b  ", "namespace").buildPipeline(LogKind.AUDIT, null, null))
                .isEqualTo("{namespace=~\"gem-a|gem-b\", app_name=\"apisix\", log_type=\"audit\"}");
    }

    @Test
    void buildPipeline_dropsDuplicateNamespaces() {
        assertThat(pinnedTo("gem-a,gem-b,gem-a", "namespace").buildPipeline(LogKind.AUDIT, null, null))
                .isEqualTo("{namespace=~\"gem-a|gem-b\", app_name=\"apisix\", log_type=\"audit\"}");
    }

    /** One namespace keeps the exact matcher, trailing comma or not. */
    @Test
    void buildPipeline_keepsTheExactMatcherForASingleNamespace() {
        assertThat(pinnedTo("gem-a,", "namespace").buildPipeline(LogKind.AUDIT, null, null))
                .isEqualTo("{namespace=\"gem-a\", app_name=\"apisix\", log_type=\"audit\"}");
    }

    /**
     * The one that matters most: the values now land in a regex, so a metacharacter in a
     * namespace has to match itself. Unescaped, "gem.a" would also select "gemXa" - a pin
     * that quietly admits a namespace nobody named.
     */
    @Test
    void buildPipeline_escapesRegexMetacharactersInEachNamespace() {
        assertThat(pinnedTo("gem.a,gem+b", "namespace").buildPipeline(LogKind.AUDIT, null, null))
                .isEqualTo("{namespace=~\"gem\\\\.a|gem\\\\+b\", app_name=\"apisix\", log_type=\"audit\"}");
    }

    @Test
    void buildPipeline_pinsACallerSuppliedSelectorToEveryNamespace() {
        assertThat(pinnedTo("gem-a,gem-b", "namespace")
                .buildPipeline(LogKind.AUDIT, "{namespace=\"other\"}", null))
                .isEqualTo("{namespace=~\"gem-a|gem-b\", namespace=\"other\"}");
    }

    @Test
    void buildPipeline_usesTheConfiguredLabelNameForSeveralNamespaces() {
        assertThat(pinnedTo("gem-a,gem-b", "kubernetes_namespace").buildPipeline(LogKind.AUDIT, null, null))
                .isEqualTo("{kubernetes_namespace=~\"gem-a|gem-b\", app_name=\"apisix\", log_type=\"audit\"}");
    }

    @Test
    void buildPipeline_stillRejectsASecondStreamSelectorWithSeveralNamespaces() {
        assertThatThrownBy(() -> pinnedTo("gem-a,gem-b", "namespace")
                .buildPipeline(LogKind.AUDIT, "{app_name=\"apisix\"} or {app_name=\"other\"}", null))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("single stream selector");
    }

    @Test
    void countLogs_countsAcrossEveryForcedNamespace() {
        when(lokiClient.instantQuery(anyString(), any())).thenReturn(vector("3"));

        assertThat(pinnedTo("gem-a,gem-b", "namespace").countLogs(null, null, null, null).query())
                .startsWith("sum(count_over_time({namespace=~\"gem-a|gem-b\", app_name=\"apisix\", log_type=\"audit\"}[");
    }

    /** The endpoint the dashboard actually calls, which had no namespace assertion at all. */
    @Test
    void getPage_queriesLokiWithinTheForcedNamespaces() {
        countReturns(5);
        lokiReturns(numberedStream(25));

        pinnedTo("gem-a,gem-b", "namespace").getPage(null, null, null, null, null, 1, 25, null);

        verify(lokiClient).queryRange(eq("{namespace=~\"gem-a|gem-b\", app_name=\"apisix\", log_type=\"audit\"}"),
                anyLong(), anyLong(), anyInt(), anyString());
    }

    @Test
    void logRangeQuery_queriesLokiWithinTheForcedNamespaces() {
        lokiReturns(streams());

        pinnedTo("gem-a,gem-b", "namespace")
                .logRangeQuery("error", null, null, null, null, null, null);

        verify(lokiClient).queryRange(eq("{namespace=~\"gem-a|gem-b\", app_name=\"apisix\", log_type=\"error\"}"),
                anyLong(), anyLong(), anyInt(), anyString());
    }

    // --- namespace on the row ------------------------------------------------------

    /**
     * The point of merging several namespaces: each row says which one it came from, and
     * the two streams still interleave into one newest-first list.
     */
    @Test
    void getRecentLogs_carriesTheNamespaceOffEachStream() {
        lokiReturns(streams(
                streamIn("namespace", "gem-a", "1700000000000000000", "from-a",
                        "1700000002000000000", "also-from-a"),
                streamIn("namespace", "gem-b", "1700000001000000000", "from-b")));

        assertThat(logsService.getRecentLogs(null, null, null, null, null, null))
                .extracting(LogEntryDto::raw, LogEntryDto::namespace)
                .containsExactly(
                        tuple("also-from-a", "gem-a"),
                        tuple("from-b", "gem-b"),
                        tuple("from-a", "gem-a"));
    }

    /** A Loki that is not labelled by namespace still returns rows, just without one. */
    @Test
    void getRecentLogs_leavesTheNamespaceNullWhenTheStreamCarriesNoLabel() {
        lokiReturns(streams(stream(TS, "no-labels-here")));

        assertThat(onlyEntry().namespace()).isNull();
    }

    /** Read under the configured label, so a relabelling collector resolves too. */
    @Test
    void getRecentLogs_readsTheNamespaceUnderTheConfiguredLabel() {
        lokiReturns(streams(streamIn("kubernetes_namespace", "gem-a", TS, "line")));

        assertThat(pinnedTo("gem-a", "kubernetes_namespace")
                .getRecentLogs(null, null, null, null, null, null).getFirst().namespace())
                .isEqualTo("gem-a");
    }

    // --- count ---------------------------------------------------------------------

    private static String vector(String value) {
        return "{\"status\":\"success\",\"data\":{\"resultType\":\"vector\",\"result\":"
                + "[{\"metric\":{},\"value\":[1700000000,\"" + value + "\"]}]}}";
    }

    @Test
    void countLogs_readsTheScalarOutOfTheVector() {
        when(lokiClient.instantQuery(anyString(), any())).thenReturn(vector("4213"));

        assertThat(logsService.countLogs(null, null, null, null).count()).isEqualTo(4213L);
    }

    @Test
    void countLogs_returnsZero_whenNothingMatched() {
        // Loki answers an unmatched count with an empty vector, not a zero sample
        when(lokiClient.instantQuery(anyString(), any()))
                .thenReturn("{\"status\":\"success\",\"data\":{\"resultType\":\"vector\",\"result\":[]}}");

        assertThat(logsService.countLogs(null, null, "nothing-matches-this", null).count()).isZero();
    }

    @Test
    void countLogs_countsOverTheSameWindowTheTableShows() {
        when(lokiClient.instantQuery(anyString(), any())).thenReturn(vector("1"));

        logsService.countLogs(null, null, null, null);

        ArgumentCaptor<String> logql = ArgumentCaptor.forClass(String.class);
        verify(lokiClient).instantQuery(logql.capture(), any());
        // default window is the last hour, so the range must say 3600s
        assertThat(logql.getValue()).isEqualTo("sum(count_over_time(" + AUDIT + "[3600s]))");
    }

    @Test
    void countLogs_includesTheSearchFilterInTheCount() {
        when(lokiClient.instantQuery(anyString(), any())).thenReturn(vector("7"));

        logsService.countLogs(null, null, "timeout", null);

        ArgumentCaptor<String> logql = ArgumentCaptor.forClass(String.class);
        verify(lokiClient).instantQuery(logql.capture(), any());
        assertThat(logql.getValue())
                .isEqualTo("sum(count_over_time(" + AUDIT + " |~ \"(?i)timeout\"[3600s]))");
    }

    @Test
    void countLogs_throwsRuntimeException_onUnparseableResponse() {
        when(lokiClient.instantQuery(anyString(), any())).thenReturn("not json");

        assertThatThrownBy(() -> logsService.countLogs(null, null, null, null))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Failed to parse Loki count response");
    }

    // --- paging cursor -------------------------------------------------------------

    @Test
    void getRecentLogs_exposesTheNanosecondTimestampAsTheCursor() {
        lokiReturns(streams(stream("1787661302684000000", ACCESS_LINE)));

        LogEntryDto entry = onlyEntry();

        // exact, and a string - this is what gets handed back as endCursor
        assertThat(entry.tsNanos()).isEqualTo("1787661302684000000");
    }

    @Test
    void getRecentLogs_defaultsTheWindowEndToNow_whenNoCursor() {
        lokiReturns(streams());
        long nowNanos = (System.currentTimeMillis() / 1000) * 1_000_000_000L;

        logsService.getRecentLogs(null, null, null, null, null, null);

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

        logsService.getRecentLogs(null, null, null, null, "1787661302684123456", null);

        verify(lokiClient).queryRange(anyString(), anyLong(), eq(1787661302684123456L), anyInt(), anyString());
    }

    @Test
    void getRecentLogs_keepsTheStartOfTheWindow_whenPagingBackwards() {
        lokiReturns(streams());

        logsService.getRecentLogs(null, null, null, 1700000000L, "1787661302684000000", null);

        // start stays pinned to the range the user picked; only the end moves as you page
        verify(lokiClient).queryRange(anyString(), eq(1700000000L * 1_000_000_000L),
                eq(1787661302684000000L), anyInt(), anyString());
    }

    @Test
    void getRecentLogs_rejectsAMalformedCursorAsBadRequest() {
        assertThatThrownBy(() -> logsService.getRecentLogs(null, null, null, null, "not-a-timestamp", null))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("400");
    }

    @Test
    void getRecentLogs_treatsABlankCursorAsAbsent() {
        lokiReturns(streams());
        long nowNanos = (System.currentTimeMillis() / 1000) * 1_000_000_000L;

        logsService.getRecentLogs(null, null, null, null, "   ", null);

        ArgumentCaptor<Long> end = ArgumentCaptor.forClass(Long.class);
        verify(lokiClient).queryRange(anyString(), anyLong(), end.capture(), anyInt(), anyString());
        assertThat(end.getValue()).isBetween(nowNanos, nowNanos + 5_000_000_000L);
    }

    @Test
    void getRecentLogs_appliesSearchAndCursorTogether() {
        lokiReturns(streams());

        logsService.getRecentLogs(null, null, "timeout", null, "1787661302684000000", null);

        verify(lokiClient).queryRange(eq(AUDIT + " |~ \"(?i)timeout\""),
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

        LogPageDto page = logsService.getPage(null, null, null, null, null, 3, 10, null);

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

        logsService.getPage(null, null, null, null, null, 4, 10, null);

        // one round trip, asking for everything down to the end of page 4
        verify(lokiClient).queryRange(anyString(), anyLong(), anyLong(), eq(40), eq("backward"));
    }

    @Test
    void getPage_computesTotalPagesFromTheCount() {
        countReturns(93);
        lokiReturns(numberedStream(25));

        LogPageDto page = logsService.getPage(null, null, null, null, null, 1, 25, null);

        assertThat(page.totalCount()).isEqualTo(93);
        assertThat(page.totalPages()).isEqualTo(4); // ceil(93/25)
        assertThat(page.depthCapped()).isFalse();
    }

    @Test
    void getPage_clampsAPageNumberPastTheEnd() {
        countReturns(30);
        lokiReturns(numberedStream(30));

        // asking for page 99 of 3 lands on 3 rather than erroring or returning nothing
        assertThat(logsService.getPage(null, null, null, null, null, 99, 10, null).page()).isEqualTo(3);
    }

    @Test
    void getPage_treatsAZeroOrNegativePageAsTheFirst() {
        countReturns(30);
        lokiReturns(numberedStream(10));

        assertThat(logsService.getPage(null, null, null, null, null, 0, 10, null).page()).isEqualTo(1);
        assertThat(logsService.getPage(null, null, null, null, null, -5, 10, null).page()).isEqualTo(1);
    }

    @Test
    void getPage_reportsOnePageAndNoRows_whenNothingMatches() {
        countReturns(0);
        lokiReturns(streams());

        LogPageDto page = logsService.getPage(null, null, "nothing-matches-this", null, null, 1, 25, null);

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

        LogPageDto page = logsService.getPage(null, null, null, null, null, 1, 25, null);

        assertThat(page.totalCount()).isEqualTo(50_000);
        assertThat(page.totalPages()).isEqualTo(200);  // 5000 / 25, not 2000
        assertThat(page.depthCapped()).isTrue();
    }

    @Test
    void getPage_pinsTheAnchorSoPagesCannotShift() {
        countReturns(30);
        lokiReturns(numberedStream(20));

        LogPageDto page = logsService.getPage(null, null, null, null, "1787661302684000000", 2, 10, null);

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

        logsService.getPage(null, null, null, null, "1787661302684000000", 1, 10, null);

        verify(lokiClient).instantQuery(anyString(), eq(1787661302684000000L - 1));
    }

    @Test
    void getPage_returnsAFreshAnchor_whenNoneWasGiven() {
        countReturns(5);
        lokiReturns(numberedStream(5));
        long nowNanos = (System.currentTimeMillis() / 1000) * 1_000_000_000L;

        LogPageDto page = logsService.getPage(null, null, null, null, null, 1, 25, null);

        assertThat(Long.parseLong(page.anchor())).isBetween(nowNanos, nowNanos + 5_000_000_000L);
    }

    @Test
    void getPage_appliesTheSearchFilter() {
        countReturns(3);
        lokiReturns(numberedStream(3));

        logsService.getPage(null, null, "timeout", null, null, 1, 25, null);

        verify(lokiClient).queryRange(eq(AUDIT + " |~ \"(?i)timeout\""),
                anyLong(), anyLong(), anyInt(), anyString());
    }

    @Test
    void getPage_walksBackwardByDefault() {
        countReturns(30);
        lokiReturns(numberedStream(10));

        LogPageDto page = logsService.getPage(null, null, null, null, null, 1, 10, null);

        assertThat(page.direction()).isEqualTo("backward");
        verify(lokiClient).queryRange(anyString(), anyLong(), anyLong(), anyInt(), eq("backward"));
    }

    @Test
    void getPage_walksForwardWhenAsked() {
        countReturns(30);
        lokiReturns(numberedStream(10));

        LogPageDto page = logsService.getPage(null, null, null, null, null, 1, 10, "forward");

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

        LogPageDto page = logsService.getPage(null, null, null, null, null, 1, 3, "forward");

        assertThat(page.entries()).extracting(LogEntryDto::raw)
                .containsExactly("line-2", "line-1", "line-0");
    }

    @Test
    void getPage_rejectsAnUnknownDirectionInFavourOfBackward() {
        countReturns(10);
        lokiReturns(numberedStream(10));

        assertThat(logsService.getPage(null, null, null, null, null, 1, 10, "sideways").direction())
                .isEqualTo("backward");
    }

    @Test
    void getPage_fallsBackToADefaultPageSize() {
        countReturns(10);
        lokiReturns(numberedStream(10));

        assertThat(logsService.getPage(null, null, null, null, null, 1, null, null).pageSize()).isEqualTo(25);
        assertThat(logsService.getPage(null, null, null, null, null, 1, 0, null).pageSize()).isEqualTo(25);
    }
}
