package wearefrank.backend.dto;

/**
 * Link status of one git provider brokered through Keycloak.
 *
 * available - this deployment brokers the provider at all; when false the UI keeps
 *             asking for a personal access token.
 * linked    - this user has connected their account and Keycloak holds a token for it.
 * username  - the account name at the provider, null when unknown or not linked.
 */
public record GitIdentityDto(boolean available, boolean linked, String username) {
}
