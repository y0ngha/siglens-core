import { describe, expect, it, vi } from 'vitest';
import { DrizzleUserRepository } from '@/infrastructure/db/userRepository';
import type { SiglensDatabase } from '@/infrastructure/db/types';

const userRecord = {
    id: 'user-1',
    email: 'user@example.com',
    name: 'Ada',
    avatarUrl: null,
    tier: 'free',
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

        expect(insert).toHaveBeenCalledWith(expect.any(Object));
        expect(values).toHaveBeenCalledWith({
            email: 'user@example.com',
            passwordHash: 'hashed-password',
            name: 'Ada',
            avatarUrl: null,
            tier: 'free',
        });
        expect(onConflictDoNothing).toHaveBeenCalledWith({
            target: expect.any(Object),
        });
        expect(returning).toHaveBeenCalledWith(expect.any(Object));
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
        });
        expect(accountValues).toHaveBeenCalledWith({
            userId: 'user-1',
            provider: 'google',
            providerAccountId: 'provider-user-1',
        });
        expect(accountOnConflictDoNothing).toHaveBeenCalledWith({
            target: [expect.any(Object), expect.any(Object)],
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
});
