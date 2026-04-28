import { createHash } from 'node:crypto';
import { and, count, eq } from 'drizzle-orm';
import { usageLogs } from './schema';
import type {
    RecordUsageInput,
    SiglensDatabase,
    UsageActionType,
    UsageCounts,
    UsageLogRecord,
    UsageRepository,
} from './types';

const SHA_256_ALGORITHM = 'sha256';
const HEX_DIGEST_ENCODING = 'hex';
const UTC_DATE_LENGTH = 10;

const EMPTY_USAGE_COUNTS: UsageCounts = {
    analysis: 0,
    chatbot: 0,
};

function toUtcDateString(date: Date): string {
    return date.toISOString().slice(0, UTC_DATE_LENGTH);
}

function toUsageCounts(
    rows: readonly { actionType: UsageActionType; count: number }[]
): UsageCounts {
    return rows.reduce(
        (counts, row) => ({
            ...counts,
            [row.actionType]: row.count,
        }),
        EMPTY_USAGE_COUNTS
    );
}

/**
 * Hash a client IP with a UTC daily salt so raw IP addresses are never stored.
 *
 * @param clientIp - Raw client IP address.
 * @param date - Date used to derive the UTC daily salt.
 * @returns SHA-256 hex digest of IP plus UTC date salt.
 */
export function hashUsageIp(clientIp: string, date: Date = new Date()): string {
    const utcDate = toUtcDateString(date);

    return createHash(SHA_256_ALGORITHM)
        .update(`${clientIp}:${utcDate}`)
        .digest(HEX_DIGEST_ENCODING);
}

/**
 * Drizzle ORM implementation of {@link UsageRepository} backed by usage_logs.
 */
export class DrizzleUsageRepository implements UsageRepository {
    constructor(private readonly db: SiglensDatabase) {}

    async recordUsage(input: RecordUsageInput): Promise<UsageLogRecord> {
        const occurredAt = input.occurredAt ?? new Date();
        const [usageLog] = await this.db
            .insert(usageLogs)
            .values({
                userId: input.userId ?? null,
                ipHash: hashUsageIp(input.ipAddress, occurredAt),
                actionType: input.actionType,
                modelUsed: input.modelUsed,
                date: toUtcDateString(occurredAt),
            })
            .returning({
                id: usageLogs.id,
                userId: usageLogs.userId,
                ipHash: usageLogs.ipHash,
                actionType: usageLogs.actionType,
                modelUsed: usageLogs.modelUsed,
                date: usageLogs.date,
                createdAt: usageLogs.createdAt,
            });

        return usageLog!;
    }

    async getUsageToday(
        ipHash: string,
        now: Date = new Date()
    ): Promise<UsageCounts> {
        const rows = await this.db
            .select({
                actionType: usageLogs.actionType,
                count: count(),
            })
            .from(usageLogs)
            .where(
                and(
                    eq(usageLogs.ipHash, ipHash),
                    eq(usageLogs.date, toUtcDateString(now))
                )
            )
            .groupBy(usageLogs.actionType);

        return toUsageCounts(rows);
    }
}
