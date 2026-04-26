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
    where: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
} {
    const limit = vi.fn().mockResolvedValue(rows);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    return {
        db: { select } as unknown as SiglensDatabase,
        select,
        from,
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
});
