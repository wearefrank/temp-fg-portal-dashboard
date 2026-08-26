package wearefrank.backend.dto;

/**
 * How many lines match, counted by Loki rather than by the browser. The distinction
 * matters: the log table only ever holds one page of results, so counting what it has
 * would report the page size, not the size of the match.
 */
public record LogCountDto(
        long count,
        // The LogQL the count was taken with, so the UI can show what it actually asked.
        String query
) {}
