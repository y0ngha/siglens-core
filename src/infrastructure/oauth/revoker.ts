import type { OAuthProvider } from '@/domain/types';
import { googleOAuthAdapter } from './google';
import { kakaoOAuthAdapter } from './kakao';
import type {
    OAuthProviderAdapter,
    OAuthRevoker,
    RevokeTokenParams,
} from './types';

const ADAPTER_MAP: Partial<Record<OAuthProvider, OAuthProviderAdapter>> = {
    google: googleOAuthAdapter,
    kakao: kakaoOAuthAdapter,
};

/**
 * Composite OAuth revoker that delegates to provider-specific adapters.
 * Providers without a registered adapter are silently skipped.
 */
export const compositeOAuthRevoker: OAuthRevoker = {
    async revokeToken(
        provider: OAuthProvider,
        params: RevokeTokenParams
    ): Promise<void> {
        const adapter = ADAPTER_MAP[provider];
        if (adapter === undefined) {
            return;
        }
        await adapter.revokeToken(params);
    },
};
