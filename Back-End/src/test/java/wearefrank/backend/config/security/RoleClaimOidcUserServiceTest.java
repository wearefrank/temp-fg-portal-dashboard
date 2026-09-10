package wearefrank.backend.config.security;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The claim path is configuration, so the shapes a realm can send are what this has to
 * survive. A realm that emits nothing has to come back empty rather than throw: it is a
 * setup mistake to log at login, not a reason to refuse the request.
 */
class RoleClaimOidcUserServiceTest {

    @Test
    void readsRolesFromANestedClaim() {
        Map<String, Object> claims = Map.of(
                "realm_access", Map.of("roles", List.of("gateway-user", "gateway-admin")));

        assertThat(RoleClaimOidcUserService.valuesAt(claims, "realm_access.roles"))
                .containsExactly("gateway-user", "gateway-admin");
    }

    @Test
    void readsRolesFromATopLevelClaim() {
        assertThat(RoleClaimOidcUserService.valuesAt(Map.of("groups", List.of("platform-team")), "groups"))
                .containsExactly("platform-team");
    }

    /** Nothing says a provider stops at two levels, and the claim name is configuration. */
    @Test
    void readsRolesFromADeeplyNestedClaim() {
        Map<String, Object> claims = Map.of("a", Map.of("b", Map.of("c", List.of("deep"))));

        assertThat(RoleClaimOidcUserService.valuesAt(claims, "a.b.c")).containsExactly("deep");
    }

    /** A few providers send one comma-separated string where Keycloak sends a list. */
    @Test
    void splitsACommaSeparatedStringClaim() {
        Map<String, Object> claims = Map.of("roles", "gateway-user, gateway-admin");

        assertThat(RoleClaimOidcUserService.valuesAt(claims, "roles"))
                .containsExactly("gateway-user", "gateway-admin");
    }

    /** Splitting on spaces too would turn one role into two. */
    @Test
    void keepsRoleNamesThatContainSpaces() {
        Map<String, Object> claims = Map.of("realm_access", Map.of("roles", List.of("Ibis Tester")));

        assertThat(RoleClaimOidcUserService.valuesAt(claims, "realm_access.roles"))
                .containsExactly("Ibis Tester");
    }

    @Test
    void returnsNothingWhenTheClaimIsMissing() {
        assertThat(RoleClaimOidcUserService.valuesAt(Map.of(), "realm_access.roles")).isEmpty();
        assertThat(RoleClaimOidcUserService.valuesAt(Map.of("realm_access", Map.of()), "realm_access.roles"))
                .isEmpty();
    }

    /** The configured path claims a nesting this token does not have. */
    @Test
    void returnsNothingWhenAPathSegmentIsNotAMap() {
        Map<String, Object> claims = Map.of("realm_access", "not-a-map");

        assertThat(RoleClaimOidcUserService.valuesAt(claims, "realm_access.roles")).isEmpty();
    }

    @Test
    void returnsNothingWhenTheClaimIsNeitherAListNorAString() {
        assertThat(RoleClaimOidcUserService.valuesAt(Map.of("roles", 42), "roles")).isEmpty();
    }

    /** A non-string entry must not take the whole login down with a ClassCastException. */
    @Test
    void survivesNonStringEntries() {
        Map<String, Object> claims = Map.of("roles", List.of("gateway-user", 7, true));

        assertThat(RoleClaimOidcUserService.valuesAt(claims, "roles"))
                .containsExactly("gateway-user", "7", "true");
    }
}
