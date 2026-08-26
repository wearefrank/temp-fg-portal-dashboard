package wearefrank.backend.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import wearefrank.backend.dto.LogEntryDto;
import wearefrank.backend.service.LogsService;

import java.util.List;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(LogsController.class)
class LogsControllerTest {

    @Autowired
    MockMvc mockMvc;

    @MockitoBean
    LogsService logsService;

    private static final LogEntryDto ENTRY = new LogEntryDto(
            "2023-11-14T22:13:20Z", "1700000000000000000", "INFO", "centric", "12", "GET", "/anything/x", "apisix",
            200, 12.0, "172.18.0.4", "172.18.0.7:8080", "{}");

    @Test
    void getRecentLogs_returnsFlattenedEntries() throws Exception {
        when(logsService.getRecentLogs(null, null, null, null, null)).thenReturn(List.of(ENTRY));

        mockMvc.perform(get("/api/logs/recent"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].routeName").value("centric"))
                .andExpect(jsonPath("$[0].method").value("GET"))
                .andExpect(jsonPath("$[0].status").value(200))
                .andExpect(jsonPath("$[0].latencyMs").value(12.0))
                // The timestamp has to stay a string - the dashboard renders it directly.
                .andExpect(jsonPath("$[0].timestamp").value("2023-11-14T22:13:20Z"));
    }

    @Test
    void getRecentLogs_worksWithNoParameters() throws Exception {
        when(logsService.getRecentLogs(null, null, null, null, null)).thenReturn(List.of());

        mockMvc.perform(get("/api/logs/recent"))
                .andExpect(status().isOk())
                .andExpect(content().string("[]"));

        verify(logsService).getRecentLogs(null, null, null, null, null);
    }

    @Test
    void getRecentLogs_passesQueryStartTimeAndLimit() throws Exception {
        when(logsService.getRecentLogs("{app_name=\"apisix\"}", null, 1700000000L, null, 50)).thenReturn(List.of(ENTRY));

        mockMvc.perform(get("/api/logs/recent")
                        .param("query", "{app_name=\"apisix\"}")
                        .param("startTime", "1700000000")
                        .param("limit", "50"))
                .andExpect(status().isOk());

        verify(logsService).getRecentLogs("{app_name=\"apisix\"}", null, 1700000000L, null, 50);
    }

    /**
     * 502 rather than 400 is the whole application's behaviour, not this controller's:
     * GlobalExceptionHandler maps every RuntimeException to BAD_GATEWAY, and Spring's
     * type-mismatch exception is one. Asserted so a later fix to that handler shows up
     * here instead of silently changing what the endpoint returns.
     */
    @Test
    void getRecentLogs_returns502_whenLimitNotANumber() throws Exception {
        mockMvc.perform(get("/api/logs/recent").param("limit", "many"))
                .andExpect(status().isBadGateway());
    }

    @Test
    void logRangeQuery_returnsBodyUnchanged() throws Exception {
        when(logsService.logRangeQuery(null, null, null, null, null, null)).thenReturn("{\"status\":\"success\"}");

        mockMvc.perform(get("/api/logs/range"))
                .andExpect(status().isOk())
                .andExpect(content().string("{\"status\":\"success\"}"));
    }

    @Test
    void logRangeQuery_passesAllParameters() throws Exception {
        when(logsService.logRangeQuery("{app_name=\"apisix\"}", null, 1700000000L, null, 10, "forward"))
                .thenReturn("range-result");

        mockMvc.perform(get("/api/logs/range")
                        .param("query", "{app_name=\"apisix\"}")
                        .param("startTime", "1700000000")
                        .param("limit", "10")
                        .param("direction", "forward"))
                .andExpect(status().isOk())
                .andExpect(content().string("range-result"));

        verify(logsService).logRangeQuery("{app_name=\"apisix\"}", null, 1700000000L, null, 10, "forward");
    }
}
