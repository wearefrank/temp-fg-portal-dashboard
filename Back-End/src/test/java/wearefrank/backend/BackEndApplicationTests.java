package wearefrank.backend;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

// The issuer points at a port nothing listens on, on purpose: the client registration is
// resolved on the first login rather than while the context builds, so an unreachable
// provider must not stop the application from starting. This used to be a crashloop.
@SpringBootTest(properties = {
        "console.security.auth.type=OIDC",
        "console.security.auth.oidc.issuer-uri=http://localhost:1/realms/frank",
        "console.security.auth.oidc.client-id=test-client",
        "console.security.auth.oidc.client-secret=test-secret",
        "console.security.auth.oidc.scope=openid"
})
class BackEndApplicationTests {

    @Test
    void contextLoads() {
    }

}
