import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import type {
    OAUTH_PROVIDER_VALUES,
    USAGE_ACTION_TYPE_VALUES,
    USER_TIER_VALUES,
} from './constants';
import type * as schema from './schema';
import type { Tier } from '@/domain/types';

/** Subscription tier for a registered user. */
export type UserTier = (typeof USER_TIER_VALUES)[number];

/** Action type recorded in usage logs. */
export type UsageActionType = (typeof USAGE_ACTION_TYPE_VALUES)[number];

/** OAuth provider used to authenticate the user. */
export type OAuthProvider = (typeof OAUTH_PROVIDER_VALUES)[number];

/** Connection configuration required to instantiate a database client. */
export interface DatabaseConfig {
    /** PostgreSQL connection string, including credentials and SSL mode. */
    databaseUrl: string;
}

/**
 * Fully-typed Drizzle ORM database instance scoped to the siglens schema.
 * @remarks Tied to the `drizzle-orm/neon-http` adapter; changing the adapter
 * constitutes a breaking change to this type.
 */
export type SiglensDatabase = NeonHttpDatabase<typeof schema>;

/**
 * @internal Raw Neon serverless SQL client — access via DatabaseClient['sql'].
 */
export type NeonSqlClient = NeonQueryFunction<false, false>;

/** Bundled handle exposing both the Drizzle ORM layer and the raw SQL client. */
export interface DatabaseClient {
    /** Drizzle ORM instance scoped to the siglens schema. */
    db: SiglensDatabase;
    /** Raw Neon serverless SQL client for template-literal queries. */
    sql: NeonSqlClient;
}

/** Persistence operations required by tier-gating use-cases. */
export interface UserTierRepository {
    /**
     * Find the tier currently assigned to a user.
     *
     * @param userId - User UUID to look up.
     * @returns The persisted tier, or null when the user does not exist.
     */
    getUserTier(userId: string): Promise<Tier | null>;

    /**
     * Manually update a user's tier.
     *
     * @param userId - User UUID to update.
     * @param tier - New tier to persist.
     * @returns The updated tier, or null when the user does not exist.
     */
    updateUserTier(userId: string, tier: Tier): Promise<Tier | null>;
}
