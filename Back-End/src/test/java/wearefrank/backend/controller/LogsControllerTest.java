package wearefrank.backend.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import wearefrank.backend.dto.LogEntryDto;
import wearefrank.backend.dto.LogFieldDto;
import wearefrank.backend.dto.LogFieldType;
import wearefrank.backend.dto.MessageVolumeDto;
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

    private static final LogEntryDto AUDIT_ENTRY = new LogEntryDto(
            "audit", "gem-a", "2023-11-14T22:13:20Z", "1700000000000000000", "INFO", "centric", "12",
            "GET", "/anything/x", "apisix", 200, 12.0, "172.18.0.4", "172.18.0.7:8080",
            null, null, null, "0484", "{}");

    private static final LogEntryDto ERROR_ENTRY = new LogEntryDto(
            "error", "gem-b", "2023-11-14T22:13:20Z", "1700000000000000000", "WARN", null, null,
            "GET", "/test/anything", "gw.example.nl", null, null, "109.94.148.130",
            "http://100.65.84.218:80/anything", "d5ea29ea7e7f00b9", "[lua] plugin.lua:898",
            "conf_version(): loaded", null, "2026/08/26 ...");

    @Test
    void getRecentLogs_returnsFlattenedEntries() throws Exception {
        when(logsService.getRecentLogs(null, null, null, null, null, null)).thenReturn(List.of(AUDIT_ENTRY));

        mockMvc.perform(get("/api/logs/recent"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].type").value("audit"))
                .andExpect(jsonPath("$[0].routeName").value("centric"))
                .andExpect(jsonPath("$[0].method").value("GET"))
                .andExpect(jsonPath("$[0].status").value(200))
                .andExpect(jsonPath("$[0].latencyMs").value(12.0))
                // The timestamp has to stay a string - the dashboard renders it directly.
                .andExpect(jsonPath("$[0].timestamp").value("2023-11-14T22:13:20Z"));
    }

    /** The other table's row shape, over the same endpoint. */
    @Test
    void getRecentLogs_returnsTheErrorFields_forTheErrorStream() throws Exception {
        when(logsService.getRecentLogs("error", null, null, null, null, null)).thenReturn(List.of(ERROR_ENTRY));

        mockMvc.perform(get("/api/logs/recent").param("type", "error"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].type").value("error"))
                .andExpect(jsonPath("$[0].level").value("WARN"))
                .andExpect(jsonPath("$[0].module").value("[lua] plugin.lua:898"))
                .andExpect(jsonPath("$[0].message").value("conf_version(): loaded"))
                .andExpect(jsonPath("$[0].requestId").value("d5ea29ea7e7f00b9"));

        verify(logsService).getRecentLogs("error", null, null, null, null, null);
    }

    /** No type means the access log, which is what these endpoints answered before. */
    @Test
    void getRecentLogs_worksWithNoParameters() throws Exception {
        when(logsService.getRecentLogs(null, null, null, null, null, null)).thenReturn(List.of());

        mockMvc.perform(get("/api/logs/recent"))
                .andExpect(status().isOk())
                .andExpect(content().string("[]"));

        verify(logsService).getRecentLogs(null, null, null, null, null, null);
    }

    @Test
    void getRecentLogs_passesQueryStartTimeAndLimit() throws Exception {
        when(logsService.getRecentLogs(null, "{app_name=\"apisix\"}", null, 1700000000L, null, 50))
                .thenReturn(List.of(AUDIT_ENTRY));

        mockMvc.perform(get("/api/logs/recent")
                        .param("query", "{app_name=\"apisix\"}")
                        .param("startTime", "1700000000")
                        .param("limit", "50"))
                .andExpect(status().isOk());

        verify(logsService).getRecentLogs(null, "{app_name=\"apisix\"}", null, 1700000000L, null, 50);
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
    void getPage_passesTheTypeThrough() throws Exception {
        mockMvc.perform(get("/api/logs/page").param("type", "error").param("page", "2"))
                .andExpect(status().isOk());

        verify(logsService).getPage("error", null, null, null, null, 2, null, null, null);
    }

    @Test
    void getPage_passesTheSortThrough() throws Exception {
        mockMvc.perform(get("/api/logs/page")
                        .param("sort", "status")
                        .param("direction", "forward"))
                .andExpect(status().isOk());

        verify(logsService).getPage(null, null, null, null, null, null, null, "forward", "status");
    }

    @Test
    void countLogs_passesTheTypeThrough() throws Exception {
        mockMvc.perform(get("/api/logs/count").param("type", "error"))
                .andExpect(status().isOk());

        verify(logsService).countLogs("error", null, null, null);
    }

    @Test
    void messageVolume_returnsBothWindowsAndTheChange() throws Exception {
        when(logsService.messageVolume(null, null, null, null))
                .thenReturn(new MessageVolumeDto(900, 600, 50.0, 604800, "sum(count_over_time({}[604800s]))"));

        mockMvc.perform(get("/api/logs/volume"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.current").value(900))
                .andExpect(jsonPath("$.previous").value(600))
                .andExpect(jsonPath("$.changePercent").value(50.0))
                .andExpect(jsonPath("$.windowSeconds").value(604800));
    }

    /**
     * The UI branches on this being null to draw "no comparison" rather than a 100% drop,
     * so it has to arrive as null and not as a zero.
     */
    @Test
    void messageVolume_serialisesAnAbsentChangeAsNull() throws Exception {
        when(logsService.messageVolume(null, null, null, null))
                .thenReturn(new MessageVolumeDto(900, 0, null, 604800, "sum(count_over_time({}[604800s]))"));

        mockMvc.perform(get("/api/logs/volume"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.current").value(900))
                .andExpect(jsonPath("$.changePercent").isEmpty());
    }

    @Test
    void messageVolume_passesTypeAndWindowThrough() throws Exception {
        when(logsService.messageVolume("error", null, null, 3600L))
                .thenReturn(new MessageVolumeDto(2, 1, 100.0, 3600, "sum(count_over_time({}[3600s]))"));

        mockMvc.perform(get("/api/logs/volume")
                        .param("type", "error")
                        .param("windowSeconds", "3600"))
                .andExpect(status().isOk());

        verify(logsService).messageVolume("error", null, null, 3600L);
    }

    @Test
    void getFields_passesTheTypeThroughAndReturnsTheDescriptors() throws Exception {
        when(logsService.describeFields("error")).thenReturn(List.of(
                new LogFieldDto("message", "Message", LogFieldType.MESSAGE, true, null),
                new LogFieldDto("latencyMs", "Latency", LogFieldType.DURATION, false, "right")));

        mockMvc.perform(get("/api/logs/fields").param("type", "error"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("message"))
                .andExpect(jsonPath("$[0].label").value("Message"))
                .andExpect(jsonPath("$[0].type").value("MESSAGE"))
                .andExpect(jsonPath("$[0].defaultVisible").value(true))
                // The dashboard reads this as a nullable value, so it has to arrive as null
                // rather than be dropped from the object.
                .andExpect(jsonPath("$[0].align").isEmpty())
                .andExpect(jsonPath("$[1].align").value("right"));

        verify(logsService).describeFields("error");
    }

    @Test
    void logRangeQuery_returnsBodyUnchanged() throws Exception {
        when(logsService.logRangeQuery(null, null, null, null, null, null, null))
                .thenReturn("{\"status\":\"success\"}");

        mockMvc.perform(get("/api/logs/range"))
                .andExpect(status().isOk())
                .andExpect(content().string("{\"status\":\"success\"}"));
    }

    @Test
    void logRangeQuery_passesAllParameters() throws Exception {
        when(logsService.logRangeQuery("error", "{app_name=\"apisix\"}", null, 1700000000L, null, 10, "forward"))
                .thenReturn("range-result");

        mockMvc.perform(get("/api/logs/range")
                        .param("type", "error")
                        .param("query", "{app_name=\"apisix\"}")
                        .param("startTime", "1700000000")
                        .param("limit", "10")
                        .param("direction", "forward"))
                .andExpect(status().isOk())
                .andExpect(content().string("range-result"));

        verify(logsService).logRangeQuery("error", "{app_name=\"apisix\"}", null, 1700000000L, null, 10, "forward");
    }
}
