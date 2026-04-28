import { afterEach, describe, expect, it, vi } from 'vitest';
import { usageLogs } from '@/infrastructure/db/schema';
import {
    DrizzleUsageRepository,
    hashUsageIp,
} from '@/infrastructure/db/usageRepository';
import type { SiglensDatabase } from '@/infrastructure/db/types';

const usageLogRecord = {
    id: 'usage-1',
    userId: 'user-1',
    ipHash: hashUsageIp('203.0.113.10', new Date('2026-04-28T12:00:00.000Z')),
    actionType: 'analysis',
    modelUsed: 'gemini-2.5-flash',
    date: '2026-04-28',
    createdAt: new Date('2026-04-28T12:00:01.000Z'),
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

function makeUsageCountDb(rows: unknown[]): {
    db: SiglensDatabase;
    select: ReturnType<typeof vi.fn>;
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
} {
    const groupBy = vi.fn().mockResolvedValue(rows);
    const where = vi.fn(() => ({ groupBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    return {
        db: { select } as unknown as SiglensDatabase,
        select,
        from,
        where,
        groupBy,
    };
}

describe('hashUsageIp', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns a stable SHA-256 hash for the same IP and UTC day', () => {
        const first = hashUsageIp(
            '203.0.113.10',
            new Date('2026-04-28T00:00:00.000Z')
        );
        const second = hashUsageIp(
            '203.0.113.10',
            new Date('2026-04-28T23:59:59.999Z')
        );

        expect(first).toBe(second);
        expect(first).toHaveLength(64);
        expect(first).toMatch(/^[0-9a-f]+$/);
    });

    it('uses a UTC daily salt so hashes reset on the next UTC day', () => {
        const today = hashUsageIp(
            '203.0.113.10',
            new Date('2026-04-28T23:59:59.999Z')
        );
        const tomorrow = hashUsageIp(
            '203.0.113.10',
            new Date('2026-04-29T00:00:00.000Z')
        );

        expect(today).not.toBe(tomorrow);
    });

    it('returns different hashes for different IP values', () => {
        const date = new Date('2026-04-28T12:00:00.000Z');

        expect(hashUsageIp('203.0.113.10', date)).not.toBe(
            hashUsageIp('203.0.113.11', date)
        );
    });

    it('uses the infrastructure clock when no date is provided', () => {
        const now = new Date('2026-04-28T12:00:00.000Z');
        vi.useFakeTimers();
        vi.setSystemTime(now);

        expect(hashUsageIp('203.0.113.10')).toBe(
            hashUsageIp('203.0.113.10', now)
        );
    });
});

describe('DrizzleUsageRepository', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('records usage with the hashed IP and UTC date only', async () => {
        const { db, insert, values, returning } = makeInsertDb([
            usageLogRecord,
        ]);
        const repository = new DrizzleUsageRepository(db);

        const result = await repository.recordUsage({
            userId: 'user-1',
            ipAddress: '203.0.113.10',
            actionType: 'analysis',
            modelUsed: 'gemini-2.5-flash',
            occurredAt: new Date('2026-04-28T12:00:00.000Z'),
        });

        expect(insert).toHaveBeenCalledWith(usageLogs);
        expect(values).toHaveBeenCalledWith({
            userId: 'user-1',
            ipHash: usageLogRecord.ipHash,
            actionType: 'analysis',
            modelUsed: 'gemini-2.5-flash',
            date: '2026-04-28',
        });
        expect(values).not.toHaveBeenCalledWith(
            expect.objectContaining({ ipAddress: '203.0.113.10' })
        );
        expect(returning).toHaveBeenCalledWith(expect.any(Object));
        expect(result).toEqual(usageLogRecord);
    });

    it('records anonymous usage with a null user id', async () => {
        const anonymousRecord = {
            ...usageLogRecord,
            userId: null,
            actionType: 'chatbot',
        };
        const { db, values } = makeInsertDb([anonymousRecord]);
        const repository = new DrizzleUsageRepository(db);

        const result = await repository.recordUsage({
            ipAddress: '203.0.113.10',
            actionType: 'chatbot',
            modelUsed: 'gemini-2.5-flash-lite',
            occurredAt: new Date('2026-04-28T12:00:00.000Z'),
        });

        expect(values).toHaveBeenCalledWith(
            expect.objectContaining({ userId: null })
        );
        expect(result.userId).toBeNull();
    });

    it('records usage with an explicit null user id and the infrastructure clock', async () => {
        const now = new Date('2026-04-29T00:00:00.000Z');
        const { db, values } = makeInsertDb([
            {
                ...usageLogRecord,
                userId: null,
                ipHash: hashUsageIp('203.0.113.10', now),
                date: '2026-04-29',
            },
        ]);
        const repository = new DrizzleUsageRepository(db);
        vi.useFakeTimers();
        vi.setSystemTime(now);

        const result = await repository.recordUsage({
            userId: null,
            ipAddress: '203.0.113.10',
            actionType: 'analysis',
            modelUsed: 'gemini-2.5-flash',
        });

        expect(values).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: null,
                ipHash: hashUsageIp('203.0.113.10', now),
                date: '2026-04-29',
            })
        );
        expect(result.date).toBe('2026-04-29');
    });

    it('counts today usage by action type for the UTC date bucket', async () => {
        const { db, select, from, where, groupBy } = makeUsageCountDb([
            { actionType: 'analysis', count: 2 },
            { actionType: 'chatbot', count: 3 },
        ]);
        const repository = new DrizzleUsageRepository(db);

        const result = await repository.getUsageToday(
            'hashed-ip',
            new Date('2026-04-28T23:59:59.999Z')
        );

        expect(select).toHaveBeenCalledWith({
            actionType: usageLogs.actionType,
            count: expect.any(Object),
        });
        expect(from).toHaveBeenCalledWith(usageLogs);
        expect(where).toHaveBeenCalledWith(expect.any(Object));
        expect(groupBy).toHaveBeenCalledWith(usageLogs.actionType);
        expect(result).toEqual({ analysis: 2, chatbot: 3 });
    });

    it('returns zero for action types with no rows today', async () => {
        const { db } = makeUsageCountDb([{ actionType: 'analysis', count: 4 }]);
        const repository = new DrizzleUsageRepository(db);

        const result = await repository.getUsageToday(
            'hashed-ip',
            new Date('2026-04-28T12:00:00.000Z')
        );

        expect(result).toEqual({ analysis: 4, chatbot: 0 });
    });

    it('returns zero counts when no usage rows exist today', async () => {
        const { db } = makeUsageCountDb([]);
        const repository = new DrizzleUsageRepository(db);

        const result = await repository.getUsageToday(
            'hashed-ip',
            new Date('2026-04-28T12:00:00.000Z')
        );

        expect(result).toEqual({ analysis: 0, chatbot: 0 });
    });

    it('uses the infrastructure clock when counting today usage without a date override', async () => {
        const { db } = makeUsageCountDb([{ actionType: 'chatbot', count: 1 }]);
        const repository = new DrizzleUsageRepository(db);
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-29T00:00:00.000Z'));

        const result = await repository.getUsageToday('hashed-ip');

        expect(result).toEqual({ analysis: 0, chatbot: 1 });
    });
});
