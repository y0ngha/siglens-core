import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { readDatabaseConfig, tryReadDatabaseConfig } from './config';
import * as schema from './schema';
import type { DatabaseClient, DatabaseConfig } from '@/infrastructure/db/types';

let cachedClient: DatabaseClient | null = null;

export function createDatabaseClient(config: DatabaseConfig): DatabaseClient {
    const sql = neon(config.databaseUrl);
    const db = drizzle(sql, { schema });
    return { db, sql };
}

export function getDatabaseClient(): DatabaseClient {
    cachedClient ??= createDatabaseClient(readDatabaseConfig());
    return cachedClient;
}

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
