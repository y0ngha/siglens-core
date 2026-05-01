import { encryptToken } from '@/infrastructure/db/tokenEncryption';
import type { SiglensDatabase } from '@/infrastructure/db/types';
import { DrizzleUserApiKeyRepository } from '@/infrastructure/db/userApiKeyRepository';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const VALID_KEY_HEX = 'b'.repeat(64);
const OTHER_KEY_HEX = 'c'.repeat(64);
const PLAINTEXT_API_KEY = 'sk-ant-test-1234';
const createdAt = new Date('2026-05-01T00:00:00.000Z');
const updatedAt = new Date('2026-05-01T00:00:01.000Z');

const metaRow = {
    id: 'key-1',
    userId: 'user-1',
    provider: 'anthropic' as const,
    createdAt,
    updatedAt,
};

function makeUpsertDb(rows: unknown[]): {
    db: SiglensDatabase;
    insert: ReturnType<typeof vi.fn>;
    values: ReturnType<typeof vi.fn>;
    onConflictDoUpdate: ReturnType<typeof vi.fn>;
    returning: ReturnType<typeof vi.fn>;
} {
    const returning = vi.fn().mockResolvedValue(rows);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));

    return {
        db: { insert } as unknown as SiglensDatabase,
        insert,
        values,
        onConflictDoUpdate,
        returning,
    };
}

function makeFindByUserDb(rows: unknown[]): {
    db: SiglensDatabase;
    where: ReturnType<typeof vi.fn>;
} {
    const where = vi.fn().mockResolvedValue(rows);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    return {
        db: { select } as unknown as SiglensDatabase,
        where,
    };
}

