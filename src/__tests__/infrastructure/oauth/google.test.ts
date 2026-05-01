import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { googleOAuthAdapter } from '@/infrastructure/oauth/google';

describe('googleOAuthAdapter.revokeToken', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('posts to the Google revocation endpoint with the access token', async () => {
        vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));

        await googleOAuthAdapter.revokeToken({
            accessToken: 'ya29.access-token',
            refreshToken: null,
        });

        expect(fetch).toHaveBeenCalledWith(
            'https://oauth2.googleapis.com/revoke?token=ya29.access-token',
            expect.objectContaining({ method: 'POST' })
        );
    });

    it('encodes special characters in the access token', async () => {
        vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));

        await googleOAuthAdapter.revokeToken({
            accessToken: 'token with spaces & special=chars',
            refreshToken: null,
        });

        const calledUrl = vi.mocked(fetch).mock.calls[0]?.[0] as string;
        expect(calledUrl).toContain(
            encodeURIComponent('token with spaces & special=chars')
        );
    });

    it('throws when the response status is not 200', async () => {
        vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 400 }));

        await expect(
            googleOAuthAdapter.revokeToken({
                accessToken: 'expired-token',
                refreshToken: null,
            })
        ).rejects.toThrow('Google token revocation failed with status 400');
    });
});
