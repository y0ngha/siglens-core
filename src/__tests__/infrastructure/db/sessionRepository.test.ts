import { describe, expect, it, vi } from 'vitest';
import { DrizzleSessionRepository } from '@/infrastructure/db/sessionRepository';
import type { SiglensDatabase } from '@/infrastructure/db/types';

const expiresAt = new Date('2026-05-27T00:00:00.000Z');
const sessionRecord = {
    id: 'session-1',
    userId: 'user-1',
    expiresAt,
    createdAt: new Date('2026-04-27T00:00:00.000Z'),
};

function makeInsertDb(rows: unknown[]): {
    db: SiglensDatabase;
    insert: ReturnType<typeof vi.fn>;
    values: ReturnType<typeof vi.fn>;
    returning: ReturnType<typeof vi.fn>;
} {
    const returning = vi.fn().mockResolvedValue(rows);
    const values = vi.fn(() => ({ returning }));
    const insert = vi.fn(() => ({ values }));

    return {
        db: { insert } as unknown as SiglensDatabase,
        insert,
        values,
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

describe('DrizzleSessionRepository', () => {
    it('creates a session for a user', async () => {
        const { db, insert, values, returning } = makeInsertDb([sessionRecord]);
        const repository = new DrizzleSessionRepository(db);

        const result = await repository.createSession({
            userId: 'user-1',
            expiresAt,
        });

        expect(insert).toHaveBeenCalledWith(expect.any(Object));
        expect(values).toHaveBeenCalledWith({
            userId: 'user-1',
            expiresAt,
        });
        expect(returning).toHaveBeenCalledWith(
            expect.objectContaining({
                id: expect.any(Object),
                userId: expect.any(Object),
                expiresAt: expect.any(Object),
                createdAt: expect.any(Object),
            })
        );
        expect(result).toEqual(sessionRecord);
    });

    it('returns true when deleting an existing session', async () => {
        const {
            db,
            delete: deleteFn,
            where,
            returning,
        } = makeDeleteDb([{ id: 'session-1' }]);
        const repository = new DrizzleSessionRepository(db);

        const result = await repository.deleteSession('session-1');

        expect(deleteFn).toHaveBeenCalledWith(expect.any(Object));
        expect(where).toHaveBeenCalledWith(expect.any(Object));
        expect(returning).toHaveBeenCalledWith({ id: expect.any(Object) });
        expect(result).toBe(true);
    });

    it('returns false when no session is deleted', async () => {
        const { db } = makeDeleteDb([]);
        const repository = new DrizzleSessionRepository(db);

        const result = await repository.deleteSession('missing-session');

        expect(result).toBe(false);
    });
});
