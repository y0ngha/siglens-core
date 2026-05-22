import type { UsageActionType, UsageLogRecord } from '@/domain/types';

/**
 * Input for recording one analysis or chatbot usage event.
 */
export interface RecordUsageInput {
    /** User UUID when the caller is authenticated; null/undefined for anonymous usage. */
    userId?: string | null;
    /** Raw client IP address. This value is hashed before persistence and is never stored. */
    ipAddress: string;
    /** Usage action to record. */
    actionType: UsageActionType;
    /** AI model or backend path used by the request. */
    modelUsed: string;
    /** Event timestamp; defaults to the current time in the infrastructure layer. */
    occurredAt?: Date;
}

/**
 * Daily usage counts grouped by action type.
 *
 * Only the action types that participate in the daily rate-limit aggregation
 * are surfaced here. `premium_model` is intentionally omitted because those
 * events are tracked separately through {@link UsageLogRepository} for billing
 * purposes and do not contribute to the per-IP daily quota.
 */
export interface UsageCounts {
    /** Number of analysis requests recorded for the UTC day. */
    analysis: number;
    /** Number of chatbot requests recorded for the UTC day. */
    chatbot: number;
}

/**
 * @port
 * Persistence operations required by usage tracking and analytics.
 *
 * Adapters are owned by consumers (Drizzle/Neon implementations live in the
 * consuming application); `siglens-core` declares only the contract the
 * domain depends on.
 *
 * **IP handling contract:** adapters of this port receive the *raw* client IP
 * via `RecordUsageInput.ipAddress` and are responsible for hashing it (together
 * with any daily salt) before persistence. The raw IP must never be stored. The
 * resulting hash is what `getUsageToday` expects as its `ipHash` argument.
 */
export interface UsageRepository {
    /**
     * Record one analysis or chatbot usage event.
     *
     * The raw IP from `input.ipAddress` is hashed inside the implementation and is never persisted.
     *
     * @param input - Event payload including authenticated user (or null), raw IP, action type, model, and optional timestamp.
     * @returns The persisted usage log record with generated id, hashed IP, and UTC date bucket.
     */
    recordUsage(input: RecordUsageInput): Promise<UsageLogRecord>;

    /**
     * Aggregate today's usage counts for a given hashed IP.
     *
     * @param ipHash - SHA-256 IP hash used as the daily aggregation key.
     * @param now - Optional reference timestamp; defaults to the current time. Useful for tests.
     * @returns Per-action usage counts for the UTC day containing `now`.
     */
    getUsageToday(ipHash: string, now?: Date): Promise<UsageCounts>;
}
