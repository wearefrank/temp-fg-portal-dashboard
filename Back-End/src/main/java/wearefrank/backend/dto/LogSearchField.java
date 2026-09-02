package wearefrank.backend.dto;

import java.util.Locale;

/**
 * Which column the search box looks in, and what "looks in" means for that column.
 *
 * The default is no column at all: the term goes to Loki as a line filter over the whole
 * line, which is the cheap case and the one every caller written before this got. Naming a
 * column narrows that to what one cell shows, which Loki cannot do - it knows the line, not
 * the fields {@code LogsService} takes out of it - so the match happens here instead. See
 * {@code LogsService.columnSearchPage} for what that costs.
 *
 * Searchable is derived from {@link LogFields} rather than listed again, exactly as
 * {@link LogSort}'s sortable is: any field that draws a column can be searched, plus
 * Namespace, which comes off the Loki stream rather than out of the line. Time is
 * deliberately not one - the range picker is what narrows by time, and a substring of an
 * ISO timestamp is not what anyone means by searching it.
 */
public final class LogSearchField {

    private static final String NAMESPACE = "namespace";

    /**
     * The requested column, or null - meaning the whole line - when it is absent or names
     * something this log has no searchable column for.
     *
     * Falls back rather than rejecting, for the reason {@link LogSort#resolve} does: a
     * column can go stale simply because the table switched kind, and dropping the user on
     * a 400 for that is worse than searching everywhere.
     */
    public static String resolve(String requested) {
        if (requested == null || requested.isBlank()) return null;
        String id = requested.trim();
        if (NAMESPACE.equals(id)) return id;
        return LogFields.ALL.stream()
                .filter(LogField::hasColumn)
                .anyMatch(field -> field.id().equals(id)) ? id : null;
    }

    /**
     * Whether a term aimed at this column can still be handed to Loki as a line filter
     * first. It can whenever the cell's text is a substring of the line, which makes the
     * filter a superset of the matches: it only prunes lines that would be dropped here
     * anyway, and saves dragging the whole window back for every search.
     *
     * Two columns are not: the namespace is a stream label and appears nowhere in the line,
     * and a duration is written in the line as seconds and shown in the column as
     * milliseconds, so "45" in the box would prune away the row reading "45 ms".
     */
    public static boolean prefiltersLine(String id) {
        if (id == null) return true;
        if (NAMESPACE.equals(id)) return false;
        return typeOf(id) != LogFieldType.DURATION;
    }

    /** Whether the cell this column draws for {@code entry} contains {@code term}. */
    public static boolean matches(LogEntryDto entry, String id, String term) {
        String cell = cellText(entry, id);
        if (cell == null) return false;
        return cell.toLowerCase(Locale.ROOT).contains(term.trim().toLowerCase(Locale.ROOT));
    }

    /**
     * What the cell shows, so that what matches is what the reader can see in that column.
     *
     * Keyed off the field's type rather than its name, as the cell renderer and the sort
     * comparator both are: Route is two fields behind one column, and a latency is held in
     * milliseconds and drawn rounded, so the row reading "45 ms" has to be found by "45".
     */
    private static String cellText(LogEntryDto entry, String id) {
        if (NAMESPACE.equals(id)) return entry.namespace();
        Object value = LogSort.value(entry, id);
        return switch (typeOf(id)) {
            case ROUTE -> entry.routeName() != null ? entry.routeName() : entry.routeId();
            case DURATION -> value == null ? null : String.format(Locale.ROOT, "%.0f", (Double) value);
            default -> value == null ? null : String.valueOf(value);
        };
    }

    private static LogFieldType typeOf(String id) {
        return LogFields.ALL.stream()
                .filter(field -> field.id().equals(id))
                .map(LogField::type)
                .findFirst()
                .orElse(LogFieldType.TEXT);
    }

    private LogSearchField() {}
}
