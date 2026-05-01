import type { DatabaseConfig } from './types';

const ENCRYPTION_KEY_BYTE_LENGTH = 32;

/**
 * Reads `DATABASE_URL` from the environment and returns a `DatabaseConfig`.
 * @returns A `DatabaseConfig` containing the resolved `databaseUrl`.
 * @throws {Error} When `DATABASE_URL` is not set.
 */
export function readDatabaseConfig(): DatabaseConfig {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error('DATABASE_URL environment variable is required');
    }
    return { databaseUrl };
}

/**
 * Reads `DATABASE_URL` from the environment.
 * @returns A `DatabaseConfig` when the variable is set, or `null` when absent.
 */
export function tryReadDatabaseConfig(): DatabaseConfig | null {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return null;
    return { databaseUrl };
}

/**
 * @internal Validate a 32-byte AES-256 key supplied as a hex string. Returns
 * the raw hex string when the decoded byte length is exactly 32 bytes, or
 * `null` when absent or incorrectly sized.
 */
function tryParseEncryptionKey(raw: string | undefined): string | null {
    if (!raw) {
        return null;
    }
    const bytes = Buffer.from(raw, 'hex');
    return bytes.length === ENCRYPTION_KEY_BYTE_LENGTH ? raw : null;
}

/**
 * @internal Read and validate the OAuth token encryption key from the environment.
 * Returns the hex key string when valid, or null when absent or incorrectly sized.
 */
export function tryReadEncryptionKey(): string | null {
    return tryParseEncryptionKey(process.env.OAUTH_TOKEN_ENCRYPTION_KEY);
}

/**
 * @internal Read and validate the LLM API key encryption key from the
 * environment. Returns the hex key string when valid, or null when absent or
 * incorrectly sized.
 */
export function tryReadLlmApiKeyEncryptionKey(): string | null {
    return tryParseEncryptionKey(process.env.LLM_API_KEY_ENCRYPTION_KEY);
}
