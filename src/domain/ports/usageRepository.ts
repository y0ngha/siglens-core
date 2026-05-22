import type { UsageLogRecord } from '@/domain/ports/usageLogRepository';

/**
 * Action type recorded in usage logs.
 *
 * Defined as a hand-written union so the core library can describe the usage
 * accounting contract without depending on any database schema definition.
 *
 * @internal-sync If a siglens consumer adds new action types to its
 *   `USAGE_ACTION_TYPE_VALUES` (or equivalent schema enum), this union must be
 *   extended in a corresponding core PR so callers see the new variant in
 *   `RecordUsageInput` / `CreateUsageLogInput`.
 */
export type UsageActionType = 'analysis' | 'chatbot' | 'premium_model';

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

/** Daily usage counts grouped by action type. */
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
