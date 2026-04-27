import { eq } from 'drizzle-orm';
import { sessions } from './schema';
import type {
    AuthSessionRecord,
    CreateSessionInput,
    SessionRepository,
    SiglensDatabase,
} from './types';

const sessionColumns = {
    id: sessions.id,
    userId: sessions.userId,
    expiresAt: sessions.expiresAt,
    createdAt: sessions.createdAt,
};

/**
 * Drizzle ORM implementation of {@link SessionRepository} backed by Neon PostgreSQL.
 *
 * @param db - Drizzle-wrapped Neon database client; obtain via {@link createDatabaseClient}.
 * @returns A repository that persists and deletes auth sessions.
 */
export class DrizzleSessionRepository implements SessionRepository {
    constructor(private readonly db: SiglensDatabase) {}

    async createSession(input: CreateSessionInput): Promise<AuthSessionRecord> {
        const [session] = await this.db
            .insert(sessions)
            .values({
                userId: input.userId,
                expiresAt: input.expiresAt,
            })
            .returning(sessionColumns);

        return session!;
    }

    async findSession(sessionToken: string): Promise<AuthSessionRecord | null> {
        const [session] = await this.db
            .select(sessionColumns)
            .from(sessions)
            .where(eq(sessions.id, sessionToken))
            .limit(1);

        return session ?? null;
    }

    async deleteSession(sessionToken: string): Promise<boolean> {
        const deletedSessions = await this.db
            .delete(sessions)
            .where(eq(sessions.id, sessionToken))
            .returning({ id: sessions.id });

        return deletedSessions.length > 0;
    }
}
