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

/**
 * A persisted user account record returned from the database.
 */
export interface AuthUserRecord {
    /** Unique user identifier (UUID). */
    id: string;
    /** Normalized (lowercased, trimmed) email address. */
    email: string;
    /** Optional display name; null when not provided at registration. */
    name: string | null;
    /** Optional avatar image URL; null when not provided at registration. */
    avatarUrl: string | null;
    /** Subscription tier assigned to the user. */
    tier: UserTier;
    /** Timestamp when the account was created. */
    createdAt: Date;
    /** Timestamp when the account was last updated. */
    updatedAt: Date;
}

/**
 * Email-auth user record including the password hash needed for credential checks.
 */
export interface EmailAuthUserRecord extends AuthUserRecord {
    /** Hashed password for email/password authentication; null for OAuth-only users. */
    passwordHash: string | null;
}

/**
 * Persisted auth session record.
 */
export interface AuthSessionRecord {
    /** Session identifier used as the session token. */
    id: string;
    /** User that owns the session. */
    userId: string;
    /** Fixed expiration timestamp. */
    expiresAt: Date;
    /** Timestamp when the session was created. */
    createdAt: Date;
}

/**
 * Input for creating a new email-based user account.
 */
export interface CreateEmailUserInput {
    /** Normalized email address (lowercased, trimmed). */
    email: string;
    /** Hashed password produced by {@link PasswordHasher.hashPassword}. */
    passwordHash: string;
    /** Optional display name. */
    name?: string;
    /** Optional avatar image URL. */
    avatarUrl?: string;
}

/**
 * Input for creating a new OAuth-based user account and provider link.
 */
export interface CreateOAuthUserInput {
    /** Normalized email address (lowercased, trimmed). */
    email: string;
    /** OAuth provider that authenticated the account. */
    provider: OAuthProvider;
    /** Stable provider-side account identifier. */
    providerAccountId: string;
    /** Optional display name. */
    name?: string;
    /** Optional avatar image URL. */
    avatarUrl?: string;
}

/**
 * Input for creating a new persisted session.
 */
export interface CreateSessionInput {
    /** User that owns the session. */
    userId: string;
    /** Fixed expiration timestamp. */
    expiresAt: Date;
}

/**
 * Input for recording one analysis or chatbot usage event.
 */
export interface RecordUsageInput {
    /** User UUID when the caller is authenticated; null/undefined for anonymous usage. */
    userId?: string | null;
    /** Raw client IP address. This value is hashed before persistence and is never stored. */
    ipAddress: string;
    /** Usage action to record. */
    actionType: UsageActionType;
    /** AI model or backend path used by the request. */
    modelUsed: string;
    /** Event timestamp; defaults to the current time in the infrastructure layer. */
    occurredAt?: Date;
}

/**
 * Persisted usage log record returned after insertion.
 */
export interface UsageLogRecord {
    /** Unique usage log identifier. */
    id: string;
    /** User UUID when authenticated, otherwise null. */
    userId: string | null;
    /** SHA-256 hash of IP plus UTC daily salt. */
    ipHash: string;
    /** Usage action that was recorded. */
    actionType: UsageActionType;
    /** AI model or backend path used by the request. */
    modelUsed: string;
    /** UTC date bucket used for daily resets. */
    date: string;
    /** Timestamp when the row was created. */
    createdAt: Date;
}

/** Daily usage counts grouped by action type. */
export interface UsageCounts {
    /** Number of analysis requests recorded for the UTC day. */
    analysis: number;
    /** Number of chatbot requests recorded for the UTC day. */
    chatbot: number;
}

/**
 * Interface for user persistence operations required by the auth use-cases.
 */
export interface UserRepository {
    /**
     * Find a user by their normalized email address.
     *
     * @param email - Normalized (lowercased, trimmed) email to look up.
     * @returns The matching {@link AuthUserRecord}, or null if not found.
     */
    findByEmail(email: string): Promise<AuthUserRecord | null>;

