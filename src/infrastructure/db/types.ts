import type { ModelId, Tier } from '@/domain/types';

/**
 * @deprecated Use {@link Tier} directly.
 * Kept as a backward-compatible alias; the canonical type is {@link Tier} in `domain/types.ts`.
 *
 * Subscription tier persisted on user records. Mirrors the `Tier` union from
 * `domain/types.ts` so consumers can reference either name interchangeably.
 */
export type UserTier = Tier;

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
    modelUsed: ModelId;
    /** Calendar date bucket in `YYYY-MM-DD` format. */
    date: string;
}

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
 * Persisted usage log record returned after insertion.
 */
export interface UsageLogRecord {
    /** Unique usage log identifier. */
    id: string;
    /** User UUID when authenticated, otherwise null. */
    userId: string | null;
    /** SHA-256 hash of IP plus UTC daily salt. */
    ipHash: string;
    /** Usage action that was recorded. */
    actionType: UsageActionType;
    /** AI model or backend path used by the request. */
    modelUsed: string;
    /** UTC date bucket used for daily resets. */
    date: string;
    /** Timestamp when the row was created. */
    createdAt: Date;
}

/** Daily usage counts grouped by action type. */
export interface UsageCounts {
    /** Number of analysis requests recorded for the UTC day. */
    analysis: number;
    /** Number of chatbot requests recorded for the UTC day. */
    chatbot: number;
}

/** Persistence operations required by tier-gating use-cases. */
export interface UserTierRepository {
    /**
     * Find the tier currently assigned to a user.
     *
     * @param userId - User UUID to look up.
     * @returns The persisted tier, or null when the user does not exist.
     */
    getUserTier(userId: string): Promise<Tier | null>;

    /**
     * Manually update a user's tier.
     *
     * @param userId - User UUID to update.
     * @param tier - New tier to persist.
     * @returns The updated tier, or null when the user does not exist.
     */
    updateUserTier(userId: string, tier: Tier): Promise<Tier | null>;
}

/** Persistence operations for request usage accounting. */
export interface UsageLogRepository {
    /**
     * Append a single usage log entry.
     *
     * @param input - Usage log payload (user, IP hash, action type, model, date bucket).
     * @returns Resolves when the row has been persisted.
     */
    recordUsage(input: CreateUsageLogInput): Promise<void>;
}

/** Persistence operations required by usage tracking and analytics. */
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
