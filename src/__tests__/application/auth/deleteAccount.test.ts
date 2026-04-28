import { describe, expect, it, vi } from 'vitest';
import { AUTH_SESSION_COOKIE_NAME, deleteAccount } from '@/application/auth';
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
    it('deletes the user account and returns an expired HTTP-only cookie', async () => {
        const { dependencies, deleteUser } = makeDependencies(true);

        const result = await deleteAccount({ userId: 'user-1' }, dependencies);

        expect(deleteUser).toHaveBeenCalledWith('user-1');
        expect(result).toEqual({
            ok: true,
            cookie: {
                name: AUTH_SESSION_COOKIE_NAME,
                value: '',
                httpOnly: true,
                secure: true,
                sameSite: 'lax',
                path: '/',
                expires: new Date('1970-01-01T00:00:00.000Z'),
                maxAgeSeconds: 0,
            },
        });
    });

    it('applies custom cookie overrides on success', async () => {
        const { dependencies } = makeDependencies(true);

        const result = await deleteAccount({ userId: 'user-1' }, dependencies, {
            cookieName: 'custom_session',
            secureCookie: false,
            sameSite: 'none',
            path: '/app',
        });

        expect(result).toEqual({
            ok: true,
            cookie: {
                name: 'custom_session',
                value: '',
                httpOnly: true,
                secure: false,
                sameSite: 'none',
                path: '/app',
                expires: new Date('1970-01-01T00:00:00.000Z'),
                maxAgeSeconds: 0,
            },
        });
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
