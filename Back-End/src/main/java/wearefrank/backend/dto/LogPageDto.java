package wearefrank.backend.dto;

import java.util.List;

/**
 * One numbered page of log lines, with everything a pager needs to draw itself.
 *
 * Bundled into a single response rather than leaving the UI to combine a list endpoint
 * with a count endpoint: the two would be evaluated a moment apart, and a page numbered
 * against one total while its rows came from another is how a pager ends up showing an
 * empty "page 14 of 13".
 */
public record LogPageDto(
        List<LogEntryDto> entries,
        // 1-based, and already clamped to something reachable.
        int page,
        int pageSize,
        long totalCount,
        int totalPages,
        /**
         * The instant this page was cut from, as nanoseconds. Passing it back on the next
         * request pins every page in the session to the same set of lines; without it, log
         * lines arriving between clicks shift every row one place and page 2 repeats what
         * page 1 already showed.
         */
        String anchor,
        /**
         * True when there are more lines than paging can actually reach. Loki caps a query
         * at 5000 entries and a numbered page is cut from a single over-fetch, so beyond
         * that depth totalPages is what is reachable rather than what exists - worth saying
         * out loud instead of quietly showing fewer pages than the total implies.
         */
        boolean depthCapped,
        /**
         * Which way the window was walked - "backward" for newest-first, "forward" for
         * oldest-first. Echoed back so the sort indicator reflects what the server actually
         * did rather than what the client asked for.
         */
        String direction,
        /**
         * The column the page was ordered by - a {@link LogField} id, or "timestamp" for
         * time order. Echoed for the same reason as direction, and it can differ from what
         * was asked: a column the log has none of falls back to time - see {@link LogSort}.
         */
        String sort,
        /**
         * The column the search was confined to, or null when it ran over the whole line.
         * Echoed like sort and for the same reason: a column this log has none of falls back
         * to searching everywhere - see {@link LogSearchField}.
         */
        String searchField
) {}
