package wearefrank.backend.config;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import wearefrank.backend.config.security.ConsoleAuthenticator;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

class SecurityConfigTest {

    /**
     * An unset or misspelled console.security.auth.type leaves no authenticator. Starting
     * anyway would mean serving the whole console unauthenticated, so this must fail loudly.
     */
    @Test
    @SuppressWarnings("unchecked")
    void refusesToStartWithoutAnAuthenticator() {
        ObjectProvider<ConsoleAuthenticator> none = mock(ObjectProvider.class);

        // Throws before touching HttpSecurity, so there is nothing to pass for it.
        assertThatThrownBy(() -> new SecurityConfig().filterChain(null, none))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("console.security.auth.type")
                .hasMessageContaining("OIDC")
                .hasMessageContaining("IN_MEMORY");
    }
}