function makeFindByUserAndProviderDb(rows: unknown[]): {
    db: SiglensDatabase;
    limit: ReturnType<typeof vi.fn>;
} {
    const limit = vi.fn().mockResolvedValue(rows);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    return {
        db: { select } as unknown as SiglensDatabase,
        limit,
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

describe('DrizzleUserApiKeyRepository.upsert', () => {
    beforeEach(() => {
        vi.stubEnv('LLM_API_KEY_ENCRYPTION_KEY', VALID_KEY_HEX);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('throws when the LLM encryption key is missing', async () => {
        vi.stubEnv('LLM_API_KEY_ENCRYPTION_KEY', '');
        const { db } = makeUpsertDb([metaRow]);
        const repo = new DrizzleUserApiKeyRepository(db);

        await expect(
            repo.upsert({
                userId: 'user-1',
                provider: 'anthropic',
                apiKey: PLAINTEXT_API_KEY,
            })
        ).rejects.toThrow(
            'LLM_API_KEY_ENCRYPTION_KEY environment variable is required'
        );
    });

    it('throws when the LLM encryption key has the wrong byte length', async () => {
        vi.stubEnv('LLM_API_KEY_ENCRYPTION_KEY', 'abcd');
        const { db } = makeUpsertDb([metaRow]);
        const repo = new DrizzleUserApiKeyRepository(db);

        await expect(
            repo.upsert({
                userId: 'user-1',
                provider: 'anthropic',
                apiKey: PLAINTEXT_API_KEY,
            })
        ).rejects.toThrow(
            'LLM_API_KEY_ENCRYPTION_KEY environment variable is required'
        );
    });

    it('encrypts the api key, inserts a new row, and returns metadata only', async () => {
        const { db, values, onConflictDoUpdate, returning } = makeUpsertDb([
            metaRow,
        ]);
        const repo = new DrizzleUserApiKeyRepository(db);

        const result = await repo.upsert({
            userId: 'user-1',
            provider: 'anthropic',
            apiKey: PLAINTEXT_API_KEY,
        });

        expect(result).toEqual(metaRow);
        // Result must not expose the plaintext or ciphertext field.
        expect(result).not.toHaveProperty('apiKey');
        expect(result).not.toHaveProperty('encryptedApiKey');

        const [insertedValues] = values.mock.calls[0] ?? [];
        expect(insertedValues).toMatchObject({
            userId: 'user-1',
            provider: 'anthropic',
        });
        const encryptedAtInsert = (
            insertedValues as { encryptedApiKey: string }
        ).encryptedApiKey;
        expect(encryptedAtInsert).not.toBe(PLAINTEXT_API_KEY);
        expect(encryptedAtInsert.split(':')).toHaveLength(3);

        // onConflictDoUpdate must use the same ciphertext as the insert path
        // so the update branch never silently writes a stale value.
        const [conflictArgs] = onConflictDoUpdate.mock.calls[0] ?? [];
        expect(
            (conflictArgs as { set: { encryptedApiKey: string } }).set
                .encryptedApiKey
        ).toBe(encryptedAtInsert);
        expect(returning).toHaveBeenCalledTimes(1);
    });

    it('throws when the database returns no row (defensive guard)', async () => {
        const { db } = makeUpsertDb([]);
        const repo = new DrizzleUserApiKeyRepository(db);

        await expect(
            repo.upsert({
                userId: 'user-1',
                provider: 'anthropic',
                apiKey: PLAINTEXT_API_KEY,
            })
        ).rejects.toThrow('Failed to upsert user API key');
    });
});

describe('DrizzleUserApiKeyRepository.findByUser', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('returns an empty array when the user has no stored keys', async () => {
        const { db } = makeFindByUserDb([]);
        const repo = new DrizzleUserApiKeyRepository(db);

        const result = await repo.findByUser('user-1');

        expect(result).toEqual([]);
    });

    it('returns metadata records without plaintext fields', async () => {
        const rows = [
            metaRow,
            { ...metaRow, id: 'key-2', provider: 'google' as const },
        ];
        const { db } = makeFindByUserDb(rows);
        const repo = new DrizzleUserApiKeyRepository(db);

        const result = await repo.findByUser('user-1');

        expect(result).toEqual(rows);
        for (const record of result) {
            expect(record).not.toHaveProperty('apiKey');
            expect(record).not.toHaveProperty('encryptedApiKey');
        }
    });

    it('does not require the encryption key to be present', async () => {
        vi.stubEnv('LLM_API_KEY_ENCRYPTION_KEY', '');
        const { db } = makeFindByUserDb([metaRow]);
        const repo = new DrizzleUserApiKeyRepository(db);

        await expect(repo.findByUser('user-1')).resolves.toEqual([metaRow]);
    });
});

describe('DrizzleUserApiKeyRepository.findByUserAndProvider', () => {
    beforeEach(() => {
        vi.stubEnv('LLM_API_KEY_ENCRYPTION_KEY', VALID_KEY_HEX);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('returns null when no row exists for the user/provider pair', async () => {
        const { db } = makeFindByUserAndProviderDb([]);
        const repo = new DrizzleUserApiKeyRepository(db);

        const result = await repo.findByUserAndProvider('user-1', 'anthropic');

        expect(result).toBeNull();
    });

    it('returns null without throwing when no row exists even if the key is missing', async () => {
        vi.stubEnv('LLM_API_KEY_ENCRYPTION_KEY', '');
        const { db } = makeFindByUserAndProviderDb([]);
        const repo = new DrizzleUserApiKeyRepository(db);

        await expect(
            repo.findByUserAndProvider('user-1', 'anthropic')
        ).resolves.toBeNull();
    });

    it('throws when a row exists but the encryption key is missing', async () => {
        vi.stubEnv('LLM_API_KEY_ENCRYPTION_KEY', '');
        const encrypted = encryptToken(PLAINTEXT_API_KEY, VALID_KEY_HEX);
        const { db } = makeFindByUserAndProviderDb([
            { ...metaRow, encryptedApiKey: encrypted },
        ]);
        const repo = new DrizzleUserApiKeyRepository(db);

        await expect(
            repo.findByUserAndProvider('user-1', 'anthropic')
        ).rejects.toThrow(
            'LLM_API_KEY_ENCRYPTION_KEY environment variable is required'
        );
    });

    it('decrypts the stored ciphertext and returns the plaintext record', async () => {
        const encrypted = encryptToken(PLAINTEXT_API_KEY, VALID_KEY_HEX);
        const { db } = makeFindByUserAndProviderDb([
            { ...metaRow, encryptedApiKey: encrypted },
        ]);
        const repo = new DrizzleUserApiKeyRepository(db);

        const result = await repo.findByUserAndProvider('user-1', 'anthropic');

        expect(result).toEqual({
            ...metaRow,
            apiKey: PLAINTEXT_API_KEY,
        });
    });

    it('returns null when the ciphertext cannot be decrypted with the configured key', async () => {
        const encryptedWithOtherKey = encryptToken(
            PLAINTEXT_API_KEY,
            OTHER_KEY_HEX
        );
        const { db } = makeFindByUserAndProviderDb([
            { ...metaRow, encryptedApiKey: encryptedWithOtherKey },
        ]);
        const repo = new DrizzleUserApiKeyRepository(db);

        const result = await repo.findByUserAndProvider('user-1', 'anthropic');

        expect(result).toBeNull();
    });
});

describe('DrizzleUserApiKeyRepository.deleteByUserAndProvider', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('returns false when no row was deleted', async () => {
        const { db } = makeDeleteDb([]);
        const repo = new DrizzleUserApiKeyRepository(db);

        const result = await repo.deleteByUserAndProvider(
            'user-1',
            'anthropic'
        );

        expect(result).toBe(false);
    });

    it('returns true when a row was deleted', async () => {
        const { db, returning } = makeDeleteDb([{ id: 'key-1' }]);
        const repo = new DrizzleUserApiKeyRepository(db);

        const result = await repo.deleteByUserAndProvider(
            'user-1',
            'anthropic'
        );

        expect(result).toBe(true);
        expect(returning).toHaveBeenCalledTimes(1);
    });

    it('does not require the encryption key to be present', async () => {
        vi.stubEnv('LLM_API_KEY_ENCRYPTION_KEY', '');
        const { db } = makeDeleteDb([{ id: 'key-1' }]);
        const repo = new DrizzleUserApiKeyRepository(db);

        await expect(
            repo.deleteByUserAndProvider('user-1', 'anthropic')
        ).resolves.toBe(true);
    });
});
