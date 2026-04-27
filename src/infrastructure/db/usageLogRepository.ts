import { usageLogs } from './schema';
import type {
    CreateUsageLogInput,
    SiglensDatabase,
    UsageLogRepository,
} from './types';

/**
 * Drizzle ORM implementation of {@link UsageLogRepository} backed by a Neon
 * PostgreSQL database.
 *
 * @param db - Drizzle-wrapped Neon database client; obtain via {@link createDatabaseClient}.
 */
export class DrizzleUsageLogRepository implements UsageLogRepository {
    constructor(private readonly db: SiglensDatabase) {}

    async recordUsage(input: CreateUsageLogInput): Promise<void> {
        await this.db.insert(usageLogs).values({
            userId: input.userId,
            ipHash: input.ipHash,
            actionType: input.actionType,
            modelUsed: input.modelUsed,
            date: input.date,
        });
    }
}
