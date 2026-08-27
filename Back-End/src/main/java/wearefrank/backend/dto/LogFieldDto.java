package wearefrank.backend.dto;

/**
 * One column, as the dashboard needs it: what to call it, how to draw it, and whether it
 * starts open. The rest of {@link LogField} - the JSON paths, the error source - is how the
 * value is found, which is the server's business and not the browser's.
 *
 * @param defaultVisible whether this column starts open, for the kind that was asked about.
 * @param align          "right", or null for the default.
 */
public record LogFieldDto(
        String id,
        String label,
        LogFieldType type,
        boolean defaultVisible,
        String align
) {}
