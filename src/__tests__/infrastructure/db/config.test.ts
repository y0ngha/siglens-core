import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    readDatabaseConfig,
    tryReadDatabaseConfig,
} from '@/infrastructure/db/config';

const TEST_DATABASE_URL =
    'postgres://user:pass@example.neon.tech/db?sslmode=require';

describe('readDatabaseConfig', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('throws when DATABASE_URL is missing', () => {
        vi.stubEnv('DATABASE_URL', '');

        expect(() => readDatabaseConfig()).toThrow(
            'DATABASE_URL environment variable is required'
        );
    });

    it('returns database config when DATABASE_URL is present', () => {
        vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL);

        expect(readDatabaseConfig()).toEqual({
            databaseUrl: TEST_DATABASE_URL,
        });
    });
});

describe('tryReadDatabaseConfig', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('returns null when DATABASE_URL is missing', () => {
        vi.stubEnv('DATABASE_URL', '');

        expect(tryReadDatabaseConfig()).toBeNull();
    });

    it('returns database config when DATABASE_URL is present', () => {
        vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL);

        expect(tryReadDatabaseConfig()).toEqual({
            databaseUrl: TEST_DATABASE_URL,
        });
    });
});
