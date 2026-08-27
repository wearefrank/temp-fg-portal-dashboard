package wearefrank.backend.dto;

import java.util.List;
import java.util.Set;

/**
 * Every field the dashboard reads off a log line, declared once.
 *
 * This is the single source of truth for the log table. {@code LogsService} walks it to turn
 * a line into a {@link LogEntryDto}, and {@code /api/logs/fields} serves it to the browser,
 * which builds its columns from what comes back. Adding a field to the gateway's log_format
 * means an entry here and a component on {@link LogEntryDto} - the column then appears on
 * its own, with no front-end change.
 *
 * The alternative was deriving the columns from the JSON as it arrives. It does not work:
 * the plugin omits a field rather than writing it empty, so the set of keys differs from one
 * page to the next and columns would come and go as you page; the error log is not JSON at
 * all but nginx text taken apart by {@code NginxErrorLine}; and a key name carries none of
 * what {@link LogFieldType} does - that latency arrives in seconds, that status is a number
 * written as a string, that `source` has a fallback. Declared once beats sniffed each time.
 *
 * The order here is the column order.
 *
 * Not listed, because the line does not carry them: type, namespace, timestamp, tsNanos and
 * raw. Those come off the Loki stream rather than out of the log format, and
 * {@code LogFieldsTest} holds this list and that one to exactly {@link LogEntryDto}.
 */
public final class LogFields {

    private static final Set<LogKind> BOTH = Set.of(LogKind.AUDIT, LogKind.ERROR);
    private static final Set<LogKind> AUDIT_ONLY = Set.of(LogKind.AUDIT);
    private static final Set<LogKind> ERROR_ONLY = Set.of(LogKind.ERROR);
    /** Filled, but not worth a column until you go looking for it in the visibility menu. */
    private static final Set<LogKind> NEITHER = Set.of();

    public static final List<LogField> ALL = List.of(
            new LogField("level", "Level", LogFieldType.LEVEL,
                    List.of("level"), "level", ERROR_ONLY),

            new LogField("routeName", "Route", LogFieldType.ROUTE,
                    List.of("route_name"), null, AUDIT_ONLY),
            // Read only so that the Route column above has something to fall back to.
            new LogField("routeId", null, LogFieldType.TEXT,
                    List.of("audit.route_id", "route_id"), null, NEITHER),

            // Filled by both, but only the audit table starts with it open: on an error line
            // the method rarely adds to what the message and path already say.
            new LogField("method", "Method", LogFieldType.TEXT,
                    List.of("request.request_method"), "method", AUDIT_ONLY),
            new LogField("path", "Path", LogFieldType.PATH,
                    List.of("request.request_path"), "path", BOTH),

            new LogField("module", "Module", LogFieldType.MUTED,
                    List.of(), "module", ERROR_ONLY),
            new LogField("message", "Message", LogFieldType.MESSAGE,
                    List.of(), "message", ERROR_ONLY),

            new LogField("status", "Status", LogFieldType.STATUS,
                    List.of("response.status"), null, AUDIT_ONLY),
            // The log format calls this upstream_latency_ms, but it holds
            // $upstream_response_time, which nginx reports in seconds - hence DURATION.
            new LogField("latencyMs", "Latency", LogFieldType.DURATION,
                    List.of("response.upstream_latency_ms"), null, AUDIT_ONLY),

            new LogField("host", "Host", LogFieldType.MUTED,
                    List.of("request.request_host"), "host", NEITHER),
            new LogField("source", "Client", LogFieldType.MUTED,
                    List.of("source", "source_addr"), "client", NEITHER),
            new LogField("upstream", "Upstream", LogFieldType.MUTED,
                    List.of("response.upstream_endpoint.address"), "upstream", NEITHER),

            new LogField("requestId", "Request ID", LogFieldType.CODE,
                    List.of(), "requestId", ERROR_ONLY),
            new LogField("gemeenteCode", "Gemeente", LogFieldType.MUTED,
                    List.of("gemeente_code"), null, NEITHER)
    );

    /**
     * The components of {@link LogEntryDto} that no field fills, because they describe the
     * line rather than come out of it. Kept here so the test can hold the two together.
     */
    public static final Set<String> STRUCTURAL =
            Set.of("type", "namespace", "timestamp", "tsNanos", "raw");

    /** What {@code /api/logs/fields} answers for one kind: its columns, in order. */
    public static List<LogFieldDto> describe(LogKind kind) {
        return ALL.stream()
                .filter(LogField::hasColumn)
                .map(field -> new LogFieldDto(
                        field.id(),
                        field.label(),
                        field.type(),
                        field.visibleFor().contains(kind),
                        field.alignRight() ? "right" : null))
                .toList();
    }

    private LogFields() {}
}
