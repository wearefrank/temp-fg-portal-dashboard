package wearefrank.backend.config.security;

import com.nimbusds.jwt.JWTParser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserRequest;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserService;
import org.springframework.security.oauth2.client.userinfo.OAuth2UserService;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;

import java.text.ParseException;
import java.util.Arrays;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

/**
 * Turns the provider's role claim into Spring authorities, so {@code hasRole} works with
 * Keycloak roles. Which claim holds them is configured ({@code authoritiesClaimName}, e.g.
 * "realm_access.roles"), since it depends on the realm's mappers.
 *
 * The claim is read from the ID token and userinfo first, then from the access token,
 * because Keycloak can add roles to either one.
 */
public class RoleClaimOidcUserService implements OAuth2UserService<OidcUserRequest, OidcUser> {

    private static final Logger log = LoggerFactory.getLogger(RoleClaimOidcUserService.class);

    /** Spring only treats an authority as a role when it carries this prefix. */
    private static final String ROLE_PREFIX = "ROLE_";

    private final OidcUserService delegate = new OidcUserService();
    private final String authoritiesClaimName;

    public RoleClaimOidcUserService(String authoritiesClaimName) {
        this.authoritiesClaimName = authoritiesClaimName;
    }

    @Override
    public OidcUser loadUser(OidcUserRequest request) throws OAuth2AuthenticationException {
        OidcUser user = delegate.loadUser(request);

        List<String> roles = valuesAt(user.getClaims(), authoritiesClaimName);
        if (roles.isEmpty()) {
            roles = valuesAt(accessTokenClaims(request), authoritiesClaimName);
        }
        if (roles.isEmpty()) {
            log.warn("No roles at claim '{}' for user {}; check the realm's role mapper has "
                    + "'add to ID token' or 'add to access token' enabled.",
                    authoritiesClaimName, user.getName());
        }

        return new DefaultOidcUser(
                withRoles(user.getAuthorities(), roles),
                user.getIdToken(),
                user.getUserInfo(),
                userNameAttributeName(request));
    }

    /**
     * Reads the values at a dotted claim path, e.g. "realm_access.roles" out of
     * {@code {"realm_access": {"roles": ["gateway-admin"]}}}. Any nesting depth works.
     * A missing or unusable claim returns an empty list instead of throwing, because that
     * is a configuration problem to log.
     *
     * @param claims the merged claim map to read from; may be empty, never null
     * @param path   dot-separated claim path, e.g. "realm_access.roles"
     * @return the role names at that path, or an empty list
     */
    static List<String> valuesAt(Map<String, Object> claims, String path) {
        Object value = claims;
        for (String segment : path.split("\\.")) {
            // Anything but a map means the token does not have the nesting the path expects.
            if (!(value instanceof Map<?, ?> map)) return List.of();
            value = map.get(segment);
        }
        return toRoles(value);
    }

    /**
     * Uses String::valueOf instead of a cast, so a numeric or boolean claim cannot throw
     * during login. Some providers send a comma-separated string where Keycloak sends a
     * list, so splitting on commas only keeps role names with spaces intact.
     */
    private static List<String> toRoles(Object value) {
        Stream<String> raw = switch (value) {
            case List<?> list -> list.stream().map(String::valueOf);
            case String text -> Arrays.stream(text.split(","));
            case null, default -> Stream.empty();
        };
        return raw.map(String::trim).filter(role -> !role.isEmpty()).toList();
    }

    /** The original authorities (OIDC_USER, SCOPE_*) plus one ROLE_ per configured role. */
    private static Collection<GrantedAuthority> withRoles(
            Collection<? extends GrantedAuthority> existing, List<String> roles) {

        Set<GrantedAuthority> authorities = new LinkedHashSet<>(existing);
        roles.forEach(role -> authorities.add(new SimpleGrantedAuthority(ROLE_PREFIX + role)));
        return authorities;
    }

    /**
     * The access token's claims, if it is a JWT. Keycloak's are, but the spec allows an
     * opaque token, so an unreadable one is treated as having no claims.
     */
    private static Map<String, Object> accessTokenClaims(OidcUserRequest request) {
        try {
            return JWTParser.parse(request.getAccessToken().getTokenValue()).getJWTClaimsSet().getClaims();
        } catch (ParseException e) {
            log.debug("Access token is not a readable JWT, skipping it as a role source");
            return Map.of();
        }
    }

    private static String userNameAttributeName(OidcUserRequest request) {
        return request.getClientRegistration()
                .getProviderDetails()
                .getUserInfoEndpoint()
                .getUserNameAttributeName();
    }
}
