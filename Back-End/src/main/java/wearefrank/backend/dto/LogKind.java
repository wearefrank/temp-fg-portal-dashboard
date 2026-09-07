package wearefrank.backend.dto;

import java.util.EnumSet;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * The streams the gateway writes into Loki, one constant per log_type label.
 *
 * The kind picks the stream, not how a line is read: {@code LogsService} parses on content,
 * so a stray error line in an access stream still comes back as one.
 */
public enum LogKind {

    /** The access record's old label. Kept selectable for Lokis still holding those lines. */
    AUDIT("audit", true),

    /** The access record, under the label config/apisix.yaml writes today. */
    MESSAGES("messages", true),

    /** APISIX's nginx error log - plain text, taken apart by {@code NginxErrorLine}. */
    ERROR("error", false);

    private static final String APP_MATCHER = "app_name=\"apisix\"";

    private final String param;
    private final boolean accessRecord;

    LogKind(String param, boolean accessRecord) {
        this.param = param;
        this.accessRecord = accessRecord;
    }

    /**
     * The ?type= spelling, the log_type label value, and {@link LogEntryDto#type()}. One
     * string for all three, so there is nothing to keep in step.
     */
    public String param() {
        return param;
    }

    /**
     * Whether this stream carries the loki-logger plugin's JSON access record. Audit and
     * messages are the same lines under two labels, so anything about the shape of a line
     * asks this rather than testing for one constant.
     */
    public boolean isAccessRecord() {
        return accessRecord;
    }

    /** Every kind carrying an access record. */
    public static Set<LogKind> accessRecords() {
        return EnumSet.allOf(LogKind.class).stream()
                .filter(LogKind::isAccessRecord)
                .collect(Collectors.toCollection(() -> EnumSet.noneOf(LogKind.class)));
    }

    /**
     * The stream selector used when the caller supplies no ?query= of their own: an exact
     * match for one kind, an alternation for several. The labels are literal words, so
     * nothing here needs regex-escaping.
     */
    public static String selectorFor(Set<LogKind> kinds) {
        if (kinds == null || kinds.isEmpty()) {
            throw new IllegalArgumentException("a selector needs at least one kind");
        }
        // An EnumSet so the alternation comes out in declaration order whatever was passed.
        EnumSet<LogKind> ordered = EnumSet.copyOf(kinds);
        if (ordered.size() == 1) {
            return "{" + APP_MATCHER + ", log_type=\"" + ordered.iterator().next().param + "\"}";
        }
        String alternation = ordered.stream().map(LogKind::param).collect(Collectors.joining("|"));
        return "{" + APP_MATCHER + ", log_type=~\"" + alternation + "\"}";
    }

    /**
     * One ?type= name, or null when it names no kind. Absent means MESSAGES, the label the
     * gateway writes today. A typo comes back null rather than falling back, since quietly
     * serving the wrong stream reads as one that is simply empty.
     */
    public static LogKind fromParam(String param) {
        if (param == null || param.isBlank()) {
            return MESSAGES;
        }
        String trimmed = param.trim().toLowerCase(Locale.ROOT);
        for (LogKind kind : values()) {
            if (kind.param.equals(trimmed)) {
                return kind;
            }
        }
        return null;
    }

    /**
     * A comma-separated ?type=, e.g. "audit,messages". Null when any name is unknown - the
     * whole request is rejected rather than half-honoured. Blanks are dropped, so a trailing
     * comma asks for what is actually named.
     */
    public static Set<LogKind> fromParams(String param) {
        if (param == null || param.isBlank()) {
            return EnumSet.of(MESSAGES);
        }
        EnumSet<LogKind> kinds = EnumSet.noneOf(LogKind.class);
        for (String name : param.split(",")) {
            if (name.isBlank()) {
                continue;
            }
            LogKind kind = fromParam(name);
            if (kind == null) {
                return null;
            }
            kinds.add(kind);
        }
        return kinds.isEmpty() ? EnumSet.of(MESSAGES) : kinds;
    }

    /** Every ?type= name a caller may pass, for the message on a rejected one. */
    public static String names() {
        return EnumSet.allOf(LogKind.class).stream()
                .map(LogKind::param)
                .collect(Collectors.joining(", "));
    }
}
