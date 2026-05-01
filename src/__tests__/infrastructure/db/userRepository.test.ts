import { oauthAccounts, users } from '@/infrastructure/db/schema';
import { decryptToken } from '@/infrastructure/db/tokenEncryption';
import type { SiglensDatabase } from '@/infrastructure/db/types';
import { DrizzleUserRepository } from '@/infrastructure/db/userRepository';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const VALID_KEY_HEX = 'a'.repeat(64);

const userRecord = {
    id: 'user-1',
    email: 'user@example.com',
    name: 'Ada',
    avatarUrl: null,
    tier: 'free',
    emailVerified: true,
    createdAt: new Date('2026-04-26T00:00:00.000Z'),
    updatedAt: new Date('2026-04-26T00:00:01.000Z'),
};

function makeSelectDb(rows: unknown[]): {
    db: SiglensDatabase;
    select: ReturnType<typeof vi.fn>;
    from: ReturnType<typeof vi.fn>;
    innerJoin: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
} {
    const limit = vi.fn().mockResolvedValue(rows);
    const where = vi.fn(() => ({ limit }));
    const innerJoin = vi.fn(() => ({ where }));
    const from = vi.fn(() => ({ innerJoin, where }));
    const select = vi.fn(() => ({ from }));

    return {
        db: { select } as unknown as SiglensDatabase,
        select,
        from,
        innerJoin,
        where,
        limit,
    };
}

function makeInsertDb(rows: unknown[]): {
    db: SiglensDatabase;
    insert: ReturnType<typeof vi.fn>;
    values: ReturnType<typeof vi.fn>;
    onConflictDoNothing: ReturnType<typeof vi.fn>;
    returning: ReturnType<typeof vi.fn>;
} {
    const returning = vi.fn().mockResolvedValue(rows);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const insert = vi.fn(() => ({ values }));

    return {
        db: { insert } as unknown as SiglensDatabase,
        insert,
        values,
        onConflictDoNothing,
        returning,
    };
}

function makeDeleteDb(rows: unknown[]): {
    db: SiglensDatabase;
    delete: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    returning: ReturnType<typeof vi.fn>;
} {
    const returning = vi.fn().mockResolvedValue(rows);
    const where = vi.fn(() => ({ returning }));
    const deleteFn = vi.fn(() => ({ where }));

    return {
        db: { delete: deleteFn } as unknown as SiglensDatabase,
        delete: deleteFn,
        where,
        returning,
    };
}

function makeTransactionDb(options: {
    userRows: unknown[];
    accountRows: unknown[];
}): {
    db: SiglensDatabase;
    transaction: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    userValues: ReturnType<typeof vi.fn>;
    accountValues: ReturnType<typeof vi.fn>;
    userOnConflictDoNothing: ReturnType<typeof vi.fn>;
    accountOnConflictDoNothing: ReturnType<typeof vi.fn>;
    userReturning: ReturnType<typeof vi.fn>;
    accountReturning: ReturnType<typeof vi.fn>;
} {
    const userReturning = vi.fn().mockResolvedValue(options.userRows);
    const accountReturning = vi.fn().mockResolvedValue(options.accountRows);
    const userOnConflictDoNothing = vi.fn(() => ({
        returning: userReturning,
    }));
    const accountOnConflictDoNothing = vi.fn(() => ({
        returning: accountReturning,
    }));
    const userValues = vi.fn(() => ({
        onConflictDoNothing: userOnConflictDoNothing,
    }));
    const accountValues = vi.fn(() => ({
        onConflictDoNothing: accountOnConflictDoNothing,
    }));
    const insert = vi
        .fn()
        .mockReturnValueOnce({ values: userValues })
        .mockReturnValueOnce({ values: accountValues });
    const tx = { insert };
    const transaction = vi.fn(async callback => callback(tx));

    return {
        db: { transaction } as unknown as SiglensDatabase,
        transaction,
        insert,
        userValues,
        accountValues,
        userOnConflictDoNothing,
        accountOnConflictDoNothing,
        userReturning,
        accountReturning,
    };
}

function makeFailingTransactionDb(error: Error): {
    db: SiglensDatabase;
} {
    const transaction = vi.fn().mockRejectedValue(error);

    return {
        db: { transaction } as unknown as SiglensDatabase,
    };
}

function makeUpdateDb(rows: unknown[]): {
    db: SiglensDatabase;
    update: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    returning: ReturnType<typeof vi.fn>;
} {
    const returning = vi.fn().mockResolvedValue(rows);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));

    return {
        db: { update } as unknown as SiglensDatabase,
        update,
        set,
        where,
        returning,
    };
}

