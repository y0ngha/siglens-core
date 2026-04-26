import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { readDatabaseConfig, tryReadDatabaseConfig } from './config';
import * as schema from './schema';
import type { DatabaseClient, DatabaseConfig } from './types';

let cachedClient: DatabaseClient | null = null;

/**
 * Creates a new Drizzle client backed by Neon serverless.
 * @param config Database connection configuration.
 * @returns A `DatabaseClient` containing the Drizzle `db` and raw `sql` handles.
 */
export function createDatabaseClient(config: DatabaseConfig): DatabaseClient {
    const sql = neon(config.databaseUrl);
    const db = drizzle(sql, { schema });
    return { db, sql };
}

/**
 * Returns the module-level cached `DatabaseClient`, creating it on first call.
 * @throws {Error} When `DATABASE_URL` environment variable is not set.
 */
export function getDatabaseClient(): DatabaseClient {
    cachedClient ??= createDatabaseClient(readDatabaseConfig());
    return cachedClient;
}

/**
 * Returns the module-level cached `DatabaseClient`, or `null` when
 * `DATABASE_URL` is not configured (graceful degradation).
 */
export function tryGetDatabaseClient(): DatabaseClient | null {
    const config = tryReadDatabaseConfig();
    if (config === null) return null;
    cachedClient ??= createDatabaseClient(config);
    return cachedClient;
}

/** @internal */
export function resetDatabaseClientForTests(): void {
    cachedClient = null;
}
