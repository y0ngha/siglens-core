import type { Tier } from '@/domain/types';

/**
 * Mirrors USER_TIER_VALUES in infrastructure/db/constants.ts.
 * Keep this union in sync with the database enum without importing across
 * infrastructure module boundaries.
 */
export type AuthUserTier = 'free' | 'member' | 'pro';

/**
 * Request-scoped user tier data for server middleware and handlers.
 */
export interface UserTierContext {
    userId: string | null;
    tier: Tier;
}

/**
 * Mirrors OAUTH_PROVIDER_VALUES in infrastructure/db/constants.ts.
 * Keep this union in sync with the database enum without importing across
 * infrastructure module boundaries.
 */
export type AuthOAuthProvider = 'google' | 'kakao' | 'apple';

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
    provider: AuthOAuthProvider;
    /** Stable provider-side account identifier. */
    providerAccountId: string;
    /** Optional display name. */
    name?: string;
    /** Optional avatar image URL. */
    avatarUrl?: string;
}

/**
 * Interface for hashing plain-text passwords before storage.
 */
export interface PasswordHasher {
    /**
     * Hash a plain-text password and return the hashed string.
     *
     * @param password - Plain-text password to hash.
     * @returns Hashed password string safe for storage.
     */
    hashPassword(password: string): Promise<string>;
}

/**
 * Interface for comparing a plain-text password against a stored password hash.
 */
export interface PasswordVerifier {
    /**
     * Compare a plain-text password with a stored password hash.
     *
     * @param password - Plain-text password supplied by the user.
     * @param passwordHash - Stored password hash for the account.
     * @returns Whether the password matches the hash.
     */
    verifyPassword(password: string, passwordHash: string): Promise<boolean>;
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
        provider: AuthOAuthProvider,
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
 * Input for creating a new persisted session.
 */
export interface CreateSessionInput {
    /** User that owns the session. */
    userId: string;
    /** Fixed expiration timestamp. */
    expiresAt: Date;
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
