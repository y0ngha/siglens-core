import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createDatabaseClient,
    getDatabaseClient,
    resetDatabaseClientForTests,
    tryGetDatabaseClient,
} from '@/infrastructure/db/client';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

const TEST_DATABASE_URL =
    'postgres://user:pass@example.neon.tech/db?sslmode=require';

const sqlClient = vi.fn();
const dbClient = { query: {} };

vi.mock('@neondatabase/serverless', () => ({
    neon: vi.fn(() => sqlClient),
}));

vi.mock('drizzle-orm/neon-http', () => ({
    drizzle: vi.fn(() => dbClient),
}));

describe('database client factory', () => {
    beforeEach(() => {
        resetDatabaseClientForTests();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('creates a Neon-backed Drizzle client', () => {
        const client = createDatabaseClient({
            databaseUrl: TEST_DATABASE_URL,
        });

        expect(neon).toHaveBeenCalledWith(TEST_DATABASE_URL);
        expect(drizzle).toHaveBeenCalledWith(sqlClient, {
            schema: expect.any(Object),
        });
        expect(client).toEqual({ db: dbClient, sql: sqlClient });
    });

    it('reuses the module-level client for required env config', () => {
        vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL);

        const firstClient = getDatabaseClient();
        const secondClient = getDatabaseClient();

        expect(firstClient).toBe(secondClient);
        expect(neon).toHaveBeenCalledTimes(1);
        expect(drizzle).toHaveBeenCalledTimes(1);
    });

    it('throws when required env config is missing', () => {
        vi.stubEnv('DATABASE_URL', '');

        expect(() => getDatabaseClient()).toThrow(
            'DATABASE_URL environment variable is required'
        );
    });

    it('returns null when optional env config is missing', () => {
        vi.stubEnv('DATABASE_URL', '');

        expect(tryGetDatabaseClient()).toBeNull();
        expect(neon).not.toHaveBeenCalled();
        expect(drizzle).not.toHaveBeenCalled();
    });

    it('reuses the module-level client when optional env config is present', () => {
        vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL);

        const firstClient = tryGetDatabaseClient();
        const secondClient = tryGetDatabaseClient();

        expect(firstClient).toEqual({
            db: dbClient,
            sql: sqlClient,
        });
        expect(firstClient).toBe(secondClient);
        expect(neon).toHaveBeenCalledTimes(1);
        expect(drizzle).toHaveBeenCalledTimes(1);
    });
});
