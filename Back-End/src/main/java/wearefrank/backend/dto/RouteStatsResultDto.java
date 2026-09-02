package wearefrank.backend.dto;

import java.util.List;

/**
 * The per-route panel: the table, the series behind its chart, and what it took to build them.
 *
 * Both halves come out of one Loki query. The chart needs the counts bucketed over time and
 * the table needs them summed, and summing is free - so asking twice would be paying twice
 * for the same scan. See {@link RouteSeriesDto}.
 *
 * The queries are echoed for the same reason {@link LogCountDto} echoes its own: the
 * subtitle can then say what was actually asked rather than what the UI believes it asked.
 */
public record RouteStatsResultDto(
        /** Busiest first. A route with no traffic in the window still gets a row, at zero. */
        List<RouteStatsDto> routes,
        /**
         * The x-axis: the instant each bucket ends, in epoch seconds, oldest first.
         *
         * A bucket covers (t - stepSeconds, t] - Loki evaluates count_over_time at a point
         * and looks backwards, so the timestamp is the end of what it counted, not the start.
         */
        List<Long> bucketTimes,
        /** Bucket width in seconds, chosen from the window - see {@code RouteStatsService}. */
        long stepSeconds,
        /** One entry per route and status code that saw any traffic at all in the window. */
        List<RouteSeriesDto> series,
        /**
         * The span covered, in seconds: 0 has become the retention, and the result is rounded
         * up to a whole number of buckets so that the buckets tile it exactly. Which means
         * this can exceed the window that was asked for, by less than one bucket.
         */
        long windowSeconds,
        String countQuery,
        String latencyQuery,
        /**
         * True when the APISIX control API could not be reached. The counts are still Loki's
         * and still correct; what is missing is the Live column and any route that has had no
         * traffic. Reported rather than thrown so half an answer beats none.
         */
        boolean routesUnavailable
) {}
