package wearefrank.backend.controller;

import org.springframework.web.bind.annotation.*;
import wearefrank.backend.dto.LogCountDto;
import wearefrank.backend.dto.LogEntryDto;
import wearefrank.backend.dto.LogPageDto;
import wearefrank.backend.service.LogsService;

import java.util.List;

/**
 * Loki's counterpart to the Prometheus endpoints on {@link MetricsController}: /range is
 * the raw passthrough to build new panels against, /recent is the flattened form the
 * dashboard's log table renders.
 */
@RestController
@RequestMapping("/api/logs")
@CrossOrigin(origins = "http://localhost:5173")
public class LogsController {

    private final LogsService logsService;

    public LogsController(LogsService logsService) {
        this.logsService = logsService;
    }

    @GetMapping("/recent")
    public List<LogEntryDto> getRecentLogs(
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Long startTime,
            // Oldest tsNanos of the previous page. A string, because a nanosecond timestamp
            // does not survive a round trip through a JSON number.
            @RequestParam(required = false) String endCursor,
            @RequestParam(required = false) Integer limit) {
        return logsService.getRecentLogs(query, search, startTime, endCursor, limit);
    }

    /**
     * How many lines match, over the whole window rather than the returned page. Separate
     * from /recent because it is a different kind of Loki query - a metric one - and
     * because the table wants to page through results without recounting each time.
     */
    @GetMapping("/count")
    public LogCountDto countLogs(
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Long startTime) {
        return logsService.countLogs(query, search, startTime);
    }

    /**
     * One numbered page, with the totals the pager needs. Pass the anchor back from the
     * previous response so every page in a session is cut from the same set of lines.
     */
    @GetMapping("/page")
    public LogPageDto getPage(
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String search,
            // How far back from the anchor to look, in seconds. 0 means the retention
            // window. A duration rather than an absolute start, so the caller does not have
            // to pin "now" itself - see LogsService.getPage.
            @RequestParam(required = false) Long windowSeconds,
            @RequestParam(required = false) String anchor,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer pageSize,
            // "forward" walks the window oldest-first; anything else is newest-first.
            @RequestParam(required = false) String direction) {
        return logsService.getPage(query, search, windowSeconds, anchor, page, pageSize, direction);
    }

    @GetMapping("/range")
    public String logRangeQuery(
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Long startTime,
            @RequestParam(required = false) String endCursor,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) String direction) {
        return logsService.logRangeQuery(query, search, startTime, endCursor, limit, direction);
    }
}
