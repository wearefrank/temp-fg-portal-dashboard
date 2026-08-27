package wearefrank.backend.dto;

/**
 * The two kinds of line the gateway puts into Loki, and the stream each one lives in.
 *
 * They are separate streams rather than one: the loki-logger plugin labels its access
 * records log_type="audit" (see loki-logger.log_labels in config/apisix.yaml) and the
 * nginx error log ships under log_type="error". Selecting on that label keeps the split
 * server-side, so a page of one kind is never cut short by rows of the other having been
 * filtered out of it - which is also why the dashboard draws two tables rather than one
 * with a type filter.
 *
 * The kind picks the stream. It does not decide how a line is read: {@code LogsService}
 * parses on content, so a stray error line in the audit stream still comes back as one.
 */
public enum LogKind {

    /** The loki-logger plugin's structured access record - one JSON object per request. */
    AUDIT("audit", "{app_name=\"apisix\", log_type=\"audit\"}"),

    /** APISIX's nginx error log - plain text, taken apart by {@code NginxErrorLine}. */
    ERROR("error", "{app_name=\"apisix\", log_type=\"error\"}");

    private final String param;
    private final String selector;

    LogKind(String param, String selector) {
        this.param = param;
        this.selector = selector;
    }

    /** The ?type= spelling, and the value that lands in {@link LogEntryDto#type()}. */
    public String param() {
        return param;
    }

    /** The LogQL stream selector used when the caller supplies no ?query= of their own. */
    public String selector() {
        return selector;
    }

    /**
     * Resolves the ?type= parameter, or null when it names no kind.
     *
     * Absent means AUDIT: that is the log the dashboard asked for before there was a second
     * kind, and keeping it the default leaves the existing endpoints answering as they did.
     * An unrecognised value comes back null rather than silently falling back, so the caller
     * can reject it - a typo quietly serving the access log is how you end up convinced the
     * error log is empty.
     */
    public static LogKind fromParam(String param) {
        if (param == null || param.isBlank()) {
            return AUDIT;
        }
        String trimmed = param.trim();
        for (LogKind kind : values()) {
            if (kind.param.equalsIgnoreCase(trimmed)) {
                return kind;
            }
        }
        return null;
    }
}
