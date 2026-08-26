package wearefrank.backend.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import wearefrank.backend.dto.MetricsDto;
import wearefrank.backend.service.MetricsService;

import java.util.List;
import java.util.Map;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(MetricsController.class)
class MetricsControllerTest {

    @Autowired
    MockMvc mockMvc;

    @MockitoBean
    MetricsService metricsService;

    @Test
    void getHealthcheck_returns200WithBody() throws Exception {
        when(metricsService.getHealthcheck()).thenReturn("{\"nodes\":[]}");

        mockMvc.perform(get("/api/metrics/health"))
                .andExpect(status().isOk())
                .andExpect(content().string("{\"nodes\":[]}"));
    }

    @Test
    void prometheusQuery_passesQueryParam() throws Exception {
        when(metricsService.prometheusQuery("up")).thenReturn("{\"status\":\"success\"}");

        mockMvc.perform(get("/api/metrics/prom-query").param("query", "up"))
                .andExpect(status().isOk())
                .andExpect(content().string("{\"status\":\"success\"}"));

        verify(metricsService).prometheusQuery("up");
    }

    @Test
    void prometheusQuery_returns400_whenQueryParamMissing() throws Exception {
        mockMvc.perform(get("/api/metrics/prom-query"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void prometheusRangeQuery_passesQueryParam() throws Exception {
        when(metricsService.prometheusRangeQuery("up", null, null)).thenReturn("range-result");

        mockMvc.perform(get("/api/metrics/prom-range").param("query", "up"))
                .andExpect(status().isOk())
                .andExpect(content().string("range-result"));

        verify(metricsService).prometheusRangeQuery("up", null, null);
    }

    @Test
    void prometheusRangeQuery_returns400_whenQueryParamMissing() throws Exception {
        mockMvc.perform(get("/api/metrics/prom-range"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void getPrometheusRaw_returns200() throws Exception {
        when(metricsService.getPrometheusRaw()).thenReturn("prom_text 1");

        mockMvc.perform(get("/api/metrics/prometheus/raw"))
                .andExpect(status().isOk())
                .andExpect(content().string("prom_text 1"));
    }

    @Test
    void getPrometheusMetrics_returns200WithParsedDto() throws Exception {
        MetricsDto dto = new MetricsDto(42L, Map.of("active", 5L), "3.9.0", "node1");
        when(metricsService.getPrometheusMetrics()).thenReturn(dto);

        mockMvc.perform(get("/api/metrics/prometheus"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalRequests").value(42))
                .andExpect(jsonPath("$.connections.active").value(5))
                .andExpect(jsonPath("$.version").value("3.9.0"))
                .andExpect(jsonPath("$.hostname").value("node1"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void getLiveRoutes_returns200WithParsedObject() throws Exception {
        when(metricsService.getLiveRoutes()).thenReturn(List.of(Map.of("id", "r1")));

        mockMvc.perform(get("/api/metrics/routes"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("r1"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void getLiveUpstreams_returns200WithParsedObject() throws Exception {
        when(metricsService.getLiveUpstreams()).thenReturn(List.of(Map.of("id", "u1")));

        mockMvc.perform(get("/api/metrics/upstreams"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("u1"));
    }

    @Test
    void getPrometheusHealth_returnsTrue_whenPrometheusIsReachable() throws Exception {
        when(metricsService.isPrometheusHealthy()).thenReturn(true);

        mockMvc.perform(get("/api/metrics/prometheus/health"))
                .andExpect(status().isOk())
                .andExpect(content().string("true"));
    }

    @Test
    void getPrometheusHealth_returnsFalse_whenPrometheusIsDown() throws Exception {
        when(metricsService.isPrometheusHealthy()).thenReturn(false);

        mockMvc.perform(get("/api/metrics/prometheus/health"))
                .andExpect(status().isOk())
                .andExpect(content().string("false"));
    }
}
