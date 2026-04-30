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

/** Structured error code returned by analysis usage-limit checks. */
export type SubmitAnalysisErrorCode = 'analysis_limit_exceeded';

/** Structured error returned when analysis usage is blocked. */
export interface SubmitAnalysisError {
    /** Machine-readable error code. */
    code: SubmitAnalysisErrorCode;
    /** Human-readable message for API/UI surfaces. */
    message: string;
    /** Feature whose daily limit was exceeded. */
    feature: 'analysisPerDay';
    /** Resolved tier used for the check. */
    tier: Tier;
}

/** Structured error returned when chatbot usage is blocked. */
export interface ChatUsageLimitError {
    /** Machine-readable error code. */
    code: 'chatbot_limit_exceeded';
    /** Human-readable message for API/UI surfaces. */
    message: string;
    /** Feature whose daily limit was exceeded. */
    feature: 'chatbotPerDay';
    /** Resolved tier used for the check. */
    tier: Tier;
}

/** Error code returned when a daily usage limit blocks a request. */
export type UsageLimitErrorCode =
    | SubmitAnalysisError['code']
    | ChatUsageLimitError['code'];

/** Structured usage-limit error payload. */
export type UsageLimitError = SubmitAnalysisError | ChatUsageLimitError;

/** @internal Error payload templates before the request tier is attached. */
export interface UsageLimitErrorTemplate {
    analysisPerDay: Omit<SubmitAnalysisError, 'tier'>;
    chatbotPerDay: Omit<ChatUsageLimitError, 'tier'>;
}
