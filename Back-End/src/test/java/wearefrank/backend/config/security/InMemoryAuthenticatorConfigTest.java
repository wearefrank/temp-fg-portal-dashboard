package wearefrank.backend.config.security;

import org.junit.jupiter.api.Test;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import wearefrank.backend.config.security.InMemoryUserProperties.ConsoleUser;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class InMemoryAuthenticatorConfigTest {

    private final InMemoryAuthenticatorConfig config = new InMemoryAuthenticatorConfig();

    @Test
    void mapsConfiguredUsersAndRoles() {
        UserDetailsService users = config.userDetailsService(new InMemoryUserProperties(
                List.of(new ConsoleUser("admin", "{noop}secret", List.of("gateway-admin")))));

        UserDetails admin = users.loadUserByUsername("admin");

        assertThat(admin.getPassword()).isEqualTo("{noop}secret");
        assertThat(admin.getAuthorities())
                .extracting(GrantedAuthority::getAuthority)
                .containsExactly("ROLE_gateway-admin");
    }

    @Test
    void allowsAUserWithoutRoles() {
        UserDetailsService users = config.userDetailsService(new InMemoryUserProperties(
                List.of(new ConsoleUser("reader", "{noop}secret", null))));

        assertThat(users.loadUserByUsername("reader").getAuthorities()).isEmpty();
    }

    /**
     * Without this, Spring Boot would step in with a generated user whose password lands in
     * the log - a working account nobody provisioned.
     */
    @Test
    void refusesToStartWithNoUsers() {
        assertThatThrownBy(() -> config.userDetailsService(new InMemoryUserProperties(List.of())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("no users are configured");

        assertThatThrownBy(() -> config.userDetailsService(new InMemoryUserProperties(null)))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void refusesAUserWithoutAPassword() {
        InMemoryUserProperties properties =
                new InMemoryUserProperties(List.of(new ConsoleUser("admin", "  ", List.of())));

        assertThatThrownBy(() -> config.userDetailsService(properties))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("admin");
    }

    @Test
    void verifiesBcryptPasswords() {
        PasswordEncoder encoder = config.passwordEncoder();
        String stored = "{bcrypt}" + new BCryptPasswordEncoder().encode("hunter2");

        assertThat(encoder.matches("hunter2", stored)).isTrue();
        assertThat(encoder.matches("wrong", stored)).isFalse();
    }
}
