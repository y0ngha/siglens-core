import { describe, expect, it, vi } from 'vitest';
import { inquiries } from '@/infrastructure/db/schema';
import { DrizzleInquiryRepository } from '@/infrastructure/db/inquiryRepository';
import type { InquiryInput, SiglensDatabase } from '@/infrastructure/db/types';

function makeInsertDb(): {
    db: SiglensDatabase;
    insert: ReturnType<typeof vi.fn>;
    values: ReturnType<typeof vi.fn>;
} {
    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn(() => ({ values }));

    return {
        db: { insert } as unknown as SiglensDatabase,
        insert,
        values,
    };
}

const validInput: InquiryInput = {
    title: 'Test inquiry',
    content: 'Test content body',
    email: 'visitor@example.com',
};

describe('DrizzleInquiryRepository', () => {
    describe('create', () => {
        it('inserts the inquiry into the database with explicit fields', async () => {
            const { db, insert, values } = makeInsertDb();
            const repository = new DrizzleInquiryRepository(db);

            await repository.create(validInput);

            expect(insert).toHaveBeenCalledWith(inquiries);
            expect(values).toHaveBeenCalledWith({
                title: 'Test inquiry',
                content: 'Test content body',
                email: 'visitor@example.com',
            });
        });

        it('propagates database errors to the caller', async () => {
            const dbError = new Error('db connection lost');
            const values = vi.fn().mockRejectedValue(dbError);
            const insert = vi.fn(() => ({ values }));
            const db = { insert } as unknown as SiglensDatabase;
            const repository = new DrizzleInquiryRepository(db);

            await expect(repository.create(validInput)).rejects.toThrow(
                'db connection lost'
            );
        });
    });
});
