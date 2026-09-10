package wearefrank.backend;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

// The issuer points at a port nothing listens on, on purpose: the client registration is
// resolved on the first login rather than while the context builds, so an unreachable
// provider must not stop the application from starting. This used to be a crashloop.
@SpringBootTest(properties = {
        "application.security.console.authentication.type=OAUTH2",
        "application.security.console.authentication.issuerUri=http://localhost:1/realms/frank",
        "application.security.console.authentication.clientId=test-client",
        "application.security.console.authentication.clientSecret=test-secret",
        "application.security.console.authentication.scopes=openid"
})
class BackEndApplicationTests {

    @Test
    void contextLoads() {
    }

}
