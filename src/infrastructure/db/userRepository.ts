import { and, eq } from 'drizzle-orm';
import { oauthAccounts, users } from './schema';
import type { SiglensDatabase, UserTierRepository } from './types';
import { DEFAULT_TIER } from '@/domain/tier';
import type { Tier } from '@/domain/types';
import type {
    AuthUserRecord,
    CreateEmailUserInput,
    CreateOAuthUserInput,
    EmailAuthUserRecord,
    EmailAuthUserRepository,
    OAuthUserRepository,
    UserRepository,
} from '@/infrastructure/auth/types';

class OAuthAccountConflictError extends Error {}

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

/**
 * Drizzle ORM implementation of {@link UserRepository} backed by a Neon PostgreSQL database.
 *
 * @param db - Drizzle-wrapped Neon database client; obtain via {@link createDatabaseClient}.
 */
export class DrizzleUserRepository
    implements
        UserRepository,
        EmailAuthUserRepository,
        OAuthUserRepository,
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
        provider: CreateOAuthUserInput['provider'],
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
}
