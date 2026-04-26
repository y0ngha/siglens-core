import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import type {
    OAUTH_PROVIDER_VALUES,
    USAGE_ACTION_TYPE_VALUES,
    USER_TIER_VALUES,
} from '@/infrastructure/db/constants';
import type * as schema from '@/infrastructure/db/schema';

export type UserTier = (typeof USER_TIER_VALUES)[number];

export type UsageActionType = (typeof USAGE_ACTION_TYPE_VALUES)[number];

export type OAuthProvider = (typeof OAUTH_PROVIDER_VALUES)[number];

export interface DatabaseConfig {
    databaseUrl: string;
}

export type SiglensDatabase = NeonHttpDatabase<typeof schema>;

export type NeonSqlClient = NeonQueryFunction<false, false>;

export interface DatabaseClient {
    db: SiglensDatabase;
    sql: NeonSqlClient;
}
