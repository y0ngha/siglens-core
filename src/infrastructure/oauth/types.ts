import type { OAuthProvider } from '@/domain/types';

/** Parameters for revoking a provider OAuth token. */
export interface RevokeTokenParams {
    /** Plain-text access token to revoke. */
    accessToken: string;
    /** Plain-text refresh token; null when not available. */
    refreshToken: string | null;
}

/**
 * @internal Per-provider adapter that revokes an OAuth grant at the provider side.
 */
export interface OAuthProviderAdapter {
    /**
     * Revoke the given OAuth token at the provider.
     *
     * @param params - Access and optional refresh token to revoke.
     * @throws When the revocation request fails. Callers should treat this as fire-and-forget.
     */
    revokeToken(params: RevokeTokenParams): Promise<void>;
}

/**
 * Provider-agnostic revoker that routes to the appropriate {@link OAuthProviderAdapter}.
 */
export interface OAuthRevoker {
    /**
     * Revoke tokens for the given provider.
     *
     * @param provider - OAuth provider owning the grant.
     * @param params - Access and optional refresh token.
     * @throws When the revocation request fails.
     */
    revokeToken(
        provider: OAuthProvider,
        params: RevokeTokenParams
    ): Promise<void>;
}
