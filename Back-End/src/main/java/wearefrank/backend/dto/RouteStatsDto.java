package wearefrank.backend.dto;

import java.util.Map;

/**
 * One route's traffic over a window: how much of it there was, how it ended, and how long
 * the upstream took.
 *
 * Two sources meet here. The counts and the latency are aggregated by Loki out of the
 * access log; {@link #live()} and {@link #uri()} come from the APISIX control API, which is
 * the only one of the two that knows about a route nobody has called yet.
 */
public record RouteStatsDto(
        /** {@code $route_id} - the join key. "" for traffic that matched no route at all. */
        String routeId,
        /** {@code $route_name}, or the control API's name. Null when the route has none. */
        String routeName,
        String uri,
        /**
         * Whether APISIX has this route enabled (status 1). Null means unknown: either the
         * control API could not be reached, or the route is not in the config at all - see
         * {@link #configured()} for which.
         */
        Boolean live,
        /** Whether the route is in the running config. False for traffic to a route since removed. */
        boolean configured,

        long total,
        long informational,
        long success,
        long redirect,
        long clientError,
        long serverError,

        /**
         * 5xx as a percentage of total, one decimal. Server errors only: a 401 off key-auth
         * is the caller being turned away, not the gateway failing, and folding the two
         * together makes an authentication problem look like an outage.
         */
        Double errorRatePercent,
        /** 4xx as a percentage of total, so a spike in rejections is visible on its own. */
        Double clientErrorRatePercent,

        /**
         * Mean {@code $upstream_response_time}, in milliseconds.
         *
         * Null when nothing in the window recorded one, which is not the same as zero: a
         * request APISIX answered itself - a 401 from key-auth, a 404 with no route - never
         * reached an upstream and carries no time. So this describes the requests that were
         * proxied, not all of {@link #total()}.
         */
        Double avgLatencyMs,

        /** Every status code seen, by code, so the UI can break a class down on hover. */
        Map<String, Long> byStatus
) {}
