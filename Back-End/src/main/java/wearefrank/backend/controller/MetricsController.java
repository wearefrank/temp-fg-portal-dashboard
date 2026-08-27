package wearefrank.backend.controller;

import org.springframework.web.bind.annotation.*;
import wearefrank.backend.dto.MetricsDto;
import wearefrank.backend.service.MetricsService;

import java.util.List;

@RestController
@RequestMapping("/api/metrics")
@CrossOrigin(origins = "http://localhost:5173")
public class MetricsController {

    private final MetricsService metricsService;

    public MetricsController(MetricsService metricsService) {
        this.metricsService = metricsService;
    }

    @GetMapping("/prom-query")
    public String prometheusQuery(@RequestParam String query) {
        return metricsService.prometheusQuery(query);
    }

    @GetMapping("/prom-range")
    public String prometheusRangeQuery(
            @RequestParam String query,
            @RequestParam(required = false) Long startTime,
            @RequestParam(required = false) String step) {
        return metricsService.prometheusRangeQuery(query, startTime, step);
    }

    @GetMapping("/health")
    public String getHealthcheck() {
        return metricsService.getHealthcheck();
    }

    @GetMapping("/prometheus/raw")
    public String getPrometheusRaw() {
        return metricsService.getPrometheusRaw();
    }

    @GetMapping("/prometheus/health")
    public boolean getPrometheusHealth() {
        return metricsService.isPrometheusHealthy();
    }

    @GetMapping("/prometheus")
    public MetricsDto getPrometheusMetrics() {
        return metricsService.getPrometheusMetrics();
    }

    @GetMapping("/routes")
    public List<Object> getLiveRoutes() {
        return metricsService.getLiveRoutes();
    }

    @GetMapping("/upstreams")
    public List<Object> getLiveUpstreams() {
        return metricsService.getLiveUpstreams();
    }

    @GetMapping("/services")
    public List<Object> getLiveServices() {
        return metricsService.getLiveServices();
    }
}