    /**
     * Find a user by their unique identifier.
     *
     * @param userId - User UUID to look up.
     * @returns The matching {@link AuthUserRecord}, or null if not found.
     */
    findById(userId: string): Promise<AuthUserRecord | null>;

    /**
     * Create a new email-based user account.
     *
     * @param input - Registration data including email, password hash, and optional profile fields.
     * @returns The created {@link AuthUserRecord}, or null if the email already exists.
     */
    createEmailUser(
        input: CreateEmailUserInput
    ): Promise<AuthUserRecord | null>;

    /**
     * Delete a user account by id, cascading removal of dependent rows
     * (sessions are deleted, usage logs have their `userId` set to null).
     *
     * @param userId - User UUID to delete.
     * @returns Whether a user row was deleted.
     */
    deleteUser(userId: string): Promise<boolean>;
}

/**
 * Interface for credential lookup required by email login.
 */
export interface EmailAuthUserRepository {
    /**
     * Find an email-auth user, including password hash, by normalized email.
     *
     * @param email - Normalized (lowercased, trimmed) email to look up.
     * @returns The matching user with password hash, or null if not found.
     */
    findEmailAuthUserByEmail(
        email: string
    ): Promise<EmailAuthUserRecord | null>;
}

/**
 * Interface for OAuth login account lookup and creation.
 */
export interface OAuthUserRepository {
    /**
     * Find a user linked to an OAuth provider account.
     *
     * @param provider - OAuth provider identifier.
     * @param providerAccountId - Stable provider-side account identifier.
     * @returns The linked user, or null if no link exists.
     */
    findByOAuthAccount(
        provider: OAuthProvider,
        providerAccountId: string
    ): Promise<AuthUserRecord | null>;

    /**
     * Find a user by their normalized email address.
     *
     * @param email - Normalized (lowercased, trimmed) email to look up.
     * @returns The matching {@link AuthUserRecord}, or null if not found.
     */
    findByEmail(email: string): Promise<AuthUserRecord | null>;

    /**
     * Create a free-tier OAuth user and link the provider account.
     *
     * @param input - OAuth profile and provider account data.
     * @returns The created {@link AuthUserRecord}, or null if email/provider conflicts.
     */
    createOAuthUser(
        input: CreateOAuthUserInput
    ): Promise<AuthUserRecord | null>;
}

/**
 * Interface for session persistence operations.
 */
export interface SessionRepository {
    /**
     * Create and persist a session.
     *
     * @param input - Session owner and expiration timestamp.
     * @returns The created session record.
     */
    createSession(input: CreateSessionInput): Promise<AuthSessionRecord>;

    /**
     * Look up a persisted session by its token.
     *
     * Expiration is not enforced at this layer; callers must compare
     * {@link AuthSessionRecord.expiresAt} against the current time.
     *
     * @param sessionToken - Session identifier stored in the auth cookie.
     * @returns The matching session record, or null if no row matches.
     */
    findSession(sessionToken: string): Promise<AuthSessionRecord | null>;

    /**
     * Delete a session by token.
     *
     * @param sessionToken - Session identifier stored in the auth cookie.
     * @returns Whether a session row was deleted.
     */
    deleteSession(sessionToken: string): Promise<boolean>;
}

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

/** Persistence operations required by usage tracking and analytics. */
export interface UsageRepository {
    /**
     * Record one usage event. Implementations must persist only an IP hash,
     * never the raw client IP.
     *
     * @param input - Usage event metadata.
     * @returns The inserted usage log row.
     */
    recordUsage(input: RecordUsageInput): Promise<UsageLogRecord>;

    /**
     * Count today's usage for an IP hash using the UTC date bucket.
     *
     * @param ipHash - SHA-256 IP hash for the UTC day.
     * @param now - Optional clock injection for tests.
     * @returns Counts for analysis and chatbot usage.
     */
    getUsageToday(ipHash: string, now?: Date): Promise<UsageCounts>;
}
