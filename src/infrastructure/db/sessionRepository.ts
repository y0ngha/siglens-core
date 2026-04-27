import { eq } from 'drizzle-orm';
import { sessions } from './schema';
import type { SiglensDatabase } from './types';
import type {
    AuthSessionRecord,
    CreateSessionInput,
    SessionRepository,
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

    async deleteSession(sessionToken: string): Promise<boolean> {
        const deletedSessions = await this.db
            .delete(sessions)
            .where(eq(sessions.id, sessionToken))
            .returning({ id: sessions.id });

        return deletedSessions.length > 0;
    }
}
