package wearefrank.backend.controller;

import org.springframework.web.bind.annotation.*;
import wearefrank.backend.dto.LogCountDto;
import wearefrank.backend.dto.LogEntryDto;
import wearefrank.backend.dto.LogFieldDto;
import wearefrank.backend.dto.LogPageDto;
import wearefrank.backend.dto.MessageVolumeDto;
import wearefrank.backend.service.LogsService;

import java.util.List;

/**
 * Loki's counterpart to the Prometheus endpoints on {@link MetricsController}: /range is
 * the raw passthrough to build new panels against, /recent is the flattened form the
 * dashboard's log table renders.
 *
 * Every endpoint takes a `type` naming which of the gateway's two log streams to read -
 * "audit" for the access records, "error" for the nginx error log. It is optional and
 * defaults to audit, so a caller written against the single-stream version of these
 * endpoints still gets what it used to.
 */
@RestController
@RequestMapping("/api/logs")
@CrossOrigin(origins = "http://localhost:5173")
public class LogsController {

    private final LogsService logsService;

    public LogsController(LogsService logsService) {
        this.logsService = logsService;
    }

    /**
     * The columns the log table should draw for a kind, in order: id, label, what the value
     * means, and whether it starts open.
     *
     * Here so that the field list lives in one place rather than being restated in the
     * browser - see {@link wearefrank.backend.dto.LogFields}. A field added to the gateway's
     * log_format shows up here, and the table picks it up without a front-end change.
     */
    @GetMapping("/fields")
    public List<LogFieldDto> getFields(@RequestParam(required = false) String type) {
        return logsService.describeFields(type);
    }

    @GetMapping("/recent")
    public List<LogEntryDto> getRecentLogs(
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Long startTime,
            // Oldest tsNanos of the previous page. A string, because a nanosecond timestamp
            // does not survive a round trip through a JSON number.
            @RequestParam(required = false) String endCursor,
            @RequestParam(required = false) Integer limit) {
        return logsService.getRecentLogs(type, query, search, startTime, endCursor, limit);
    }

    /**
     * How many lines match, over the whole window rather than the returned page. Separate
     * from /recent because it is a different kind of Loki query - a metric one - and
     * because the table wants to page through results without recounting each time.
     */
    @GetMapping("/count")
    public LogCountDto countLogs(
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String search,
            // Which column the search is confined to - see the same parameter on /page.
            @RequestParam(required = false) String searchField,
            @RequestParam(required = false) Long startTime) {
        return logsService.countLogs(type, query, search, searchField, startTime);
    }

    /**
     * The same count taken twice, over this window and the one before it, for the
     * dashboard's "this week vs last week" line. Separate from /count because that one
     * answers about the window a table is showing; this one is always a back-to-back pair.
     */
    @GetMapping("/volume")
    public MessageVolumeDto messageVolume(
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String search,
            // Length of each of the two windows, in seconds. Defaults to a week.
            @RequestParam(required = false) Long windowSeconds) {
        return logsService.messageVolume(type, query, search, windowSeconds);
    }

    /**
     * One numbered page, with the totals the pager needs. Pass the anchor back from the
     * previous response so every page in a session is cut from the same set of lines.
     */
    @GetMapping("/page")
    public LogPageDto getPage(
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String search,
            // Which column to confine the search to: a log field id, or "namespace". Absent,
            // the term matches anywhere in the line, which is the default. Anything this log
            // has no column for falls back to that too.
            @RequestParam(required = false) String searchField,
            // How far back from the anchor to look, in seconds. 0 means the retention
            // window. A duration rather than an absolute start, so the caller does not have
            // to pin "now" itself - see LogsService.getPage.
            @RequestParam(required = false) Long windowSeconds,
            @RequestParam(required = false) String anchor,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer pageSize,
            // "forward" is ascending - oldest-first for time, A-Z for a text column.
            @RequestParam(required = false) String direction,
            // Which column to order by: a log field id, or "timestamp" for time order, which
            // is the default. Anything this log has no column for falls back to time.
            @RequestParam(required = false) String sort) {
        return logsService.getPage(type, query, search, searchField, windowSeconds, anchor, page,
                pageSize, direction, sort);
    }

    @GetMapping("/range")
    public String logRangeQuery(
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Long startTime,
            @RequestParam(required = false) String endCursor,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) String direction) {
        return logsService.logRangeQuery(type, query, search, startTime, endCursor, limit, direction);
    }
}
