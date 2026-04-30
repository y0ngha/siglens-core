import { describe, expect, it, vi } from 'vitest';
import { compositeOAuthRevoker } from '@/infrastructure/oauth/revoker';

vi.mock('@/infrastructure/oauth/google', () => ({
    googleOAuthAdapter: {
        revokeToken: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('@/infrastructure/oauth/kakao', () => ({
    kakaoOAuthAdapter: {
        revokeToken: vi.fn().mockResolvedValue(undefined),
    },
}));

describe('compositeOAuthRevoker', () => {
    it('delegates to the registered adapter for a known provider', async () => {
        const { googleOAuthAdapter } =
            await import('@/infrastructure/oauth/google');

        await compositeOAuthRevoker.revokeToken('google', {
            accessToken: 'access-token',
            refreshToken: null,
        });

        expect(googleOAuthAdapter.revokeToken).toHaveBeenCalledWith({
            accessToken: 'access-token',
            refreshToken: null,
        });
    });

    it('delegates to the kakao adapter for kakao provider', async () => {
        const { kakaoOAuthAdapter } =
            await import('@/infrastructure/oauth/kakao');

        await compositeOAuthRevoker.revokeToken('kakao', {
            accessToken: 'kakao-access-token',
            refreshToken: null,
        });

        expect(kakaoOAuthAdapter.revokeToken).toHaveBeenCalledWith({
            accessToken: 'kakao-access-token',
            refreshToken: null,
        });
    });

    it('skips silently when no adapter is registered for the provider', async () => {
        await expect(
            compositeOAuthRevoker.revokeToken('apple', {
                accessToken: 'access-token',
                refreshToken: null,
            })
        ).resolves.toBeUndefined();
    });
});
