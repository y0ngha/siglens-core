import type { Tier, TierConfig } from '@/domain/types';
import type { UsageRepository } from '@/infrastructure/db';

/** Dependencies required by daily usage limit checks. */
export interface UsageLimitDependencies {
    /** Repository that reads usage counts for a hashed IP. */
    usage: Pick<UsageRepository, 'getUsageToday'>;
}

/** Input shared by daily usage limit checks. */
export interface UsageLimitInput {
    /** SHA-256 IP hash for the UTC day. */
    ipHash: string;
    /** Resolved subscription tier for the request. */
    tier: Tier;
    /** Clock injection for UTC-day tests. Defaults to infrastructure time. */
    now?: Date;
    /** Tier configuration; defaults to the package-level config. */
    config?: TierConfig;
}

/** Error code returned when a daily usage limit blocks a request. */
export type UsageLimitErrorCode =
    | 'analysis_limit_exceeded'
    | 'chatbot_limit_exceeded';

/** Structured analysis usage-limit error payload. */
export interface AnalysisUsageLimitError {
    /** Machine-readable error code. */
    code: 'analysis_limit_exceeded';
    /** Human-readable message for API/UI surfaces. */
    message: string;
    /** Feature whose daily limit was exceeded. */
    feature: 'analysisPerDay';
    /** Resolved tier used for the check. */
    tier: Tier;
}

/** Structured chatbot usage-limit error payload. */
export interface ChatbotUsageLimitError {
    /** Machine-readable error code. */
    code: 'chatbot_limit_exceeded';
    /** Human-readable message for API/UI surfaces. */
    message: string;
    /** Feature whose daily limit was exceeded. */
    feature: 'chatbotPerDay';
    /** Resolved tier used for the check. */
    tier: Tier;
}

/** Structured usage-limit error payload. */
export type UsageLimitError = AnalysisUsageLimitError | ChatbotUsageLimitError;
