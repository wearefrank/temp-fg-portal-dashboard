package wearefrank.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import wearefrank.backend.dto.LogEntryDto;
import wearefrank.backend.dto.LogField;
import wearefrank.backend.dto.LogFields;
import wearefrank.backend.dto.LogKind;

import java.io.IOException;
import java.lang.reflect.RecordComponent;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Holds {@link LogFields} against the two things it makes claims about: the record it fills
 * and the log format it reads.
 *
 * This is the test the refactor to a declared catalogue was for. Before it, renaming a key
 * in the gateway's log_format broke the mapping silently - the lookup returned null, the
 * column filled with dashes, and nothing anywhere said so. That reads like "no traffic"
 * rather than "broken mapping", which is the wrong thing to be reassured by. Now it is a
 * red build.
 */
class LogFieldsTest {

    /** The repo's apisix.yaml, from the Back-End module surefire runs in. */
    private static final Path APISIX_CONFIG = Path.of("..", "config", "apisix.yaml");

    @Test
    @DisplayName("every field names a component of LogEntryDto, and every component is accounted for")
    void catalogueMatchesTheRecord() {
        Set<String> declared = new HashSet<>(LogFields.STRUCTURAL);
        LogFields.ALL.forEach(field -> declared.add(field.id()));

        Set<String> components = Arrays.stream(LogEntryDto.class.getRecordComponents())
                .map(RecordComponent::getName)
                .collect(Collectors.toSet());

        // Both directions. A field with no component would bind to nothing when
        // LogsService converts the map onto the record; a component with no field would
        // never be filled, and would sit on the API answering null forever.
        assertEquals(components, declared,
                "LogFields.ALL plus LogFields.STRUCTURAL must be exactly LogEntryDto's components");
    }

    @Test
    @DisplayName("every audit path still resolves in the gateway's log_format")
    void auditPathsExistInTheLogFormat() throws IOException {
        JsonNode logFormat = logFormat();

        for (LogField field : LogFields.ALL) {
            if (field.auditPaths().isEmpty()) continue;
            // At least one, not all: the later paths are fallbacks. `source_addr` is a local
            // addition that production does not have, and the route id is written both
            // nested under `audit` and at the top level depending on the format.
            boolean resolved = field.auditPaths().stream().anyMatch(path -> resolves(logFormat, path));
            assertTrue(resolved, () -> "No path of " + field.id() + " resolves in log_format - tried "
                    + field.auditPaths() + ". Either the log format renamed a key, or this field "
                    + "needs its path updated. Left alone, the column silently fills with dashes.");
        }
    }

    @Test
    @DisplayName("every error source names a component of NginxErrorLine")
    void errorSourcesExistOnTheParsedLine() {
        Set<String> components = Arrays.stream(NginxErrorLine.class.getRecordComponents())
                .map(RecordComponent::getName)
                .collect(Collectors.toSet());

        List<String> sources = LogFields.ALL.stream()
                .map(LogField::errorSource)
                .filter(Objects::nonNull)
                .toList();

        for (String source : sources) {
            assertTrue(components.contains(source),
                    "NginxErrorLine has no component '" + source + "' - LogFields names one that "
                            + "asMap() cannot supply, so the column would never fill.");
        }
    }

    @Test
    @DisplayName("a field is filled by exactly the kinds that have somewhere to read it from")
    void fillsFollowsFromWhatIsDeclared() {
        for (LogField field : LogFields.ALL) {
            assertEquals(!field.auditPaths().isEmpty(), field.fills(LogKind.AUDIT), field.id());
            assertEquals(field.errorSource() != null, field.fills(LogKind.ERROR), field.id());

            // Neither would be a field nothing can ever fill - a column of dashes on both
            // tables, and a DTO component permanently null.
            assertTrue(field.fills(LogKind.AUDIT) || field.fills(LogKind.ERROR),
                    field.id() + " declares neither an audit path nor an error source");
        }
    }

    @Test
    @DisplayName("a column that starts open is one its own kind actually fills")
    void defaultVisibleColumnsAreFilled() {
        for (LogField field : LogFields.ALL) {
            for (LogKind kind : LogKind.values()) {
                if (!field.visibleFor().contains(kind)) continue;
                assertTrue(field.fills(kind),
                        field.id() + " starts open on the " + kind.param() + " table but nothing "
                                + "fills it there - that is a column of dashes on first load.");
            }
        }
    }

    /** plugins.loki-logger.log_format, off whichever global rule carries the plugin. */
    private JsonNode logFormat() throws IOException {
        assertTrue(Files.exists(APISIX_CONFIG),
                "Expected the gateway config at " + APISIX_CONFIG.toAbsolutePath());

        ObjectMapper yaml = new ObjectMapper(new YAMLFactory());
        JsonNode root = yaml.readTree(Files.readString(APISIX_CONFIG));

        for (JsonNode rule : root.path("global_rules")) {
            JsonNode format = rule.path("plugins").path("loki-logger").path("log_format");
            if (format.isObject()) return format;
        }
        throw new AssertionError(
                "No global rule in " + APISIX_CONFIG + " carries plugins.loki-logger.log_format");
    }

    private boolean resolves(JsonNode root, String path) {
        JsonNode node = root;
        for (String segment : path.split("\\.")) {
            node = node.path(segment);
        }
        return !node.isMissingNode();
    }
}
