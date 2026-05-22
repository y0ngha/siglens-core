import type { UsageActionType } from '@/domain/types';

/**
 * Input for appending a usage log row.
 */
export interface CreateUsageLogInput {
    /** Authenticated user UUID, or null for anonymous usage. */
    userId: string | null;
    /** Hashed client IP used for anonymous and abuse tracking. */
    ipHash: string;
    /** Usage action being tracked. */
    actionType: UsageActionType;
    /** AI model used by the request. */
    modelUsed: string;
    /** Calendar date bucket in `YYYY-MM-DD` format. */
    date: string;
}

/**
 * @port
 * Persistence operations for request usage accounting.
 *
 * Adapters are owned by consumers (Drizzle/Neon implementations live in the
 * consuming application); `siglens-core` declares only the contract the
 * domain depends on.
 *
 * **IP handling contract:** adapters of this port receive an *already hashed*
 * IP via `CreateUsageLogInput.ipHash` and persist it as-is. Hashing happens at
 * the caller (typically alongside an authenticated request that has already
 * derived the daily IP hash), so this port performs no IP transformation.
 */
export interface UsageLogRepository {
    /**
     * Append a single usage log entry.
     *
     * @param input - Usage log payload (user, IP hash, action type, model, date bucket).
     * @returns Resolves when the row has been persisted.
     */
    recordUsage(input: CreateUsageLogInput): Promise<void>;
}
