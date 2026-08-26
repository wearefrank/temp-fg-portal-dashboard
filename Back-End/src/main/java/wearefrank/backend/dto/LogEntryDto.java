package wearefrank.backend.dto;

/**
 * One access log line, flattened out of the nested JSON the loki-logger plugin writes.
 *
 * Every field but timestamp, tsNanos and raw is nullable on purpose: Loki holds whatever
 * was pushed to it, which is not always one of the plugin's records. A line that does not
 * parse keeps its text in raw and leaves the rest null rather than being dropped.
 */
public record LogEntryDto(
        // ISO-8601 UTC, from Loki's own timestamp rather than the line's $time_iso8601 -
        // that one is second-resolution with a local offset, so it sorts badly.
        String timestamp,
        /**
         * The same instant as raw nanoseconds, and the cursor for paging: pass the oldest
         * row's value back as endCursor to get the page below it.
         *
         * A string, not a long. Nanoseconds land around 1.8e18 and JSON numbers stop being
         * exact above 2^53, so a browser parsing this as a number would round it and start
         * re-requesting lines it already has.
         */
        String tsNanos,
        String level,
        String routeName,
        String routeId,
        String method,
        String path,
        String host,
        Integer status,
        Double latencyMs,
        String source,
        String upstream,
        String raw
) {}
