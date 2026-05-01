import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kakaoOAuthAdapter } from '@/infrastructure/oauth/kakao';

describe('kakaoOAuthAdapter.revokeToken', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('posts to the Kakao unlink endpoint with Bearer authorization', async () => {
        vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));

        await kakaoOAuthAdapter.revokeToken({
            accessToken: 'kakao-access-token',
            refreshToken: null,
        });

        expect(fetch).toHaveBeenCalledWith(
            'https://kapi.kakao.com/v1/user/unlink',
            expect.objectContaining({
                method: 'POST',
                headers: { Authorization: 'Bearer kakao-access-token' },
            })
        );
    });

    it('throws when the response status is not 200', async () => {
        vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));

        await expect(
            kakaoOAuthAdapter.revokeToken({
                accessToken: 'invalid-token',
                refreshToken: null,
            })
        ).rejects.toThrow('Kakao token revocation failed with status 401');
    });
});
