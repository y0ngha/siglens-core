import { and, eq, isNull } from 'drizzle-orm';
import { DEFAULT_TIER } from '@/domain/tier';
import type { Tier } from '@/domain/types';
import { oauthAccounts, passwordResets, users } from './schema';
import type {
    AuthUserRecord,
    CompletePasswordResetInput,
    CreateEmailUserInput,
    CreateOAuthUserInput,
    CreatePasswordResetInput,
    EmailAuthUserRecord,
    EmailAuthUserRepository,
    OAuthProvider,
    OAuthUserRepository,
    PasswordResetRecord,
    PasswordResetRepository,
    SiglensDatabase,
    UserRepository,
    UserTierRepository,
} from './types';

class OAuthAccountConflictError extends Error {}
class PasswordResetCompletionConflictError extends Error {}

const authUserColumns = {
    id: users.id,
    email: users.email,
    name: users.name,
    avatarUrl: users.avatarUrl,
    tier: users.tier,
    createdAt: users.createdAt,
    updatedAt: users.updatedAt,
};

const emailAuthUserColumns = {
    ...authUserColumns,
    passwordHash: users.passwordHash,
};

const passwordResetColumns = {
    id: passwordResets.id,
    userId: passwordResets.userId,
    tokenHash: passwordResets.tokenHash,
    expiresAt: passwordResets.expiresAt,
    usedAt: passwordResets.usedAt,
    createdAt: passwordResets.createdAt,
};

/**
 * Drizzle ORM implementation of {@link UserRepository}, {@link EmailAuthUserRepository},
 * {@link OAuthUserRepository}, {@link PasswordResetRepository}, and
 * {@link UserTierRepository} backed by a Neon PostgreSQL database.
 *
 * @param db - Drizzle-wrapped Neon database client; obtain via {@link createDatabaseClient}.
 */
export class DrizzleUserRepository
    implements
        UserRepository,
        EmailAuthUserRepository,
        OAuthUserRepository,
        PasswordResetRepository,
        UserTierRepository
{
    constructor(private readonly db: SiglensDatabase) {}

    async findByEmail(email: string): Promise<AuthUserRecord | null> {
        const [user] = await this.db
            .select(authUserColumns)
            .from(users)
            .where(eq(users.email, email))
            .limit(1);

        return user ?? null;
    }

    async findById(userId: string): Promise<AuthUserRecord | null> {
        const [user] = await this.db
            .select(authUserColumns)
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        return user ?? null;
    }

    async deleteUser(userId: string): Promise<boolean> {
        const deletedUsers = await this.db
            .delete(users)
            .where(eq(users.id, userId))
            .returning({ id: users.id });

        return deletedUsers.length > 0;
    }

    async findEmailAuthUserByEmail(
        email: string
    ): Promise<EmailAuthUserRecord | null> {
        const [user] = await this.db
            .select(emailAuthUserColumns)
            .from(users)
            .where(eq(users.email, email))
            .limit(1);

        return user ?? null;
    }

    async createEmailUser(
        input: CreateEmailUserInput
    ): Promise<AuthUserRecord | null> {
        const [user] = await this.db
            .insert(users)
            .values({
                email: input.email,
                passwordHash: input.passwordHash,
                name: input.name ?? null,
                avatarUrl: input.avatarUrl ?? null,
                tier: DEFAULT_TIER,
            })
            .onConflictDoNothing({ target: users.email })
            .returning(authUserColumns);

        return user ?? null;
    }

    async findByOAuthAccount(
        provider: OAuthProvider,
        providerAccountId: string
    ): Promise<AuthUserRecord | null> {
        const [user] = await this.db
            .select(authUserColumns)
            .from(oauthAccounts)
            .innerJoin(users, eq(oauthAccounts.userId, users.id))
            .where(
                and(
                    eq(oauthAccounts.provider, provider),
                    eq(oauthAccounts.providerAccountId, providerAccountId)
                )
            )
            .limit(1);

        return user ?? null;
    }

    async createOAuthUser(
        input: CreateOAuthUserInput
    ): Promise<AuthUserRecord | null> {
        try {
            return await this.db.transaction(async tx => {
                const [user] = await tx
                    .insert(users)
                    .values({
                        email: input.email,
                        passwordHash: null,
                        name: input.name ?? null,
                        avatarUrl: input.avatarUrl ?? null,
                        tier: DEFAULT_TIER,
                    })
                    .onConflictDoNothing({ target: users.email })
                    .returning(authUserColumns);

                if (user === undefined) {
                    return null;
                }

                const [account] = await tx
                    .insert(oauthAccounts)
                    .values({
                        userId: user.id,
                        provider: input.provider,
                        providerAccountId: input.providerAccountId,
                    })
                    .onConflictDoNothing({
                        target: [
                            oauthAccounts.provider,
                            oauthAccounts.providerAccountId,
                        ],
                    })
                    .returning({ id: oauthAccounts.id });

                if (account === undefined) {
                    throw new OAuthAccountConflictError();
                }

                return user;
            });
        } catch (error) {
            if (error instanceof OAuthAccountConflictError) {
                return null;
            }

            throw error;
        }
    }

    async getUserTier(userId: string): Promise<Tier | null> {
        const [user] = await this.db
            .select({ tier: users.tier })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        return user?.tier ?? null;
    }

    async updateUserTier(userId: string, tier: Tier): Promise<Tier | null> {
        const [user] = await this.db
            .update(users)
            .set({ tier })
            .where(eq(users.id, userId))
            .returning({ tier: users.tier });

        return user?.tier ?? null;
    }

    async createPasswordReset(
        input: CreatePasswordResetInput
    ): Promise<PasswordResetRecord> {
        const [passwordReset] = await this.db
            .insert(passwordResets)
            .values({
                userId: input.userId,
                tokenHash: input.tokenHash,
                expiresAt: input.expiresAt,
            })
            .returning(passwordResetColumns);

        return passwordReset!;
    }

    async findPasswordResetByTokenHash(
        tokenHash: string
    ): Promise<PasswordResetRecord | null> {
        const [passwordReset] = await this.db
            .select(passwordResetColumns)
            .from(passwordResets)
            .where(eq(passwordResets.tokenHash, tokenHash))
            .limit(1);

        return passwordReset ?? null;
    }

    async completePasswordReset(
        input: CompletePasswordResetInput
    ): Promise<boolean> {
        try {
            return await this.db.transaction(async tx => {
                const [passwordReset] = await tx
                    .update(passwordResets)
                    .set({ usedAt: input.usedAt })
                    .where(
                        and(
                            eq(passwordResets.id, input.resetId),
                            eq(passwordResets.userId, input.userId),
                            isNull(passwordResets.usedAt)
                        )
                    )
                    .returning({ id: passwordResets.id });

                if (passwordReset === undefined) {
                    return false;
                }

                const [user] = await tx
                    .update(users)
                    .set({ passwordHash: input.passwordHash })
                    .where(eq(users.id, input.userId))
                    .returning({ id: users.id });

                if (user === undefined) {
                    throw new PasswordResetCompletionConflictError();
                }

                return true;
            });
        } catch (error) {
            if (error instanceof PasswordResetCompletionConflictError) {
                return false;
            }

            throw error;
        }
    }
}
