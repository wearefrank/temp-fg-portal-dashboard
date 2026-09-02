package wearefrank.backend.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import wearefrank.backend.dto.LogKind;

import java.util.ArrayList;
import java.util.List;

/**
 * Which Loki this console is allowed to see, and how far back "everything" reaches.
 *
 * Split out of {@link LogsService} so that {@link RouteStatsService} builds its aggregate
 * queries against the same rules. The namespace pin especially has to be shared rather than
 * restated - a second copy of it is how one of the two ends up querying wide open.
 */
@Service
public class LokiScope {

    /** Fallback retention when LOKI_RETENTION_HOURS is unset: 336h, two weeks. */
    private static final long DEFAULT_RETENTION_HOURS = 336L;

    private final List<String> namespaces;
    private final String namespaceLabel;
    private final long retentionSeconds;

    public LokiScope(
            // Every query built through this gets pinned to these namespaces, the caller's
            // own selector included - see pipeline. A comma-separated list scopes the
            // console to several at once and the tables show them merged. Empty means no
            // pinning, which is what a single-tenant Loki wants.
            @Value("${LOKI_NAMESPACE:}") String namespace,
            // Which label carries it. "namespace" is what the gateway's loki-logger pushes
            // (config/apisix.yaml) and what a Kubernetes service-discovery scrape produces;
            // some collectors relabel it to kubernetes_namespace instead.
            @Value("${LOKI_NAMESPACE_LABEL:namespace}") String namespaceLabel,
            // What startTime=0 resolves to, in hours - Loki has no equivalent of Prometheus'
            // TSDB min-time endpoint, so the console has to be told how far back asking for
            // "everything" is worth reaching. Match it to retention_period on the Loki being
            // queried.
            //
            // The two failure directions are not symmetric. Set longer than the real
            // retention, a query merely widens over lines already deleted, which costs
            // nothing and returns the same rows. Set shorter, "all" silently stops short of
            // data Loki still holds - so when the real value is unknown, guess high.
            @Value("${LOKI_RETENTION_HOURS:" + DEFAULT_RETENTION_HOURS + "}") long retentionHours) {
        this.namespaces = parseNamespaces(namespace);
        this.namespaceLabel = (namespaceLabel == null || namespaceLabel.isBlank())
                ? "namespace" : namespaceLabel.trim();
        // A non-positive setting would make startTime=0 resolve to an empty or inverted
        // window - "all" returning nothing at all - so it falls back rather than obeying.
        this.retentionSeconds = (retentionHours > 0 ? retentionHours : DEFAULT_RETENTION_HOURS) * 3600L;
    }

    /** How far back "everything Loki holds" reaches, in seconds. */
    public long retentionSeconds() {
        return retentionSeconds;
    }

    /** The label a stream carries its namespace under, for reading it back off a response. */
    public String namespaceLabel() {
        return namespaceLabel;
    }

    /**
     * Builds the LogQL: a stream selector, plus a case-insensitive line filter when the
     * user typed something in the search box.
     *
     * The kind decides the selector only when the caller supplied none. A caller-supplied
     * ?query= replaces it outright, kind included - the two tables differ by which stream
     * they select, and a query that names its own stream has already made that choice.
     *
     * The search term is escaped twice on purpose. It is interpolated into a regular
     * expression inside a quoted LogQL string, so it has to survive both: regex-escaped
     * first so that a "." or "(" in the box matches literally instead of being read as a
     * pattern, then string-escaped so a quote or backslash cannot close the literal early
     * and graft arbitrary LogQL onto the query.
     */
    public String pipeline(LogKind kind, String query, String search) {
        String selector = (query != null && !query.isBlank()) ? query.trim() : kind.selector();
        selector = forceNamespace(selector);
        if (search == null || search.isBlank()) {
            return selector;
        }
        return selector + " |~ \"(?i)" + logqlString(regexEscape(search.trim())) + "\"";
    }

    /**
     * Splits LOKI_NAMESPACE into the set to scope to.
     *
     * Blanks are dropped rather than kept, so a trailing comma or a value assembled by a
     * template that left a slot empty narrows to what is actually named instead of pinning
     * to a namespace called "". Duplicates are dropped too, in first-seen order - repeating
     * one in the alternation changes nothing about what matches and only makes the query
     * harder to read in a log.
     *
     * An empty result is the unpinned case, which is also what an unset variable gives.
     */
    private static List<String> parseNamespaces(String raw) {
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        List<String> parsed = new ArrayList<>();
        for (String part : raw.split(",")) {
            String trimmed = part.trim();
            if (!trimmed.isEmpty() && !parsed.contains(trimmed)) {
                parsed.add(trimmed);
            }
        }
        return List.copyOf(parsed);
    }

