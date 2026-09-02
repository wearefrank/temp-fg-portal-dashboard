package wearefrank.backend.dto;

import java.util.List;

/**
 * One route's traffic in one status code, over time.
 *
 * The finest grouping the chart needs, so that the browser can fold it either way without
 * asking again: by status class for "what broke", by route for "what went quiet". Summed
 * over time it is also where {@link RouteStatsDto}'s totals come from - the table and the
 * chart are the same query.
 */
public record RouteSeriesDto(
        /** "" for traffic that matched no route, as on {@link RouteStatsDto#routeId()}. */
        String routeId,
        /** The exact code, e.g. "200" - the class is the browser's fold, not the query's. */
        String status,
        /**
         * One count per bucket, aligned to {@link RouteStatsResultDto#bucketTimes()} and the
         * same length as it.
         *
         * Zero-filled here rather than in the browser. Loki emits no sample at all for a
         * bucket that matched nothing, and a chart drawn straight from that connects across
         * the gap - which turns "this route stopped" into a smooth line between the last
         * request before the silence and the first one after it.
         */
        List<Long> counts
) {}
