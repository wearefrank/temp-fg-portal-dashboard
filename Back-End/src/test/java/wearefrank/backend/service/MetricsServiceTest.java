package wearefrank.backend.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import wearefrank.backend.dto.MetricsDto;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MetricsServiceTest {

    private static final String PROMETHEUS_RAW = """
            # HELP apisix_http_requests_total Total requests
            # TYPE apisix_http_requests_total gauge
            apisix_http_requests_total 42
            # HELP apisix_nginx_http_current_connections Current connections
            # TYPE apisix_nginx_http_current_connections gauge
            apisix_nginx_http_current_connections{state="active"} 5
            apisix_nginx_http_current_connections{state="reading"} 1
            apisix_nginx_http_current_connections{state="writing"} 2
            apisix_nginx_http_current_connections{state="waiting"} 3
            # HELP apisix_node_info Node info
            # TYPE apisix_node_info gauge
            apisix_node_info{hostname="node1",version="3.9.0"} 1
            """;

    @Mock
    ApisixClient apisixClient;

    @Mock
    PrometheusClient prometheusClient;

    MetricsService metricsService;

    @BeforeEach
    void setUp() {
        metricsService = new MetricsService(apisixClient, prometheusClient, new ObjectMapper());
    }

    @Test
    void getHealthcheck_delegatesToControlGet() {
        when(apisixClient.controlGet("/v1/healthcheck")).thenReturn("{\"nodes\":[]}");

        String result = metricsService.getHealthcheck();

        assertThat(result).isEqualTo("{\"nodes\":[]}");
        verify(apisixClient).controlGet("/v1/healthcheck");
    }

    @Test
    void getHealthcheck_propagatesException() {
        when(apisixClient.controlGet("/v1/healthcheck")).thenThrow(new RuntimeException("down"));

        assertThatThrownBy(() -> metricsService.getHealthcheck())
                .isInstanceOf(RuntimeException.class)
                .hasMessage("down");
    }

    @Test
    @SuppressWarnings("unchecked")
    void getLiveRoutes_parsesJsonArray() {
        when(apisixClient.controlGet("/v1/routes")).thenReturn("[{\"id\":\"r1\"}]");

        Object result = metricsService.getLiveRoutes();

        assertThat((List<Object>) result).containsExactly(Map.of("id", "r1"));
    }

    @Test
    void getLiveRoutes_throwsOnInvalidJson() {
        when(apisixClient.controlGet("/v1/routes")).thenReturn("not-json");

        assertThatThrownBy(() -> metricsService.getLiveRoutes())
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Failed to parse live routes");
    }

    @Test
    @SuppressWarnings("unchecked")
    void getLiveUpstreams_parsesJsonArray() {
        when(apisixClient.controlGet("/v1/upstreams")).thenReturn("[{\"id\":\"u1\"}]");

        Object result = metricsService.getLiveUpstreams();

        assertThat((List<Object>) result).containsExactly(Map.of("id", "u1"));
    }

    @Test
    void getLiveUpstreams_throwsOnInvalidJson() {
        when(apisixClient.controlGet("/v1/upstreams")).thenReturn("not-json");

        assertThatThrownBy(() -> metricsService.getLiveUpstreams())
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Failed to parse live upstreams");
    }

    @Test
    @SuppressWarnings("unchecked")
    void getLiveServices_parsesJsonArray() {
        when(apisixClient.controlGet("/v1/services")).thenReturn("[{\"id\":\"s1\"}]");

        Object result = metricsService.getLiveServices();

        assertThat((List<Object>) result).containsExactly(Map.of("id", "s1"));
    }

    @Test
    void getLiveServices_throwsOnInvalidJson() {
        when(apisixClient.controlGet("/v1/services")).thenReturn("not-json");

        assertThatThrownBy(() -> metricsService.getLiveServices())
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Failed to parse live services");
    }

    @Test
    void getLiveServices_returnsEmptyList_whenControlApiAnswersWithNonArray() {
        when(apisixClient.controlGet("/v1/services")).thenReturn("{}");

        assertThat(metricsService.getLiveServices()).isEmpty();
    }

    @Test
    void prometheusQuery_delegatesToPrometheusClient() {
        when(prometheusClient.query("up")).thenReturn("{\"status\":\"success\"}");

        String result = metricsService.prometheusQuery("up");

        assertThat(result).isEqualTo("{\"status\":\"success\"}");
        verify(prometheusClient).query("up");
    }

    @Test
    void prometheusRangeQuery_nullStartTime_resolvesToLastHourBeforeNow() {
        ArgumentCaptor<Long> startCaptor = ArgumentCaptor.forClass(Long.class);
        ArgumentCaptor<Long> endCaptor = ArgumentCaptor.forClass(Long.class);
        when(prometheusClient.rangeQuery(eq("up"), startCaptor.capture(), endCaptor.capture(), eq("60")))
                .thenReturn("range-result");

        long before = System.currentTimeMillis() / 1000;
        String result = metricsService.prometheusRangeQuery("up", null, null);
        long after = System.currentTimeMillis() / 1000;

        assertThat(result).isEqualTo("range-result");
        assertThat(endCaptor.getValue()).isBetween(before, after);
        assertThat(startCaptor.getValue()).isEqualTo(endCaptor.getValue() - 3600);
    }

    @Test
    void prometheusRangeQuery_explicitStartTime_isPassedThroughUnchanged() {
        when(prometheusClient.rangeQuery(eq("up"), eq(12345L), anyLong(), eq("30")))
                .thenReturn("range-result");

        String result = metricsService.prometheusRangeQuery("up", 12345L, "30");

        assertThat(result).isEqualTo("range-result");
        verify(prometheusClient).rangeQuery(eq("up"), eq(12345L), anyLong(), eq("30"));
    }

    @Test
    void prometheusRangeQuery_zeroStartTime_resolvesViaTsdbMinTime() {
        when(prometheusClient.getTsdbMinTime()).thenReturn(999L);
        when(prometheusClient.rangeQuery(eq("up"), eq(999L), anyLong(), eq("60")))
                .thenReturn("range-result");

        String result = metricsService.prometheusRangeQuery("up", 0L, null);

        assertThat(result).isEqualTo("range-result");
        verify(prometheusClient).getTsdbMinTime();
        verify(prometheusClient).rangeQuery(eq("up"), eq(999L), anyLong(), eq("60"));
    }

    @Test
    void getPrometheusRaw_delegatesToMetricsGet() {
        when(apisixClient.metricsGet("/apisix/prometheus/metrics")).thenReturn("raw_prom");

        String result = metricsService.getPrometheusRaw();

        assertThat(result).isEqualTo("raw_prom");
        verify(apisixClient).metricsGet("/apisix/prometheus/metrics");
    }

    @Test
    void getPrometheusMetrics_parsesTotalRequests() {
        when(apisixClient.metricsGet("/apisix/prometheus/metrics")).thenReturn(PROMETHEUS_RAW);

        MetricsDto result = metricsService.getPrometheusMetrics();

        assertThat(result.totalRequests()).isEqualTo(42L);
    }

    @Test
    void getPrometheusMetrics_parsesConnectionStates() {
        when(apisixClient.metricsGet("/apisix/prometheus/metrics")).thenReturn(PROMETHEUS_RAW);

        MetricsDto result = metricsService.getPrometheusMetrics();

        assertThat(result.connections()).containsEntry("active", 5L);
        assertThat(result.connections()).containsEntry("reading", 1L);
        assertThat(result.connections()).containsEntry("writing", 2L);
        assertThat(result.connections()).containsEntry("waiting", 3L);
    }

    @Test
    void getPrometheusMetrics_parsesVersionAndHostname() {
        when(apisixClient.metricsGet("/apisix/prometheus/metrics")).thenReturn(PROMETHEUS_RAW);

        MetricsDto result = metricsService.getPrometheusMetrics();

        assertThat(result.version()).isEqualTo("3.9.0");
        assertThat(result.hostname()).isEqualTo("node1");
    }

    @Test
    void getPrometheusMetrics_returnsZero_whenTotalRequestsAbsent() {
        String raw = """
                apisix_nginx_http_current_connections{state="active"} 5
                apisix_node_info{hostname="node1",version="3.9.0"} 1
                """;
        when(apisixClient.metricsGet("/apisix/prometheus/metrics")).thenReturn(raw);

        MetricsDto result = metricsService.getPrometheusMetrics();

        assertThat(result.totalRequests()).isEqualTo(0L);
    }

    @Test
    void getPrometheusMetrics_returnsEmptyMap_whenConnectionsAbsent() {
        String raw = """
                apisix_http_requests_total 42
                apisix_node_info{hostname="node1",version="3.9.0"} 1
                """;
        when(apisixClient.metricsGet("/apisix/prometheus/metrics")).thenReturn(raw);

        MetricsDto result = metricsService.getPrometheusMetrics();

        assertThat(result.connections()).isEmpty();
    }

    @Test
    void getPrometheusMetrics_returnsNullVersionAndHostname_whenNodeInfoAbsent() {
        String raw = """
                apisix_http_requests_total 42
                apisix_nginx_http_current_connections{state="active"} 5
                """;
        when(apisixClient.metricsGet("/apisix/prometheus/metrics")).thenReturn(raw);

        MetricsDto result = metricsService.getPrometheusMetrics();

        assertThat(result.version()).isNull();
        assertThat(result.hostname()).isNull();
    }

    @Test
    void isPrometheusHealthy_delegatesToPrometheusClient() {
        when(prometheusClient.isHealthy()).thenReturn(false);

        assertThat(metricsService.isPrometheusHealthy()).isFalse();

        verify(prometheusClient).isHealthy();
    }

    @Test
    void isPrometheusHealthy_doesNotConsultTheApisixExporter() {
        when(prometheusClient.isHealthy()).thenReturn(true);

        assertThat(metricsService.isPrometheusHealthy()).isTrue();

        verifyNoInteractions(apisixClient);
    }
}
