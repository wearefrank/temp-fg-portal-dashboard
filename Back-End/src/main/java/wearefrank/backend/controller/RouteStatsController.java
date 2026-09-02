package wearefrank.backend.controller;

import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import wearefrank.backend.dto.RouteStatsResultDto;
import wearefrank.backend.service.RouteStatsService;

/**
 * Traffic per route: the access log aggregated by Loki, joined onto the routes APISIX is
 * actually running.
 *
 * Its own controller rather than a method on {@link LogsController} or
 * {@link MetricsController}, because it belongs to neither - the answer is half Loki and
 * half control API, and either one being down still leaves a table worth drawing.
 */
@RestController
@RequestMapping("/api/routes")
@CrossOrigin(origins = "http://localhost:5173")
public class RouteStatsController {

    private final RouteStatsService routeStatsService;

    public RouteStatsController(RouteStatsService routeStatsService) {
        this.routeStatsService = routeStatsService;
    }

    @GetMapping("/stats")
    public RouteStatsResultDto routeStats(
            // How far back from the anchor to look, in seconds. 0 is the retention window -
            // the same spelling /api/logs/page takes, so one TimeRangePicker drives both.
            @RequestParam(required = false) Long windowSeconds,
            // Nanosecond instant the window ends at; absent means now.
            @RequestParam(required = false) String anchor,
            @RequestParam(required = false) String search) {
        return routeStatsService.routeStats(windowSeconds, anchor, search);
    }
}
