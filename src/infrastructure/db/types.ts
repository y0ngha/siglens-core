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

/** Subscription tier used in auth user records — alias for {@link UserTier}. */
export type AuthUserTier = UserTier;

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
    tier: AuthUserTier;
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
    /** Hashed password produced by a {@link PasswordHasher}. */
    passwordHash: string;
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
     * Create a new email-based user account.
     *
     * @param input - Registration data including email, password hash, and optional profile fields.
     * @returns The created {@link AuthUserRecord}, or null if the email already exists.
     */
    createEmailUser(
        input: CreateEmailUserInput
    ): Promise<AuthUserRecord | null>;
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
     * Delete a session by token.
     *
     * @param sessionToken - Session identifier stored in the auth cookie.
     * @returns Whether a session row was deleted.
     */
    deleteSession(sessionToken: string): Promise<boolean>;
}

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
