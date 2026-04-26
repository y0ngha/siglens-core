import { eq } from 'drizzle-orm';
import { users } from './schema';
import type { SiglensDatabase } from './types';
import type {
    AuthUserRecord,
    CreateEmailUserInput,
    EmailAuthUserRecord,
    EmailAuthUserRepository,
    UserRepository,
} from '@/infrastructure/auth/types';

const DEFAULT_USER_TIER = 'free';

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
    implements UserRepository, EmailAuthUserRepository
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
                tier: DEFAULT_USER_TIER,
            })
            .onConflictDoNothing({ target: users.email })
            .returning(authUserColumns);

        return user ?? null;
    }
}
