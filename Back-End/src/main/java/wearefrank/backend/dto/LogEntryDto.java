package wearefrank.backend.dto;

/**
 * One log line, flattened.
 *
 * Two shapes arrive from Loki and both land here, told apart by {@link #type()}:
 *
 *   audit - the loki-logger plugin's access record, a nested JSON object per request;
 *           carries the route, the status and the upstream latency.
 *   error - APISIX's nginx error log, plain text; carries a level, the module that wrote
 *           it, the message, and whatever request context nginx appended.
 *
 * They share more than they differ - both name a method, a path, a host, a client and an
 * upstream - so one record serves both rather than two nearly-identical ones. What that
 * costs is fields that only ever apply to one kind, which is why every field but type,
 * timestamp, tsNanos and raw is nullable. The dashboard shows a different column set per
 * table; nothing here has to be non-null for a row to be worth rendering.
 *
 * A line that parses as neither still gets a row, with its text in message and raw.
 */
public record LogEntryDto(
        /** {@link LogKind#param()} - "audit" or "error". Decided by the line, not the query. */
        String type,
        /**
         * The namespace label off the Loki stream the line came out of, null if the stream
         * carries none. Read off the stream rather than the line, so it is filled whether or
         * not LOKI_NAMESPACE pins the query - what it answers is "which namespace is this
         * from", which matters most when the pin names several and the table merges them.
         */
        String namespace,
        // ISO-8601 UTC, from Loki's own timestamp rather than the line's. The audit record's
        // $time_iso8601 and the error line's date prefix are both second-resolution local
        // time, so they sort badly and disagree with each other.
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
        /** audit: always INFO. error: nginx's own, uppercased - INFO, WARN, ERROR, CRIT. */
        String level,
        String routeName,
        String routeId,
        String method,
        String path,
        String host,
        Integer status,
        Double latencyMs,
        /** The caller's address: the audit record's source, the error line's `client:`. */
        String source,
        /** audit: the resolved upstream address. error: the upstream URL nginx was calling. */
        String upstream,
        /** error only - nginx's `request_id:`, the handle for tracing one request. */
        String requestId,
        /** error only - what wrote the line, e.g. "[lua] plugin.lua:898". */
        String module,
        /** error only - the message itself, with the module prefix and context stripped. */
        String message,
        /** audit only - the tenant the gateway logs under. */
        String gemeenteCode,
        String raw
) {}
