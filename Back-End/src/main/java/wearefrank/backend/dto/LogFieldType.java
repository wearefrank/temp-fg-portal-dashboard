package wearefrank.backend.dto;

/**
 * What a log field means, rather than what it is called.
 *
 * Read twice: {@code LogsService} switches on it to coerce the raw string out of the line,
 * and the dashboard switches on it to pick a cell renderer. That is the whole point of
 * naming the type instead of the field - a field added to the log format picks up the right
 * parsing and the right cell without either side learning its name.
 */
public enum LogFieldType {

    /** Plain text. */
    TEXT,

    /** Dimmed text - the columns you scan past rather than read. */
    MUTED,

    /** Monospace and dimmed, for an identifier that is meant to be copied. */
    CODE,

    /** A request path: monospace, and allowed to take the width it needs. */
    PATH,

    /** The wide column, clipped rather than wrapped so one traceback cannot fill the panel. */
    MESSAGE,

    /** Uppercased on the way in, badged above WARN on the way out. */
    LEVEL,

    /** An HTTP status: an integer, drawn as a pill coloured off the codes on the page. */
    STATUS,

    /** Seconds in - nginx reports them that way - milliseconds out. */
    DURATION,

    /**
     * The route, which is two fields: the name, falling back to the id. A route without a
     * name still has one, and an unnamed route is more use identified than blank.
     */
    ROUTE
}
