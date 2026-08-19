package wearefrank.backend.controller;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import wearefrank.backend.dto.UserDto;

import java.util.List;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/user")
@CrossOrigin(origins = "http://localhost:5173")
public class UserController {

    // Roles every Keycloak user gets; noise in the header.
    private static final Set<String> BUILT_IN_ROLES = Set.of("offline_access", "uma_authorization");

    @GetMapping()
    public UserDto getCurrentUser(@AuthenticationPrincipal OidcUser user) {
        if (user == null) {
            return new UserDto(null, List.of(), List.of());
        }
        return new UserDto(displayName(user), realmRoles(user), groups(user));
    }

    private String displayName(OidcUser user) {
        if (user.getFullName() != null && !user.getFullName().isBlank()) return user.getFullName();
        if (user.getPreferredUsername() != null) return user.getPreferredUsername();
        return user.getEmail() != null ? user.getEmail() : user.getSubject();
    }

    /** Keycloak realm roles live in the realm_access claim, not in Spring's authorities. */
    @SuppressWarnings("unchecked")
    private List<String> realmRoles(OidcUser user) {
        Object realmAccess = user.getClaims().get("realm_access");
        if (!(realmAccess instanceof Map<?, ?> map)) return List.of();

        Object roles = map.get("roles");
        if (!(roles instanceof List<?> list)) return List.of();

        return ((List<Object>) list).stream()
                .map(String::valueOf)
                .filter(role -> !role.startsWith("default-roles-") && !BUILT_IN_ROLES.contains(role))
                .toList();
    }

    /**
     * Group membership only reaches us when the IdP is configured to emit a "groups" claim
     * (in Keycloak: a group-membership protocol mapper); an empty list means it is not mapped.
     * Keycloak sends the full path, so "/platform-team" is trimmed to its last segment.
     */
    private List<String> groups(OidcUser user) {
        List<String> claim = user.getClaimAsStringList("groups");
        if (claim == null) return List.of();

        return claim.stream()
                .map(group -> group.substring(group.lastIndexOf('/') + 1))
                .filter(group -> !group.isBlank())
                .toList();
    }
}
