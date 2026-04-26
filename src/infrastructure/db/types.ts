import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import type {
    OAUTH_PROVIDER_VALUES,
    USAGE_ACTION_TYPE_VALUES,
    USER_TIER_VALUES,
} from './constants';
import type * as schema from './schema';

/** Subscription tier for a registered user. */
export type UserTier = (typeof USER_TIER_VALUES)[number];

/** Action type recorded in usage logs. */
export type UsageActionType = (typeof USAGE_ACTION_TYPE_VALUES)[number];

/** OAuth provider used to authenticate the user. */
export type OAuthProvider = (typeof OAUTH_PROVIDER_VALUES)[number];

/** Connection configuration required to instantiate a database client. */
export interface DatabaseConfig {
    databaseUrl: string;
}

/** Fully-typed Drizzle ORM database instance scoped to the siglens schema. */
export type SiglensDatabase = NeonHttpDatabase<typeof schema>;

/** Raw Neon serverless SQL client returned alongside the Drizzle instance. */
export type NeonSqlClient = NeonQueryFunction<false, false>;

/** Bundled handle exposing both the Drizzle ORM layer and the raw SQL client. */
export interface DatabaseClient {
    db: SiglensDatabase;
    sql: NeonSqlClient;
}
