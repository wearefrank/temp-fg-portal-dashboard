package wearefrank.backend.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;
import wearefrank.backend.dto.RouteSeriesDto;
import wearefrank.backend.dto.RouteStatsDto;
import wearefrank.backend.dto.RouteStatsResultDto;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RouteStatsServiceTest {

    @Mock
    LokiClient lokiClient;

    @Mock
    ApisixClient apisixClient;

    RouteStatsService service;

    /** LOKI_RETENTION_HOURS' default - 336h, two weeks. */
    private static final long DEFAULT_RETENTION_HOURS = 336L;

    /**
     * Every test pins the window to an anchor rather than letting it hang off now, so the
     * bucket grid is the same on every run and a fixture can name the slot it lands in.
     *
     * A multiple of 86400, and so of every step on the ladder - the grid is snapped to the
     * step, and an anchor that needed snapping would move the slots out from under the
     * fixtures. {@code anchor_snapsBackToTheStepBoundary} covers the case where it does.
     */
    private static final long ANCHOR_SEC = 1_699_920_000L;
    private static final String ANCHOR = String.valueOf(ANCHOR_SEC * 1_000_000_000L);

    /** A window of 60s lands on 15s buckets - four of them, small enough to assert on whole. */
    private static final long TINY_WINDOW = 60L;

    private static final String EMPTY_MATRIX = matrix();
    private static final String EMPTY_VECTOR = vector();

    @BeforeEach
    void setUp() {
        service = new RouteStatsService(lokiClient, apisixClient,
                new LokiScope("", "namespace", DEFAULT_RETENTION_HOURS),
                new ObjectMapper().findAndRegisterModules());
    }

    private RouteStatsService pinnedTo(String namespace) {
        return new RouteStatsService(lokiClient, apisixClient,
                new LokiScope(namespace, "namespace", DEFAULT_RETENTION_HOURS),
                new ObjectMapper().findAndRegisterModules());
    }

    // --- fixtures ------------------------------------------------------------------

    /** What a bucketed count query answers with: one entry per series, each a list of points. */
    private static String matrix(String... series) {
        return "{\"status\":\"success\",\"data\":{\"resultType\":\"matrix\",\"result\":["
                + String.join(",", series) + "]}}";
    }

    /** What the latency query answers with: one number per series. */
    private static String vector(String... series) {
        return "{\"status\":\"success\",\"data\":{\"resultType\":\"vector\",\"result\":["
                + String.join(",", series) + "]}}";
    }

    private static String sample(String labels, String value) {
        return "{\"metric\":" + labels + ",\"value\":[1700000000,\"" + value + "\"]}";
    }

    /** One matrix series, from alternating timestamp and count arguments. */
    private static String seriesAt(String labels, long... tsThenCount) {
        StringBuilder sb = new StringBuilder("{\"metric\":" + labels + ",\"values\":[");
        for (int i = 0; i < tsThenCount.length; i += 2) {
            if (i > 0) sb.append(",");
            sb.append("[").append(tsThenCount[i]).append(",\"").append(tsThenCount[i + 1]).append("\"]");
        }
        return sb.append("]}").toString();
    }

    private static String labels(String routeId, String routeName, String status) {
        return "{\"route_id\":\"" + routeId + "\",\"route_name\":\"" + routeName
                + "\",\"status\":\"" + status + "\"}";
    }

    /** A series whose whole count falls in the last bucket, which every window ends on. */
    private static String counted(String routeId, String routeName, String status, long count) {
        return seriesAt(labels(routeId, routeName, status), ANCHOR_SEC, count);
    }

    /** What the control API answers: the route objects wrapped in {key, value} pairs. */
    private static String routes(String... values) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < values.length; i++) {
            if (i > 0) sb.append(",");
            sb.append("{\"key\":\"/apisix/routes/").append(i).append("\",\"value\":").append(values[i]).append("}");
        }
        return sb.append("]").toString();
    }

    private void lokiReturns(String counts, String latency) {
        when(lokiClient.metricRangeQuery(anyString(), anyLong(), anyLong(), anyLong())).thenReturn(counts);
        when(lokiClient.instantQuery(anyString(), any())).thenReturn(latency);
    }

    private void controlApiReturns(String body) {
        when(apisixClient.controlGet("/v1/routes")).thenReturn(body);
    }

    private void controlApiIsDown() {
        when(apisixClient.controlGet(anyString())).thenThrow(new RuntimeException("connection refused"));
    }

    /** The window every test asks for unless it cares about the window itself. */
    private RouteStatsResultDto stats() {
        return service.routeStats(3600L, ANCHOR, null);
    }

    private static RouteStatsDto route(RouteStatsResultDto result, String routeId) {
        return result.routes().stream()
                .filter(r -> routeId.equals(r.routeId()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no row for route " + routeId
                        + " in " + result.routes().stream().map(RouteStatsDto::routeId).toList()));
    }

    private static RouteSeriesDto series(RouteStatsResultDto result, String routeId, String status) {
        return result.series().stream()
                .filter(s -> routeId.equals(s.routeId()) && status.equals(s.status()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no series for " + routeId + "/" + status));
    }

    // --- the queries ---------------------------------------------------------------

    /**
     * The range selector is the step, so consecutive buckets count adjacent spans - which is
     * what lets the table's totals be summed from the chart's points.
     */
    @Test
    void countQuery_groupsByRouteAndStatusOverOneStep() {
        assertThat(service.countQuery("{app_name=\"apisix\", log_type=\"audit\"}", 3600))
                .isEqualTo("sum by (route_id, route_name, status) (count_over_time("
                        + "{app_name=\"apisix\", log_type=\"audit\"}"
                        + " | json route_id=\"audit.route_id\", route_name=\"route_name\", status=\"response.status\""
                        + " [3600s]))");
    }

    /** Explicit json expressions - a bare `| json` would label every key of the record. */
    @Test
    void countQuery_namesTheFieldsItParsesRatherThanParsingEverything() {
        assertThat(service.countQuery("{}", 60)).doesNotContain("| json [");
        assertThat(service.countQuery("{}", 60)).contains("| json route_id=");
    }

    @Test
    void latencyQuery_dropsUnproxiedRequestsAndKeepsTheFirstUpstreamTime() {
        String query = service.latencyQuery("{app_name=\"apisix\"}", 604800);
        assertThat(query)
                .startsWith("avg_over_time({app_name=\"apisix\"}")
                .contains(" | latency != \"\" | latency != \"-\"")
                .contains("regexReplaceAllLiteral \",.*\" .latency \"\"")
                .contains(" | unwrap latency | __error__=\"\"")
                .endsWith(" [604800s]) by (route_id)");
    }

    /** Both queries go through LokiScope, so LOKI_NAMESPACE pins them like everything else. */
    @Test
    void bothQueriesArePinnedToTheConfiguredNamespace() {
        lokiReturns(EMPTY_MATRIX, EMPTY_VECTOR);
        controlApiReturns("[]");

        RouteStatsResultDto result = pinnedTo("acceptance").routeStats(3600L, ANCHOR, null);

        assertThat(result.countQuery()).contains("{namespace=\"acceptance\", app_name=\"apisix\", log_type=\"audit\"}");
        assertThat(result.latencyQuery()).contains("{namespace=\"acceptance\", app_name=\"apisix\", log_type=\"audit\"}");
    }

    @Test
    void search_narrowsWhichTrafficCounts() {
        lokiReturns(EMPTY_MATRIX, EMPTY_VECTOR);
        controlApiReturns("[]");

        RouteStatsResultDto result = service.routeStats(3600L, ANCHOR, "timeout");

        assertThat(result.countQuery()).contains("|~ \"(?i)timeout\"");
    }

    // --- the bucket grid -----------------------------------------------------------

    /** Round bucket widths, and enough of them to see an hour-long outage inside a week. */
    @Test
    void step_isTheFinestThatKeepsTheBucketCountReasonable() {
        assertThat(service.resolveStep(60)).isEqualTo(15);
        assertThat(service.resolveStep(3600)).isEqualTo(30);
        assertThat(service.resolveStep(86400)).isEqualTo(600);
        // A week on hourly buckets, which is also the span people describe outages in.
        assertThat(service.resolveStep(604800)).isEqualTo(3600);
        assertThat(service.resolveStep(DEFAULT_RETENTION_HOURS * 3600)).isEqualTo(7200);
    }

    @Test
    void buckets_tileTheWindowAndEndOnTheAnchor() {
        lokiReturns(EMPTY_MATRIX, EMPTY_VECTOR);
        controlApiReturns("[]");

        RouteStatsResultDto result = service.routeStats(TINY_WINDOW, ANCHOR, null);

        assertThat(result.stepSeconds()).isEqualTo(15);
        assertThat(result.windowSeconds()).isEqualTo(60);
        assertThat(result.bucketTimes()).containsExactly(
                ANCHOR_SEC - 45, ANCHOR_SEC - 30, ANCHOR_SEC - 15, ANCHOR_SEC);
    }

    /**
     * A part-bucket at the old end would be drawn the same width as a full one and read as a
     * dip in traffic, so the window is rounded up to whole buckets and says so.
     */
    @Test
    void buckets_roundTheWindowUpRatherThanLeavingAPartOne() {
        lokiReturns(EMPTY_MATRIX, EMPTY_VECTOR);
        controlApiReturns("[]");

        RouteStatsResultDto result = service.routeStats(50L, ANCHOR, null);

        assertThat(result.stepSeconds()).isEqualTo(15);
        assertThat(result.bucketTimes()).hasSize(4);
        assertThat(result.windowSeconds()).isEqualTo(60);
    }

    /**
     * Loki snaps its evaluation points to absolute multiples of the step whatever start it
     * is given, so the grid has to be snapped the same way. Left unaligned, its points fall
     * between these slots: the oldest bucket counts traffic from before the window and the
     * newest can land past the end and be thrown away.
     */
    @Test
    void anchor_snapsBackToTheStepBoundary() {
        lokiReturns(EMPTY_MATRIX, EMPTY_VECTOR);
        controlApiReturns("[]");

        // Seven seconds past a 15s boundary, which is where the grid must land.
        long unaligned = ANCHOR_SEC + 7;
        RouteStatsResultDto result = service.routeStats(
                TINY_WINDOW, String.valueOf(unaligned * 1_000_000_000L), null);

        assertThat(result.bucketTimes()).containsExactly(
                ANCHOR_SEC - 45, ANCHOR_SEC - 30, ANCHOR_SEC - 15, ANCHOR_SEC);
    }

    /** Snapping never rounds forward - a bucket still in progress is not drawn as a whole one. */
    @Test
    void anchor_neverSnapsPastTheInstantAskedFor() {
        lokiReturns(EMPTY_MATRIX, EMPTY_VECTOR);
        controlApiReturns("[]");

        RouteStatsResultDto result = service.routeStats(
                TINY_WINDOW, String.valueOf((ANCHOR_SEC + 14) * 1_000_000_000L), null);

        assertThat(result.bucketTimes().getLast()).isEqualTo(ANCHOR_SEC);
    }

    /** The query has to ask one step in from the edge, or the first bucket reaches behind it. */
    @Test
    void theRangeQueryStartsOneStepInsideTheWindow() {
        lokiReturns(EMPTY_MATRIX, EMPTY_VECTOR);
        controlApiReturns("[]");

        service.routeStats(TINY_WINDOW, ANCHOR, null);

        ArgumentCaptor<Long> start = ArgumentCaptor.forClass(Long.class);
        ArgumentCaptor<Long> end = ArgumentCaptor.forClass(Long.class);
        verify(lokiClient).metricRangeQuery(anyString(), start.capture(), end.capture(), eq(15L));
        assertThat(start.getValue()).isEqualTo((ANCHOR_SEC - 45) * 1_000_000_000L);
        assertThat(end.getValue()).isEqualTo(ANCHOR_SEC * 1_000_000_000L);
    }

    // --- the series ----------------------------------------------------------------

    /**
     * Loki sends no sample for a bucket that matched nothing. Left as gaps the chart would
     * join the last request before a silence to the first one after it, drawing a steady line
     * across exactly the outage the panel exists to show.
     */
    @Test
    void series_areZeroFilledOntoTheWholeGrid() {
        lokiReturns(matrix(seriesAt(labels("centric", "centric", "200"),
                ANCHOR_SEC - 45, 7, ANCHOR_SEC, 3)), EMPTY_VECTOR);
        controlApiReturns("[]");

        RouteStatsResultDto result = service.routeStats(TINY_WINDOW, ANCHOR, null);

        assertThat(series(result, "centric", "200").counts()).containsExactly(7L, 0L, 0L, 3L);
    }

    /** The whole point of one query for both: the table's total is the chart's points added up. */
    @Test
    void theTotalIsTheSumOfTheBuckets() {
        lokiReturns(matrix(seriesAt(labels("centric", "centric", "200"),
                ANCHOR_SEC - 45, 7, ANCHOR_SEC - 15, 5, ANCHOR_SEC, 3)), EMPTY_VECTOR);
        controlApiReturns("[]");

        RouteStatsResultDto result = service.routeStats(TINY_WINDOW, ANCHOR, null);

        assertThat(route(result, "centric").total()).isEqualTo(15);
        assertThat(series(result, "centric", "200").counts()).containsExactly(7L, 0L, 5L, 3L);
    }

    /** A timestamp a fraction off a boundary still belongs to the bucket it is nearest. */
    @Test
    void series_snapAPointToItsNearestBucket() {
        lokiReturns(matrix("{\"metric\":" + labels("centric", "centric", "200")
                + ",\"values\":[[" + (ANCHOR_SEC - 30.4) + ",\"9\"]]}"), EMPTY_VECTOR);
        controlApiReturns("[]");

        RouteStatsResultDto result = service.routeStats(TINY_WINDOW, ANCHOR, null);

        assertThat(series(result, "centric", "200").counts()).containsExactly(0L, 9L, 0L, 0L);
    }

    @Test
    void series_ignoreAPointOutsideTheGrid() {
        lokiReturns(matrix(seriesAt(labels("centric", "centric", "200"),
                ANCHOR_SEC - 6000, 99, ANCHOR_SEC, 4)), EMPTY_VECTOR);
        controlApiReturns("[]");

        RouteStatsResultDto result = service.routeStats(TINY_WINDOW, ANCHOR, null);

        assertThat(series(result, "centric", "200").counts()).containsExactly(0L, 0L, 0L, 4L);
        assertThat(route(result, "centric").total()).isEqualTo(4);
    }

    // --- folding the counts --------------------------------------------------------

    @Test
    void foldsStatusCodesIntoClassesAndKeepsTheBreakdown() {
        lokiReturns(matrix(
                counted("centric", "centric", "200", 90),
                counted("centric", "centric", "204", 10),
                counted("centric", "centric", "401", 5),
                counted("centric", "centric", "500", 5)
        ), EMPTY_VECTOR);
        controlApiReturns("[]");

        RouteStatsDto row = route(stats(), "centric");

        assertThat(row.total()).isEqualTo(110);
        assertThat(row.success()).isEqualTo(100);
        assertThat(row.clientError()).isEqualTo(5);
        assertThat(row.serverError()).isEqualTo(5);
        assertThat(row.byStatus()).isEqualTo(Map.of("200", 90L, "204", 10L, "401", 5L, "500", 5L));
    }

    /** 5xx and 4xx are reported apart - a route turning callers away is not a route failing. */
    @Test
    void ratesSplitServerErrorsFromClientErrors() {
        lokiReturns(matrix(
                counted("centric", "centric", "200", 50),
                counted("centric", "centric", "403", 30),
                counted("centric", "centric", "502", 20)
        ), EMPTY_VECTOR);
        controlApiReturns("[]");

        RouteStatsDto row = route(stats(), "centric");

        assertThat(row.errorRatePercent()).isEqualTo(20.0);
        assertThat(row.clientErrorRatePercent()).isEqualTo(30.0);
    }

    /** No traffic is no rate. Zero would read as "no errors", which is a different claim. */
    @Test
    void aRouteWithNoTrafficHasNoErrorRate() {
        lokiReturns(EMPTY_MATRIX, EMPTY_VECTOR);
        controlApiReturns(routes("{\"id\":\"quiet\",\"uri\":\"/quiet\",\"status\":1}"));

        RouteStatsDto row = route(stats(), "quiet");

        assertThat(row.total()).isZero();
        assertThat(row.errorRatePercent()).isNull();
        assertThat(row.clientErrorRatePercent()).isNull();
        assertThat(row.avgLatencyMs()).isNull();
    }

    /** A code outside the classes still has to reach the total, or the columns disagree. */
    @Test
    void anUnclassifiedStatusStillCountsTowardsTheTotal() {
        lokiReturns(matrix(
                counted("centric", "centric", "200", 3),
                seriesAt("{\"route_id\":\"centric\"}", ANCHOR_SEC, 2)
        ), EMPTY_VECTOR);
        controlApiReturns("[]");

        RouteStatsDto row = route(stats(), "centric");

        assertThat(row.total()).isEqualTo(5);
        assertThat(row.success()).isEqualTo(3);
    }

    // --- latency -------------------------------------------------------------------

    @Test
    void latencyIsScaledFromSecondsToMilliseconds() {
        lokiReturns(matrix(counted("centric", "centric", "200", 1)),
                vector(sample("{\"route_id\":\"centric\"}", "0.0125")));
        controlApiReturns("[]");

        assertThat(route(stats(), "centric").avgLatencyMs()).isEqualTo(12.5);
    }

    /** Loki answers NaN for an average with nothing under it; that is not a measurement. */
    @Test
    void latencyIgnoresNaN() {
        lokiReturns(matrix(counted("centric", "centric", "401", 4)),
                vector(sample("{\"route_id\":\"centric\"}", "NaN")));
        controlApiReturns("[]");

        assertThat(route(stats(), "centric").avgLatencyMs()).isNull();
    }

    /**
     * Latency is measured over the span the counts cover, not over the span that was asked
     * for - otherwise the column describes traffic the row beside it does not.
     */
    @Test
    void latencyIsEvaluatedAtTheSameAlignedInstantAsTheCounts() {
        lokiReturns(EMPTY_MATRIX, EMPTY_VECTOR);
        controlApiReturns("[]");

        stats();

        ArgumentCaptor<Long> evalNanos = ArgumentCaptor.forClass(Long.class);
        verify(lokiClient).instantQuery(contains("avg_over_time"), evalNanos.capture());
        assertThat(evalNanos.getValue()).isEqualTo(ANCHOR_SEC * 1_000_000_000L);
    }

    // --- the window ----------------------------------------------------------------

    @Test
    void window_defaultsToAnHourAndZeroMeansTheRetentionSpan() {
        lokiReturns(EMPTY_MATRIX, EMPTY_VECTOR);
        controlApiReturns("[]");

        assertThat(service.routeStats(null, ANCHOR, null).windowSeconds()).isEqualTo(3600);
        assertThat(service.routeStats(0L, ANCHOR, null).windowSeconds())
                .isEqualTo(DEFAULT_RETENTION_HOURS * 3600);
    }

    @Test
    void window_rejectsANegativeSpan() {
        assertThatThrownBy(() -> service.routeStats(-1L, ANCHOR, null))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("windowSeconds");
    }

    @Test
    void anchor_mustBeANanosecondTimestamp() {
        assertThatThrownBy(() -> service.routeStats(3600L, "yesterday", null))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("anchor");
    }

    // --- joining the config --------------------------------------------------------

    /** The log cannot show a route nobody called; the control API is the only source for it. */
    @Test
    void aConfiguredRouteWithNoTrafficStillGetsARow() {
        lokiReturns(EMPTY_MATRIX, EMPTY_VECTOR);
        controlApiReturns(routes("{\"id\":\"quiet\",\"name\":\"quiet-route\",\"uri\":\"/quiet\",\"status\":1}"));

        RouteStatsDto row = route(stats(), "quiet");

        assertThat(row.configured()).isTrue();
        assertThat(row.live()).isTrue();
        assertThat(row.uri()).isEqualTo("/quiet");
        assertThat(row.routeName()).isEqualTo("quiet-route");
    }

    @Test
    void aDisabledRouteIsNotLive() {
        lokiReturns(EMPTY_MATRIX, EMPTY_VECTOR);
        controlApiReturns(routes("{\"id\":\"off\",\"uri\":\"/off\",\"status\":0}"));

        assertThat(route(stats(), "off").live()).isFalse();
    }

    /** APISIX defaults status to 1, so a route that does not carry one is enabled. */
    @Test
    void aRouteWithoutAStatusIsLive() {
        lokiReturns(EMPTY_MATRIX, EMPTY_VECTOR);
        controlApiReturns(routes("{\"id\":\"plain\",\"uri\":\"/plain\"}"));

        assertThat(route(stats(), "plain").live()).isTrue();
    }

    /** Traffic for a route since removed from the config - worth a row, not worth a Live dot. */
    @Test
    void trafficForAnUnknownRouteIsShownAsUnconfigured() {
        lokiReturns(matrix(counted("gone", "gone", "200", 7)), EMPTY_VECTOR);
        controlApiReturns("[]");

        RouteStatsDto row = route(stats(), "gone");

        assertThat(row.configured()).isFalse();
        assertThat(row.live()).isNull();
        assertThat(row.total()).isEqualTo(7);
    }

    /** Requests that matched no route at all - where the 404s live. */
    @Test
    void trafficThatMatchedNoRouteGetsItsOwnRow() {
        lokiReturns(matrix(seriesAt("{\"status\":\"404\"}", ANCHOR_SEC, 12)), EMPTY_VECTOR);
        controlApiReturns("[]");

        RouteStatsDto row = route(stats(), "");

        assertThat(row.clientError()).isEqualTo(12);
        assertThat(row.configured()).isFalse();
    }

    /** The config's name is the current one; the log's is whatever it was called back then. */
    @Test
    void theConfiguredNameWinsOverTheLoggedOne() {
        lokiReturns(matrix(counted("centric", "old-name", "200", 1)), EMPTY_VECTOR);
        controlApiReturns(routes("{\"id\":\"centric\",\"name\":\"new-name\",\"uri\":\"/clo\"}"));

        assertThat(route(stats(), "centric").routeName()).isEqualTo("new-name");
    }

    /** An unnamed route logs "-", which is nginx for "never set" rather than a name. */
    @Test
    void aDashIsNotARouteName() {
        lokiReturns(matrix(counted("centric", "-", "200", 1)), EMPTY_VECTOR);
        controlApiReturns("[]");

        assertThat(route(stats(), "centric").routeName()).isNull();
    }

    @Test
    void busiestRouteComesFirst() {
        lokiReturns(matrix(
                counted("quiet", "quiet", "200", 1),
                counted("busy", "busy", "200", 99)
        ), EMPTY_VECTOR);
        controlApiReturns("[]");

        assertThat(stats().routes())
                .extracting(RouteStatsDto::routeId)
                .containsExactly("busy", "quiet");
    }

    /** Half an answer beats none: the counts are Loki's and stay correct without APISIX. */
    @Test
    void theCountsSurviveTheControlApiBeingDown() {
        lokiReturns(matrix(counted("centric", "centric", "200", 4)), EMPTY_VECTOR);
        controlApiIsDown();

        RouteStatsResultDto result = stats();

        assertThat(result.routesUnavailable()).isTrue();
        assertThat(route(result, "centric").total()).isEqualTo(4);
        assertThat(route(result, "centric").live()).isNull();
    }

    // --- caching -------------------------------------------------------------------

    /**
     * Every open dashboard refreshes on its own timer, and a window days wide does not move
     * in half a minute - so the second ask inside the TTL is answered without touching Loki.
     */
    @Test
    void repeatedAsksForTheSameWindowShareOneQuery() {
        lokiReturns(matrix(counted("centric", "centric", "200", 4)), EMPTY_VECTOR);
        controlApiReturns("[]");

        service.routeStats(604800L, ANCHOR, null);
        RouteStatsResultDto second = service.routeStats(604800L, ANCHOR, null);

        assertThat(route(second, "centric").total()).isEqualTo(4);
        verify(lokiClient, times(1)).metricRangeQuery(anyString(), anyLong(), anyLong(), anyLong());
    }

    /**
     * Half a bucket, so a cached answer is never more than half a bar out of date - and the
     * long reuse lands on the windows that cost something to build. A flat value equal to the
     * dashboard's own 30s tick was the one that could not work: the entry had always just
     * expired when the tick arrived, so every refresh missed.
     */
    @Test
    void cacheTtl_isHalfABucket_flooredAndCapped() {
        long now = 1_700_000_000_000L;

        // 15s buckets. Half of that is below the floor, and a window this cheap is better
        // answered fresh than remembered.
        assertThat(service.cacheTtlMillis(300, null, now)).isEqualTo(10_000);
        // 6 hours buckets at 120s.
        assertThat(service.cacheTtlMillis(21600, null, now)).isEqualTo(60_000);
        // A week buckets hourly; half of that is far past the cap.
        assertThat(service.cacheTtlMillis(604800, null, now)).isEqualTo(120_000);
    }

    /** It cannot answer differently however often it is asked, so it is held far longer. */
    @Test
    void cacheTtl_isLongForAWindowThatHasClosedAndSettled() {
        long now = 1_700_000_000_000L;
        long anchorNanos = (now - 10 * 60_000L) * 1_000_000L;

        assertThat(service.cacheTtlMillis(604800, anchorNanos, now)).isEqualTo(30 * 60_000L);
    }

    /** The gateway batches before pushing, so a window that just closed can still gain lines. */
    @Test
    void cacheTtl_treatsAJustClosedWindowAsStillMoving() {
        long now = 1_700_000_000_000L;
        long anchorNanos = (now - 60_000L) * 1_000_000L;

        assertThat(service.cacheTtlMillis(604800, anchorNanos, now)).isEqualTo(120_000);
    }

    @Test
    void aDifferentWindowIsADifferentQuestion() {
        lokiReturns(EMPTY_MATRIX, EMPTY_VECTOR);
        controlApiReturns("[]");

        service.routeStats(3600L, ANCHOR, null);
        service.routeStats(604800L, ANCHOR, null);

        verify(lokiClient, times(2)).metricRangeQuery(anyString(), anyLong(), anyLong(), anyLong());
    }

    /** The series ride along in the cached answer rather than being rebuilt from nothing. */
    @Test
    void aCachedAnswerStillCarriesItsSeries() {
        lokiReturns(matrix(counted("centric", "centric", "200", 4)), EMPTY_VECTOR);
        controlApiReturns("[]");

        service.routeStats(TINY_WINDOW, ANCHOR, null);
        RouteStatsResultDto second = service.routeStats(TINY_WINDOW, ANCHOR, null);

        assertThat(second.bucketTimes()).hasSize(4);
        assertThat(series(second, "centric", "200").counts()).containsExactly(0L, 0L, 0L, 4L);
    }

    /** A series list that never grew a point is still a list, not a null the browser trips on. */
    @Test
    void noTrafficMeansNoSeriesRatherThanNoGrid() {
        lokiReturns(EMPTY_MATRIX, EMPTY_VECTOR);
        controlApiReturns("[]");

        RouteStatsResultDto result = service.routeStats(TINY_WINDOW, ANCHOR, null);

        assertThat(result.series()).isEmpty();
        assertThat(result.bucketTimes()).hasSize(4);
    }
}
