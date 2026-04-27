import { eq } from 'drizzle-orm';
import { users } from './schema';
import type {
    AuthUserRecord,
    CreateEmailUserInput,
    SiglensDatabase,
    UserRepository,
} from './types';

// Matches schema.ts users.tier .default('free'); update both if the default tier changes.
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

/**
 * Drizzle ORM implementation of {@link UserRepository} backed by a Neon PostgreSQL database.
 *
 * @param db - Drizzle-wrapped Neon database client; obtain via {@link createDatabaseClient}.
 * @see {@link UserRepository}
 */
export class DrizzleUserRepository implements UserRepository {
    constructor(private readonly db: SiglensDatabase) {}

    async findByEmail(email: string): Promise<AuthUserRecord | null> {
        const [user] = await this.db
            .select(authUserColumns)
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
