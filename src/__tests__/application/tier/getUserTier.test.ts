import { describe, expect, it, vi } from 'vitest';
import { getUserTier } from '@/application/tier';
import type { UserTierRepository } from '@/infrastructure/db';

function makeRepository(
    tier: Awaited<ReturnType<UserTierRepository['getUserTier']>>
): {
    repository: UserTierRepository;
    getUserTierMock: ReturnType<typeof vi.fn>;
} {
    const getUserTierMock = vi.fn().mockResolvedValue(tier);
    const updateUserTier = vi.fn().mockResolvedValue(null);

    return {
        repository: {
            getUserTier: getUserTierMock,
            updateUserTier,
        },
        getUserTierMock,
    };
}

describe('getUserTier', () => {
    it('returns the persisted user tier', async () => {
        const { repository, getUserTierMock } = makeRepository('pro');

        const result = await getUserTier(
            { userId: 'user-1' },
            { users: repository }
        );

        expect(getUserTierMock).toHaveBeenCalledWith('user-1');
        expect(result).toBe('pro');
    });

    it('falls back to free when the user is missing', async () => {
        const { repository, getUserTierMock } = makeRepository(null);

        const result = await getUserTier(
            { userId: 'missing-user' },
            { users: repository }
        );

        expect(getUserTierMock).toHaveBeenCalledWith('missing-user');
        expect(result).toBe('free');
    });
});