describe('DrizzleUserRepository', () => {
    it('returns a user found by email', async () => {
        const { db, select, from, where, limit } = makeSelectDb([userRecord]);
        const repository = new DrizzleUserRepository(db);

        const result = await repository.findByEmail('user@example.com');

        expect(select).toHaveBeenCalledWith(expect.any(Object));
        expect(from).toHaveBeenCalledWith(expect.any(Object));
        expect(where).toHaveBeenCalledWith(expect.any(Object));
        expect(limit).toHaveBeenCalledWith(1);
        expect(result).toEqual(userRecord);
    });

    it('returns null when no user is found by email', async () => {
        const { db } = makeSelectDb([]);
        const repository = new DrizzleUserRepository(db);

        const result = await repository.findByEmail('missing@example.com');

        expect(result).toBeNull();
    });

    it('returns a user found by id', async () => {
        const { db, select, from, where, limit } = makeSelectDb([userRecord]);
        const repository = new DrizzleUserRepository(db);

        const result = await repository.findById('user-1');

        expect(select).toHaveBeenCalledWith(expect.any(Object));
        expect(from).toHaveBeenCalledWith(expect.any(Object));
        expect(where).toHaveBeenCalledWith(expect.any(Object));
        expect(limit).toHaveBeenCalledWith(1);
        expect(result).toEqual(userRecord);
    });

    it('returns null when no user is found by id', async () => {
        const { db } = makeSelectDb([]);
        const repository = new DrizzleUserRepository(db);

        const result = await repository.findById('missing-user');

        expect(result).toBeNull();
    });

    it('returns true when deleting an existing user', async () => {
        const {
            db,
            delete: deleteFn,
            where,
            returning,
        } = makeDeleteDb([{ id: 'user-1' }]);
        const repository = new DrizzleUserRepository(db);

        const result = await repository.deleteUser('user-1');

        expect(deleteFn).toHaveBeenCalledWith(users);
        expect(where).toHaveBeenCalledWith(expect.any(Object));
        expect(returning).toHaveBeenCalledWith({ id: users.id });
        expect(result).toBe(true);
    });

    it('returns false when no user is deleted', async () => {
        const { db } = makeDeleteDb([]);
        const repository = new DrizzleUserRepository(db);

        const result = await repository.deleteUser('missing-user');

        expect(result).toBe(false);
    });

    it('returns an email-auth user with password hash', async () => {
        const emailAuthRecord = {
            ...userRecord,
            passwordHash: 'hashed-password',
        };
        const { db, select, from, where, limit } = makeSelectDb([
            emailAuthRecord,
        ]);
        const repository = new DrizzleUserRepository(db);

        const result =
            await repository.findEmailAuthUserByEmail('user@example.com');

        expect(select).toHaveBeenCalledWith(expect.any(Object));
        expect(from).toHaveBeenCalledWith(expect.any(Object));
        expect(where).toHaveBeenCalledWith(expect.any(Object));
        expect(limit).toHaveBeenCalledWith(1);
        expect(result).toEqual(emailAuthRecord);
    });

    it('returns null when no email-auth user is found', async () => {
        const { db } = makeSelectDb([]);
        const repository = new DrizzleUserRepository(db);

        const result = await repository.findEmailAuthUserByEmail(
            'missing@example.com'
        );

        expect(result).toBeNull();
    });

    it('inserts a free-tier email user with password hash', async () => {
        const { db, insert, values, onConflictDoNothing, returning } =
            makeInsertDb([userRecord]);
        const repository = new DrizzleUserRepository(db);

        const result = await repository.createEmailUser({
            email: 'user@example.com',
            passwordHash: 'hashed-password',
            name: 'Ada',
        });

        expect(insert).toHaveBeenCalledWith(users);
        expect(values).toHaveBeenCalledWith({
            email: 'user@example.com',
            passwordHash: 'hashed-password',
            name: 'Ada',
            avatarUrl: null,
            tier: 'free',
            emailVerified: false,
        });
        expect(onConflictDoNothing).toHaveBeenCalledWith({
            target: users.email,
        });
        expect(returning).toHaveBeenCalledWith({
            id: users.id,
            email: users.email,
            name: users.name,
            avatarUrl: users.avatarUrl,
            tier: users.tier,
            emailVerified: users.emailVerified,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
        });
        expect(result).toEqual(userRecord);
    });

    it('inserts a user with avatarUrl provided', async () => {
        const recordWithAvatar = {
            ...userRecord,
            avatarUrl: 'https://example.com/avatar.png',
        };
        const { db, values } = makeInsertDb([recordWithAvatar]);
        const repository = new DrizzleUserRepository(db);

        const result = await repository.createEmailUser({
            email: 'user@example.com',
            passwordHash: 'hashed-password',
            avatarUrl: 'https://example.com/avatar.png',
        });

        expect(values).toHaveBeenCalledWith(
            expect.objectContaining({
                avatarUrl: 'https://example.com/avatar.png',
            })
        );
        expect(result).toEqual(recordWithAvatar);
    });

    it('returns null when email insert conflicts', async () => {
        const { db } = makeInsertDb([]);
        const repository = new DrizzleUserRepository(db);

        const result = await repository.createEmailUser({
            email: 'user@example.com',
            passwordHash: 'hashed-password',
        });

        expect(result).toBeNull();
    });

    it('returns a user found by OAuth provider account', async () => {
        const { db, select, from, innerJoin, where, limit } = makeSelectDb([
            userRecord,
        ]);
        const repository = new DrizzleUserRepository(db);

        const result = await repository.findByOAuthAccount(
            'google',
            'provider-user-1'
        );

        expect(select).toHaveBeenCalledWith(expect.any(Object));
        expect(from).toHaveBeenCalledWith(expect.any(Object));
        expect(innerJoin).toHaveBeenCalledWith(
            expect.any(Object),
            expect.any(Object)
        );
        expect(where).toHaveBeenCalledWith(expect.any(Object));
        expect(limit).toHaveBeenCalledWith(1);
        expect(result).toEqual(userRecord);
    });

    it('returns null when no OAuth provider account is found', async () => {
        const { db } = makeSelectDb([]);
        const repository = new DrizzleUserRepository(db);

        const result = await repository.findByOAuthAccount(
            'google',
            'missing-provider-user'
        );

        expect(result).toBeNull();
    });

    it('creates a free-tier OAuth user and provider account link', async () => {
        const { db, userValues, accountValues, accountOnConflictDoNothing } =
            makeTransactionDb({
                userRows: [userRecord],
                accountRows: [{ id: 'oauth-account-1' }],
            });
        const repository = new DrizzleUserRepository(db);

        const result = await repository.createOAuthUser({
            email: 'user@example.com',
            provider: 'google',
            providerAccountId: 'provider-user-1',
            name: 'Ada',
        });

        expect(userValues).toHaveBeenCalledWith({
            email: 'user@example.com',
            passwordHash: null,
            name: 'Ada',
            avatarUrl: null,
            tier: 'free',
            emailVerified: true,
        });
        expect(accountValues).toHaveBeenCalledWith({
            userId: 'user-1',
            provider: 'google',
            providerAccountId: 'provider-user-1',
            accessToken: null,
            refreshToken: null,
            tokenExpiresAt: null,
        });
        expect(accountOnConflictDoNothing).toHaveBeenCalledWith({
            target: [oauthAccounts.provider, oauthAccounts.providerAccountId],
        });
        expect(result).toEqual(userRecord);
    });

    it('creates an OAuth user with avatarUrl provided', async () => {
        const { db, userValues } = makeTransactionDb({
            userRows: [userRecord],
            accountRows: [{ id: 'oauth-account-1' }],
        });
        const repository = new DrizzleUserRepository(db);

        const result = await repository.createOAuthUser({
            email: 'user@example.com',
            provider: 'kakao',
            providerAccountId: 'provider-user-1',
            avatarUrl: 'https://example.com/avatar.png',
        });

        expect(userValues).toHaveBeenCalledWith(
            expect.objectContaining({
                avatarUrl: 'https://example.com/avatar.png',
            })
        );
        expect(result).toEqual(userRecord);
    });

    describe('token encryption in createOAuthUser', () => {
        beforeEach(() => {
            vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', VALID_KEY_HEX);
        });

        afterEach(() => {
            vi.unstubAllEnvs();
        });

        it('encrypts access and refresh tokens before storage', async () => {
            const { db, accountValues } = makeTransactionDb({
                userRows: [userRecord],
                accountRows: [{ id: 'oauth-account-1' }],
            });
            const repository = new DrizzleUserRepository(db);
            const tokenExpiresAt = new Date('2026-06-01T00:00:00.000Z');

            await repository.createOAuthUser({
                email: 'user@example.com',
                provider: 'google',
                providerAccountId: 'provider-user-1',
                accessToken: 'plain-access-token',
                refreshToken: 'plain-refresh-token',
                tokenExpiresAt,
            });

            const callArg = accountValues.mock.calls[0][0] as {
                accessToken: string | null;
                refreshToken: string | null;
                tokenExpiresAt: Date | null;
            };

            expect(callArg.accessToken).not.toBeNull();
            expect(callArg.accessToken).not.toBe('plain-access-token');
            expect(callArg.refreshToken).not.toBeNull();
            expect(callArg.refreshToken).not.toBe('plain-refresh-token');
            expect(callArg.tokenExpiresAt).toEqual(tokenExpiresAt);

            expect(decryptToken(callArg.accessToken!, VALID_KEY_HEX)).toBe(
                'plain-access-token'
            );
            expect(decryptToken(callArg.refreshToken!, VALID_KEY_HEX)).toBe(
                'plain-refresh-token'
            );
        });

        it('stores null tokens when encryption key is absent', async () => {
            vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', '');
            const { db, accountValues } = makeTransactionDb({
                userRows: [userRecord],
                accountRows: [{ id: 'oauth-account-1' }],
            });
            const repository = new DrizzleUserRepository(db);

            await repository.createOAuthUser({
                email: 'user@example.com',
                provider: 'google',
                providerAccountId: 'provider-user-1',
                accessToken: 'plain-access-token',
                refreshToken: 'plain-refresh-token',
            });

            expect(accountValues).toHaveBeenCalledWith(
                expect.objectContaining({
                    accessToken: null,
                    refreshToken: null,
                })
            );
        });
    });

    it('returns null when OAuth user creation conflicts on email', async () => {
        const { db, insert } = makeTransactionDb({
            userRows: [],
            accountRows: [{ id: 'oauth-account-1' }],
        });
        const repository = new DrizzleUserRepository(db);

        const result = await repository.createOAuthUser({
            email: 'user@example.com',
            provider: 'google',
            providerAccountId: 'provider-user-1',
        });

        expect(insert).toHaveBeenCalledTimes(1);
        expect(result).toBeNull();
    });

    it('returns null when OAuth provider account link conflicts', async () => {
        const { db } = makeTransactionDb({
            userRows: [userRecord],
            accountRows: [],
        });
        const repository = new DrizzleUserRepository(db);

        const result = await repository.createOAuthUser({
            email: 'user@example.com',
            provider: 'apple',
            providerAccountId: 'provider-user-1',
        });

        expect(result).toBeNull();
    });

    it('rethrows unexpected OAuth user creation failures', async () => {
        const error = new Error('database unavailable');
        const { db } = makeFailingTransactionDb(error);
        const repository = new DrizzleUserRepository(db);

        await expect(
            repository.createOAuthUser({
                email: 'user@example.com',
                provider: 'google',
                providerAccountId: 'provider-user-1',
            })
        ).rejects.toThrow(error);
    });

    it('returns the tier found by user id', async () => {
        const { db, select, from, where, limit } = makeSelectDb([
            { tier: 'member' },
        ]);
        const repository = new DrizzleUserRepository(db);

        const result = await repository.getUserTier('user-1');

        expect(select).toHaveBeenCalledWith({ tier: expect.any(Object) });
        expect(from).toHaveBeenCalledWith(expect.any(Object));
        expect(where).toHaveBeenCalledWith(expect.any(Object));
        expect(limit).toHaveBeenCalledWith(1);
        expect(result).toBe('member');
    });

    it('returns null when no user tier is found', async () => {
        const { db } = makeSelectDb([]);
        const repository = new DrizzleUserRepository(db);

        const result = await repository.getUserTier('missing-user');

        expect(result).toBeNull();
    });

    it('updates a user tier and returns the persisted tier', async () => {
        const { db, update, set, where, returning } = makeUpdateDb([
            { tier: 'pro' },
        ]);
        const repository = new DrizzleUserRepository(db);

        const result = await repository.updateUserTier('user-1', 'pro');

        expect(update).toHaveBeenCalledWith(expect.any(Object));
        expect(set).toHaveBeenCalledWith({ tier: 'pro' });
        expect(where).toHaveBeenCalledWith(expect.any(Object));
        expect(returning).toHaveBeenCalledWith({ tier: expect.any(Object) });
        expect(result).toBe('pro');
    });

    it('returns null when no user tier is updated', async () => {
        const { db } = makeUpdateDb([]);
        const repository = new DrizzleUserRepository(db);

        const result = await repository.updateUserTier(
            'missing-user',
            'member'
        );

        expect(result).toBeNull();
    });

    it('updates the password hash and returns true when a row matches', async () => {
        const { db, update, set, where } = makeUpdateDb([{ id: 'user-1' }]);
        const repository = new DrizzleUserRepository(db);

        const result = await repository.updatePassword(
            'user-1',
            'new-password-hash'
        );

        expect(update).toHaveBeenCalledWith(users);
        expect(set).toHaveBeenCalledWith({ passwordHash: 'new-password-hash' });
        expect(where).toHaveBeenCalledWith(expect.any(Object));
        expect(result).toBe(true);
    });

    it('returns false when updatePassword finds no matching user', async () => {
        const { db } = makeUpdateDb([]);
        const repository = new DrizzleUserRepository(db);

        const result = await repository.updatePassword(
            'missing-user',
            'new-password-hash'
        );

        expect(result).toBe(false);
    });
});
