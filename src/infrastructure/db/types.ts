import type { ModelId, Tier } from '@/domain/types';

/**
 * Subscription tier persisted on user records. Mirrors the `Tier` union from
 * `domain/types.ts` so consumers can reference either name interchangeably.
 */
export type UserTier = Tier;

/**
 * Action type recorded in usage logs.
 *
 * Defined as a hand-written union so the core library can describe the usage
 * accounting contract without depending on any database schema definition.
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
    getUserTier(userId: string): Promise<Tier | null>;
    updateUserTier(userId: string, tier: Tier): Promise<Tier | null>;
}

/** Persistence operations for request usage accounting. */
export interface UsageLogRepository {
    recordUsage(input: CreateUsageLogInput): Promise<void>;
}

/** Persistence operations required by usage tracking and analytics. */
export interface UsageRepository {
    recordUsage(input: RecordUsageInput): Promise<UsageLogRecord>;
    getUsageToday(ipHash: string, now?: Date): Promise<UsageCounts>;
}
