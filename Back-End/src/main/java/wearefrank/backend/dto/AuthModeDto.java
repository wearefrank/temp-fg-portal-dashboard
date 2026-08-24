package wearefrank.backend.dto;

/**
 * How this deployment logs users in. The frontend needs it before authenticating, to
 * decide between rendering a password form and handing off to an identity provider.
 */
public record AuthModeDto(String type, String loginUrl) {}
