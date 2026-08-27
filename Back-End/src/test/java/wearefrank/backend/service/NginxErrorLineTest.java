package wearefrank.backend.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The error log's own shape, tested apart from Loki. {@link LogsServiceTest} covers a whole
 * captured line end to end; these are the pieces of the format that are easy to get wrong.
 */
class NginxErrorLineTest {

    @Test
    void parse_readsThePrefix() {
        NginxErrorLine line = NginxErrorLine.parse(
                "2026/08/26 08:21:43 [warn] 51#51: *5407 something happened");

        // uppercased so one Level column can render these next to the audit log's "INFO"
        assertThat(line.level()).isEqualTo("WARN");
        assertThat(line.message()).isEqualTo("something happened");
    }

    /** Not everything nginx logs is tied to a connection, so the *number is optional. */
    @Test
    void parse_readsALineWithNoConnectionNumber() {
        NginxErrorLine line = NginxErrorLine.parse(
                "2026/08/26 08:21:43 [error] 51#51: init_worker_by_lua error");

        assertThat(line.level()).isEqualTo("ERROR");
        assertThat(line.message()).isEqualTo("init_worker_by_lua error");
    }

    @Test
    void parse_splitsTheModuleOffTheMessage() {
        NginxErrorLine line = NginxErrorLine.parse(
                "2026/08/26 08:21:43 [info] 51#51: *1 [lua] plugin.lua:898: conf_version(): loaded");

        assertThat(line.module()).isEqualTo("[lua] plugin.lua:898");
        assertThat(line.message()).isEqualTo("conf_version(): loaded");
    }

    /**
     * The module prefix has to look like a filename. Plenty of messages carry a colon of
     * their own, and cutting one of those in half puts prose in the Module column.
     */
    @Test
    void parse_leavesAnOrdinaryMessageWhole() {
        NginxErrorLine line = NginxErrorLine.parse(
                "2026/08/26 08:21:43 [error] 51#51: *1 connect() failed: connection refused");

        assertThat(line.module()).isNull();
        assertThat(line.message()).isEqualTo("connect() failed: connection refused");
    }

    @Test
    void parse_readsTheRequestContext() {
        NginxErrorLine line = NginxErrorLine.parse(
                "2026/08/26 08:21:43 [info] 51#51: *1 boom while logging request, "
                        + "client: 109.94.148.130, server: _, request: \"POST /clo/djuma HTTP/1.1\", "
                        + "upstream: \"http://100.65.84.218:80/anything\", host: \"gw.example.nl\", "
                        + "request_id: \"d5ea29ea7e7f00b9\"");

        assertThat(line.client()).isEqualTo("109.94.148.130");
        assertThat(line.method()).isEqualTo("POST");
        assertThat(line.path()).isEqualTo("/clo/djuma");
        assertThat(line.protocol()).isEqualTo("HTTP/1.1");
        assertThat(line.upstream()).isEqualTo("http://100.65.84.218:80/anything");
        assertThat(line.host()).isEqualTo("gw.example.nl");
        assertThat(line.requestId()).isEqualTo("d5ea29ea7e7f00b9");
        // what nginx was doing stays on the message; it reads as part of the sentence
        assertThat(line.message()).isEqualTo("boom while logging request");
    }

    /**
     * A value runs to the start of the next key, not to the next comma. APISIX logs whole
     * JSON documents and Lua messages in there, and both are full of commas.
     */
    @Test
    void parse_doesNotCutTheMessageAtACommaInsideIt() {
        NginxErrorLine line = NginxErrorLine.parse(
                "2026/08/26 08:21:43 [info] 51#51: *1 conf: {\"a\":1,\"host\":\"x\",\"request\":\"y\"} "
                        + "while logging request, client: 1.2.3.4, request: \"GET /a HTTP/1.1\"");

        // the quoted "host" and "request" keys inside the JSON are not context keys
        assertThat(line.message()).isEqualTo("conf: {\"a\":1,\"host\":\"x\",\"request\":\"y\"} while logging request");
        assertThat(line.host()).isNull();
        assertThat(line.path()).isEqualTo("/a");
    }

    /** nginx's placeholders for "not set" - neither belongs in a column. */
    @Test
    void parse_dropsTheEmptyPlaceholders() {
        NginxErrorLine line = NginxErrorLine.parse(
                "2026/08/26 08:21:43 [info] 51#51: *1 boom, client: 1.2.3.4, server: _, upstream: \"-\"");

        assertThat(line.upstream()).isNull();
        assertThat(line.client()).isEqualTo("1.2.3.4");
    }

    /** A Lua error brings its traceback along, and that is all one entry. */
    @Test
    void parse_keepsAMultiLineTraceback() {
        NginxErrorLine line = NginxErrorLine.parse(
                "2026/08/26 08:21:43 [error] 51#51: *1 failed to run\nstack traceback:\n\t[C]: in function 'error'");

        assertThat(line.level()).isEqualTo("ERROR");
        assertThat(line.message()).contains("stack traceback:").contains("in function 'error'");
    }

    /**
     * Parsing never fails. A line from something that is not nginx keeps its text, because
     * a row that says something beats a timestamp with nothing beside it.
     */
    @Test
    void parse_keepsAnUnrecognisedLineAsTheMessage() {
        NginxErrorLine line = NginxErrorLine.parse("just some text");

        assertThat(line.level()).isNull();
        assertThat(line.module()).isNull();
        assertThat(line.message()).isEqualTo("just some text");
        assertThat(line.client()).isNull();
    }

    /** A request line that is not the usual three words is left alone rather than mis-sliced. */
    @Test
    void parse_leavesAMalformedRequestLineUnsplit() {
        NginxErrorLine line = NginxErrorLine.parse(
                "2026/08/26 08:21:43 [info] 51#51: *1 boom, client: 1.2.3.4, request: \"GARBAGE\"");

        assertThat(line.method()).isNull();
        assertThat(line.path()).isNull();
        assertThat(line.protocol()).isNull();
    }
}
