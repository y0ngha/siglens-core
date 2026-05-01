import type { DatabaseConfig } from './types';

const OAUTH_TOKEN_ENCRYPTION_KEY_BYTE_LENGTH = 32;

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
 * @internal Read and validate the OAuth token encryption key from the environment.
 * Returns the hex key string when valid, or null when absent or incorrectly sized.
 */
export function tryReadEncryptionKey(): string | null {
    const raw = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
    if (!raw) {
        return null;
    }
    const bytes = Buffer.from(raw, 'hex');
    return bytes.length === OAUTH_TOKEN_ENCRYPTION_KEY_BYTE_LENGTH ? raw : null;
}
