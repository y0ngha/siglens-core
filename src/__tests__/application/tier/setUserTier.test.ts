import { describe, expect, it, vi } from 'vitest';
import { setUserTier } from '@/application/tier';
import type { UserTierRepository } from '@/infrastructure/db';

function makeRepository(
    tier: Awaited<ReturnType<UserTierRepository['updateUserTier']>>
): {
    repository: UserTierRepository;
    updateUserTierMock: ReturnType<typeof vi.fn>;
} {
    const getUserTier = vi.fn().mockResolvedValue(null);
    const updateUserTierMock = vi.fn().mockResolvedValue(tier);

    return {
        repository: {
            getUserTier,
            updateUserTier: updateUserTierMock,
        },
        updateUserTierMock,
    };
}

describe('setUserTier', () => {
    it('updates a user tier for admin workflows', async () => {
        const { repository, updateUserTierMock } = makeRepository('pro');

        const result = await setUserTier(
            { userId: 'user-1', tier: 'pro' },
            { users: repository }
        );

        expect(updateUserTierMock).toHaveBeenCalledWith('user-1', 'pro');
        expect(result).toEqual({ ok: true, userId: 'user-1', tier: 'pro' });
    });

    it('returns a not-found error when the target user does not exist', async () => {
        const { repository, updateUserTierMock } = makeRepository(null);

        const result = await setUserTier(
            { userId: 'missing-user', tier: 'member' },
            { users: repository }
        );

        expect(updateUserTierMock).toHaveBeenCalledWith(
            'missing-user',
            'member'
        );
        expect(result).toEqual({
            ok: false,
            error: {
                code: 'user_not_found',
                message: 'User was not found',
            },
        });
    });
});
