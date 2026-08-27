package wearefrank.backend.service;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * One APISIX error log line, taken apart.
 *
 * These are nginx's, not APISIX's own invention, and they are plain text rather than the
 * JSON the loki-logger plugin writes for the access log. The shape is fixed:
 *
 * <pre>
 * 2026/08/26 08:21:43 [info] 51#51: *5407 [lua] plugin.lua:898: conf_version(): init
 * plugin-level conf version: 2903643133, from {...} while logging request, client:
 * 109.94.148.130, server: _, request: "GET /test/anything HTTP/1.1", upstream:
 * "http://100.65.84.218:80/anything", host: "playground.tst.eu1.wearefrank.cloud",
 * request_id: "d5ea29ea7e7f00b910d5e1e79e535cf9"
 * </pre>
 *
 * date, [level], worker pid#tid, an optional *connection number, the message, and then the
 * request context nginx appends as ", key: value" pairs. The pid and connection number are
 * dropped - they identify a worker, which is not something the dashboard can act on, and
 * the whole line is kept as raw anyway.
 *
 * Parsing never fails. A line that does not match keeps its text as the message, because a
 * row saying something is more use than a row of nulls next to a timestamp.
 */
record NginxErrorLine(
        String level,
        String module,
        String message,
        String client,
        String method,
        String path,
        String protocol,
        String host,
        String upstream,
        String requestId
) {

    /**
     * DOTALL because a Lua error drags its traceback along on the following lines, and that
     * is all one entry - matching only the first line would cut the message in half.
     */
    private static final Pattern PREFIX = Pattern.compile(
            "^\\d{4}/\\d{2}/\\d{2} \\d{2}:\\d{2}:\\d{2} \\[(\\w+)] \\d+#\\d+: (?:\\*\\d+ )?(.*)$",
            Pattern.DOTALL);

    /**
     * The context nginx appends after the message. Matched against a fixed set of keys
     * rather than any ", word: " - the message routinely carries JSON, prose and colons of
     * its own, and a general pattern would cut it at the first of them. These are all of
     * them nginx emits (ngx_http_log_error_handler).
     */
    private static final Pattern TRAILER = Pattern.compile(
            ", (client|server|request|upstream|host|referrer|subrequest|request_id): ");

    /**
     * The "[lua] plugin.lua:898: " a module puts in front of what it wrote. The file part
     * has to look like a filename - some name, a dot, an extension, then :line - so that an
     * ordinary message with a colon in it is not mistaken for one.
     */
    private static final Pattern MODULE = Pattern.compile(
            "^((?:\\[\\w+] )?[\\w./-]*\\.\\w+:\\d+): (.*)$", Pattern.DOTALL);

    static NginxErrorLine parse(String line) {
        Matcher prefix = PREFIX.matcher(line);
        if (!prefix.matches()) {
            return new NginxErrorLine(null, null, line, null, null, null, null, null, null, null);
        }
        // Uppercased to match the audit record's "INFO", so one Level column can render both.
        String level = prefix.group(1).toUpperCase(Locale.ROOT);
        String body = prefix.group(2);

        Map<String, String> context = new HashMap<>();
        String message = splitOffContext(body, context);

        String module = null;
        Matcher moduleMatch = MODULE.matcher(message);
        if (moduleMatch.matches()) {
            module = moduleMatch.group(1);
            message = moduleMatch.group(2);
        }

        // "GET /test/anything HTTP/1.1" - anything else is left whole in the raw line rather
        // than sliced into fields that would then be wrong.
        String[] request = context.containsKey("request")
                ? context.get("request").split(" ") : new String[0];

        return new NginxErrorLine(
                level,
                module,
                message.trim(),
                context.get("client"),
                request.length == 3 ? request[0] : null,
                request.length == 3 ? request[1] : null,
                request.length == 3 ? request[2] : null,
                context.get("host"),
                context.get("upstream"),
                context.get("request_id"));
    }

    /**
     * Fills {@code context} from the trailing ", key: value" pairs and returns what came
     * before them - the message.
     *
     * Each value runs to the start of the next key rather than to the next comma: a request
     * line, an upstream URL and a Lua message all contain commas of their own.
     */
    private static String splitOffContext(String body, Map<String, String> context) {
        Matcher trailer = TRAILER.matcher(body);
        if (!trailer.find()) {
            return body;
        }
        String message = body.substring(0, trailer.start());
        String key = trailer.group(1);
        int valueStart = trailer.end();
        while (trailer.find()) {
            put(context, key, body.substring(valueStart, trailer.start()));
            key = trailer.group(1);
            valueStart = trailer.end();
        }
        put(context, key, body.substring(valueStart));
        return message;
    }

    private static void put(Map<String, String> context, String key, String value) {
        // nginx quotes the values that can contain spaces and leaves the rest bare.
        String unquoted = value.length() >= 2 && value.startsWith("\"") && value.endsWith("\"")
                ? value.substring(1, value.length() - 1) : value;
        // "-" is nginx's stand-in for a variable that was never set on this request; "_" is
        // the catch-all server name. Neither says anything, so neither becomes a value.
        if (!unquoted.isEmpty() && !"-".equals(unquoted) && !"_".equals(unquoted)) {
            context.put(key, unquoted);
        }
    }
}
