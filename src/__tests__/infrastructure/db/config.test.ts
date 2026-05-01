import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    readDatabaseConfig,
    tryReadDatabaseConfig,
    tryReadEncryptionKey,
    tryReadLlmApiKeyEncryptionKey,
} from '@/infrastructure/db/config';

const TEST_DATABASE_URL =
    'postgres://user:pass@example.neon.tech/db?sslmode=require';
const VALID_KEY_HEX = '0'.repeat(64);

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

describe('tryReadEncryptionKey', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('returns null when the env var is absent', () => {
        vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', '');

        expect(tryReadEncryptionKey()).toBeNull();
    });

    it('returns the key when the env var is a valid 32-byte hex string', () => {
        vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', VALID_KEY_HEX);

        expect(tryReadEncryptionKey()).toBe(VALID_KEY_HEX);
    });

    it('returns null when the env var is too short', () => {
        vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', '0'.repeat(62));

        expect(tryReadEncryptionKey()).toBeNull();
    });

    it('returns null when the env var is too long', () => {
        vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', '0'.repeat(66));

        expect(tryReadEncryptionKey()).toBeNull();
    });
});

describe('tryReadLlmApiKeyEncryptionKey', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('returns null when the env var is absent', () => {
        vi.stubEnv('LLM_API_KEY_ENCRYPTION_KEY', '');

        expect(tryReadLlmApiKeyEncryptionKey()).toBeNull();
    });

    it('returns the key when the env var is a valid 32-byte hex string', () => {
        vi.stubEnv('LLM_API_KEY_ENCRYPTION_KEY', VALID_KEY_HEX);

        expect(tryReadLlmApiKeyEncryptionKey()).toBe(VALID_KEY_HEX);
    });

    it('returns null when the env var is too short', () => {
        vi.stubEnv('LLM_API_KEY_ENCRYPTION_KEY', '0'.repeat(62));

        expect(tryReadLlmApiKeyEncryptionKey()).toBeNull();
    });

    it('returns null when the env var is too long', () => {
        vi.stubEnv('LLM_API_KEY_ENCRYPTION_KEY', '0'.repeat(66));

        expect(tryReadLlmApiKeyEncryptionKey()).toBeNull();
    });

    it('does not fall back to OAUTH_TOKEN_ENCRYPTION_KEY when LLM key is absent', () => {
        vi.stubEnv('LLM_API_KEY_ENCRYPTION_KEY', '');
        vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', VALID_KEY_HEX);

        expect(tryReadLlmApiKeyEncryptionKey()).toBeNull();
    });
});
