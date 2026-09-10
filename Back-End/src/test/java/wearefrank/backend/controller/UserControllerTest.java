package wearefrank.backend.controller;

import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import wearefrank.backend.dto.UserDto;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The two principal types have to come out looking the same, otherwise every feature that
 * shows a user or checks a role would work under one authenticator and not the other.
 */
class UserControllerTest {

    private final UserController controller = new UserController();

    /**
     * The name and groups come from the claims, but the roles arrive as authorities:
     * RoleClaimOidcUserService has already mapped the configured claim by the time a
     * request reaches a controller, so this mirrors what a real login produces.
     */
    @Test
    void readsAnOidcUserFromItsClaimsAndAuthorities() {
        OidcIdToken idToken = OidcIdToken.withTokenValue("token")
                .claim("sub", "9f1c")
                .claim("preferred_username", "alice")
                .claim("groups", List.of("/platform-team"))
                .build();
        List<GrantedAuthority> authorities = List.of(
                new SimpleGrantedAuthority("ROLE_gateway-admin"),
                new SimpleGrantedAuthority("ROLE_offline_access"),
                new SimpleGrantedAuthority("ROLE_default-roles-frank"),
                new SimpleGrantedAuthority("SCOPE_openid"));
        Authentication authentication = new TestingAuthenticationToken(
                new DefaultOidcUser(authorities, idToken, "preferred_username"), "n/a", authorities);

        UserDto user = controller.getCurrentUser(authentication);

        assertThat(user.name()).isEqualTo("alice");
        assertThat(user.roles()).containsExactly("gateway-admin");
        assertThat(user.groups()).containsExactly("platform-team");
    }

    @Test
    void readsALocalUserFromItsAuthorities() {
        UserDetails details = User.withUsername("bob")
                .password("{noop}secret")
                .roles("gateway-user")
                .build();
        Authentication authentication =
                new TestingAuthenticationToken(details, "n/a", List.copyOf(details.getAuthorities()));

        UserDto user = controller.getCurrentUser(authentication);

        // Same shape as the OIDC case: no ROLE_ prefix leaking out to the frontend.
        assertThat(user.name()).isEqualTo("bob");
        assertThat(user.roles()).containsExactly("gateway-user");
        assertThat(user.groups()).isEmpty();
    }

    /**
     * A real form login also carries FACTOR_PASSWORD, which Spring Security adds to record
     * how the user authenticated. Showing it as a role would be nonsense to the reader.
     */
    @Test
    void ignoresAuthoritiesThatAreNotRoles() {
        Authentication authentication = new TestingAuthenticationToken("bob", "n/a", List.of(
                new SimpleGrantedAuthority("ROLE_gateway-user"),
                new SimpleGrantedAuthority("FACTOR_PASSWORD"),
                new SimpleGrantedAuthority("SCOPE_openid")));

        assertThat(controller.getCurrentUser(authentication).roles()).containsExactly("gateway-user");
    }

    @Test
    void returnsAnEmptyUserWhenThereIsNoAuthentication() {
        UserDto user = controller.getCurrentUser(null);

        assertThat(user.name()).isNull();
        assertThat(user.roles()).isEmpty();
        assertThat(user.groups()).isEmpty();
    }
}
