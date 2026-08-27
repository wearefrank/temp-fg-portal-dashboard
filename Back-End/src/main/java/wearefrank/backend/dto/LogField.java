package wearefrank.backend.dto;

import java.util.List;
import java.util.Set;

/**
 * One field of a log line: where it is read from, what it means, and whether its column
 * starts open.
 *
 * See {@link LogFields} for the catalogue these make up and why it exists.
 *
 * @param id          the {@link LogEntryDto} component this fills, and the column's id.
 * @param label       the column header and its name in the visibility menu. Null for a
 *                    field that is mapped but draws no column of its own - {@code routeId}
 *                    is read so that {@code routeName} can fall back to it, and shown by
 *                    that column rather than one of its own.
 * @param type        what the value means - see {@link LogFieldType}.
 * @param auditPaths  dot paths into the loki-logger plugin's JSON, tried in order, first
 *                    one that resolves wins. Empty when the access record has no such field.
 *                    A list rather than one path because the same thing is written under
 *                    more than one key: the route id is nested under `audit` and repeated at
 *                    the top level, and `source` comes from $http_x_forwarded_for, which the
 *                    APISIX image leaves empty, with source_addr as the local stand-in.
 * @param errorSource the {@code NginxErrorLine} component that fills this, or null when the
 *                    error log carries nothing of the sort.
 * @param visibleFor  the kinds whose table starts with this column open. Independent of
 *                    which kinds fill it: Host, Client, Upstream and Gemeente are filled on
 *                    an access record and still start hidden, because fifteen columns is
 *                    more than fits and those are the ones you go looking for rather than
 *                    scan. Level is filled by both and starts hidden on the audit table,
 *                    because the plugin writes a constant "INFO" there.
 */
public record LogField(
        String id,
        String label,
        LogFieldType type,
        List<String> auditPaths,
        String errorSource,
        Set<LogKind> visibleFor
) {

    /**
     * Which kinds fill this field, derived rather than declared: an audit path means the
     * access record has it, an error source means the error line does. Declaring it
     * separately would only be a second thing to keep in step with the first.
     */
    public boolean fills(LogKind kind) {
        return kind == LogKind.AUDIT ? !auditPaths.isEmpty() : errorSource != null;
    }

    /** Whether this field draws a column at all - see {@link #label()}. */
    public boolean hasColumn() {
        return label != null;
    }

    /** Numbers read better against the next column; everything else reads left to right. */
    public boolean alignRight() {
        return type == LogFieldType.DURATION;
    }
}