    /**
     * Pins the selector to the configured namespaces by adding the label matcher to it.
     * Matchers inside a selector are ANDed, so this can only ever narrow what comes back -
     * a caller asking for a namespace outside the set gets an empty result rather than that
     * namespace's lines.
     *
     * Done here rather than by prefixing the kind's selector, because ?query= lets the
     * caller replace the selector outright; a default the caller can drop is not a filter.
     *
     * No-op when LOKI_NAMESPACE is empty, which is the single-tenant case.
     */
    private String forceNamespace(String selector) {
        if (namespaces.isEmpty()) {
            return selector;
        }
        int[] braces = selectorBraces(selector);
        int open = braces[0];
        int close = braces[1];
        String existing = selector.substring(open + 1, close).trim();
        String forced = namespaceLabel + namespaceMatcher();
        return selector.substring(0, open + 1)
                + (existing.isEmpty() ? forced : forced + ", " + existing)
                + selector.substring(close);
    }

    /**
     * The matcher's operator and value, for a label already written out by the caller.
     *
     * One namespace stays an exact {@code ="ns"} rather than a one-branch alternation: it is
     * the cheaper matcher for Loki to answer and the plainer one to read in a query log, and
     * it keeps every existing single-namespace deployment's queries byte-identical.
     *
     * Several become {@code =~"a|b"}. Each value is regex-escaped on its own and the bars are
     * added after, so a namespace holding a metacharacter matches literally instead of
     * widening the set - escaping the joined string would escape the bars too and leave one
     * literal namespace called "a|b". Loki anchors a label regex as {@code ^(?:re)$}, so the
     * alternation binds across the whole value without grouping it here.
     */
    private String namespaceMatcher() {
        if (namespaces.size() == 1) {
            return "=\"" + logqlString(namespaces.get(0)) + "\"";
        }
        StringBuilder alternation = new StringBuilder();
        for (String ns : namespaces) {
            if (alternation.length() > 0) {
                alternation.append('|');
            }
            alternation.append(regexEscape(ns));
        }
        return "=~\"" + logqlString(alternation.toString()) + "\"";
    }

    /**
     * Positions of the stream selector's braces, skipping any that sit inside a string
     * literal - {@code {app_name="apisix"} |= "{"} has three braces and only two of them
     * delimit the selector.
     *
     * A caller query holding a second selector is rejected instead of being half-pinned:
     * this only ever edits one of them, so a two-selector query would come back with the
     * namespace enforced on the first and wide open on the second.
     */
    private int[] selectorBraces(String selector) {
        int open = -1;
        int close = -1;
        char quote = 0;
        for (int i = 0; i < selector.length(); i++) {
            char c = selector.charAt(i);
            if (quote != 0) {
                // Backticks are LogQL's raw strings: no escapes inside them, so a backslash
                // there is just a backslash and cannot hide the closing backtick.
                if (c == '\\' && quote == '"') {
                    i++;
                } else if (c == quote) {
                    quote = 0;
                }
            } else if (c == '"' || c == '`') {
                quote = c;
            } else if (c == '{') {
                if (open >= 0) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                            "query must hold a single stream selector while LOKI_NAMESPACE is set");
                }
                open = i;
            } else if (c == '}' && open >= 0 && close < 0) {
                close = i;
            }
        }
        if (open < 0 || close < 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "query must contain a stream selector, e.g. {app_name=\"apisix\"}");
        }
        return new int[]{open, close};
    }

    // Loki runs Go's RE2, which has no \Q...\E, so the metacharacters are escaped by hand.
    public static String regexEscape(String raw) {
        StringBuilder escaped = new StringBuilder(raw.length() * 2);
        for (char c : raw.toCharArray()) {
            if ("\\.+*?()|[]{}^$".indexOf(c) >= 0) {
                escaped.append('\\');
            }
            escaped.append(c);
        }
        return escaped.toString();
    }

    // Escapes for a double-quoted LogQL string literal. Backslashes first: doing it after
    // the quotes would also escape the backslashes this method just added.
    public static String logqlString(String raw) {
        return raw.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
