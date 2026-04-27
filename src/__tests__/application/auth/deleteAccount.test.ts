import { describe, expect, it, vi } from 'vitest';
import { deleteAccount } from '@/application/auth';
import type { UserRepository } from '@/infrastructure/db/types';

function makeDependencies(deleted: boolean): {
    dependencies: { users: UserRepository };
    deleteUser: ReturnType<typeof vi.fn>;
} {
    const deleteUser = vi.fn().mockResolvedValue(deleted);

    return {
        dependencies: {
            users: {
                findByEmail: vi.fn(),
                findById: vi.fn(),
                createEmailUser: vi.fn(),
                deleteUser,
            },
        },
        deleteUser,
    };
}

describe('deleteAccount', () => {
    it('deletes the user account and reports success', async () => {
        const { dependencies, deleteUser } = makeDependencies(true);

        const result = await deleteAccount({ userId: 'user-1' }, dependencies);

        expect(deleteUser).toHaveBeenCalledWith('user-1');
        expect(result).toEqual({ ok: true });
    });

    it('returns user_not_found when no row matches the user id', async () => {
        const { dependencies } = makeDependencies(false);

        const result = await deleteAccount(
            { userId: 'missing-user' },
            dependencies
        );

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'user_not_found',
                message: 'User account does not exist',
            },
        });
    });
});
