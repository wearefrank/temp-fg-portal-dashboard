package wearefrank.backend;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

// The other half of the switch: the same application with no identity provider anywhere in
// the picture. Together with BackEndApplicationTests this is the guard against an OIDC-only
// bean creeping back into the shared configuration.
@SpringBootTest(properties = {
        "console.security.auth.type=IN_MEMORY",
        "console.security.auth.in-memory.users[0].username=admin",
        "console.security.auth.in-memory.users[0].password={noop}secret",
        "console.security.auth.in-memory.users[0].roles=gateway-admin"
})
class BackEndApplicationInMemoryAuthTests {

    @Test
    void contextLoads() {
    }

}
