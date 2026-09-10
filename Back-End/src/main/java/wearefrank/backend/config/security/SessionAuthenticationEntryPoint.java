package wearefrank.backend.config.security;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;

/**
 * Answers unauthenticated /api calls with a 401 carrying {@link #HEADER}, so the frontend
 * can tell it apart from a 401 relayed from a git provider.
 */
public class SessionAuthenticationEntryPoint implements AuthenticationEntryPoint {

    public static final String HEADER = "X-Session-Expired";

    @Override
    public void commence(HttpServletRequest request,
                         HttpServletResponse response,
                         AuthenticationException authException) {
        // setStatus, not sendError: sendError dispatches to /error and adds a body.
        response.setHeader(HEADER, "true");
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
    }
}
