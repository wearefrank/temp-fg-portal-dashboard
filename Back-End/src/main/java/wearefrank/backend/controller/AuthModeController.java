package wearefrank.backend.controller;

import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import wearefrank.backend.config.security.ConsoleAuthenticator;
import wearefrank.backend.dto.AuthModeDto;

/**
 * Tells the frontend which authenticator is active. Deliberately reachable without a
 * session - it is what an unauthenticated visitor consults to find the way in.
 */
@RestController
@RequestMapping("/api/auth")
@CrossOrigin(origins = "http://localhost:5173")
public class AuthModeController {

    private final ConsoleAuthenticator authenticator;

    public AuthModeController(ConsoleAuthenticator authenticator) {
        this.authenticator = authenticator;
    }

    @GetMapping("/mode")
    public AuthModeDto mode() {
        return new AuthModeDto(authenticator.type(), authenticator.loginUrl());
    }
}
