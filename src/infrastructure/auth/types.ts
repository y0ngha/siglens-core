/**
 * Mirrors USER_TIER_VALUES in infrastructure/db/constants.ts.
 * Keep this union in sync with the database enum without importing across
 * infrastructure module boundaries.
 */
export type AuthUserTier = 'free' | 'member' | 'pro';

export interface AuthUserRecord {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
    tier: AuthUserTier;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateEmailUserInput {
    email: string;
    passwordHash: string;
    name?: string;
    avatarUrl?: string;
}

export interface PasswordHasher {
    hashPassword(password: string): Promise<string>;
}

export interface UserRepository {
    findByEmail(email: string): Promise<AuthUserRecord | null>;
    createEmailUser(
        input: CreateEmailUserInput
    ): Promise<AuthUserRecord | null>;
}
