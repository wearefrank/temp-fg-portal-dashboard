package wearefrank.backend.controller;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import wearefrank.backend.dto.UserDto;

import java.util.List;
import java.util.Set;
import java.util.stream.Stream;

/**
 * The signed-in user, in the same shape whichever authenticator is active. Reading the
 * principal generically rather than as an OidcUser is what lets user-facing features work
 * under both OIDC and IN_MEMORY without each one branching on the login mechanism.
 */
@RestController
@RequestMapping("/api/user")
@CrossOrigin(origins = "http://localhost:5173")
public class UserController {

    // Roles every Keycloak user gets; noise in the header.
    private static final Set<String> BUILT_IN_ROLES = Set.of("offline_access", "uma_authorization");

    private static final String ROLE_PREFIX = "ROLE_";

    @GetMapping()
    public UserDto getCurrentUser(Authentication authentication) {
        if (authentication == null) {
            return new UserDto(null, List.of(), List.of());
        }

        // Roles come from the authorities either way: under OAUTH2 the configured claim is
        // mapped into them at login by RoleClaimOidcUserService. Only the display name and
        // groups still need the claims, and groups need one only an identity provider sends.
        List<String> roles = grantedRoles(authentication);
        if (authentication.getPrincipal() instanceof OidcUser user) {
            return new UserDto(displayName(user), roles, groups(user));
        }
        return new UserDto(authentication.getName(), roles, List.of());
    }

    private String displayName(OidcUser user) {
        if (user.getFullName() != null && !user.getFullName().isBlank()) return user.getFullName();
        if (user.getPreferredUsername() != null) return user.getPreferredUsername();
        return user.getEmail() != null ? user.getEmail() : user.getSubject();
    }

    /**
     * Only the ROLE_-prefixed authorities are roles: Spring mixes in others that are not,
     * such as the SCOPE_ ones from the token and the FACTOR_ authorities it adds to record
     * how the user proved who they are.
     */
    private List<String> grantedRoles(Authentication authentication) {
        return withoutNoise(authentication.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .filter(authority -> authority.startsWith(ROLE_PREFIX))
                .map(authority -> authority.substring(ROLE_PREFIX.length())));
    }

    private List<String> withoutNoise(Stream<String> roles) {
        return roles
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
