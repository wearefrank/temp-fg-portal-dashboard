package wearefrank.backend.dto;

/**
 * Two adjacent windows of the same length, counted out of Loki, so the dashboard can say
 * "this week, and how that compares to last week".
 *
 * Both counts come from the log stream rather than from Prometheus on purpose. The
 * Prometheus counter behind the headline figure is cumulative and resets when the gateway
 * restarts, so carving a fixed historical window out of it means increase() extrapolating
 * over a range far longer than its scrape interval. A log line either exists in the window
 * or it does not, which is the right primitive for "how many did we handle last week".
 */
public record MessageVolumeDto(
        /** Lines in the window ending now. */
        long current,
        /** Lines in the window of equal length immediately before it. */
        long previous,
        /**
         * Growth from previous to current, in percent, rounded to one decimal.
         *
         * Null when the previous window counted zero: there is no percentage change from
         * nothing, and reporting one would be worse than reporting none. That is also what
         * a window sitting outside Loki's retention looks like, which is the common case
         * right after this panel is deployed - see MessageVolumeDto's use in LogsService.
         */
        Double changePercent,
        /** Length of each window, so the UI can label what it is showing. */
        long windowSeconds,
        /** The LogQL the current window was counted with, for the same reason LogCountDto carries it. */
        String query
) {}
