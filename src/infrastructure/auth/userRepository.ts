import { eq } from 'drizzle-orm';
import { users } from '@/infrastructure/db/schema';
import type { SiglensDatabase } from '@/infrastructure/db/types';
import type {
    AuthUserRecord,
    CreateEmailUserInput,
    UserRepository,
} from './types';

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
