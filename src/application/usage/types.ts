import type { Tier, TierConfig } from '@/domain/types';
import type { UsageRepository } from '@/domain/ports/usageRepository';

/**
 * Usage tracking and daily limit options shared by every analysis use-case
 * (technical, fundamental, news, overall).
 *
 * Pass this once per request lifecycle. The owning use-case calls
 * `checkAnalysisUsageAllowed` before doing any work and
 * `recordAnalysisUsageSafely` after each path that should count toward the
 * daily limit (cache hit or successful submit).
 */
export interface AnalysisUsageOptions {
    /** Repository used to check today's count and record successful usage. */
    usageRepository: UsageRepository;
    /**
     * Raw client IP address.
     *
     * - {@link checkAnalysisUsageAllowed} hashes this via `hashUsageIp` before
     *   querying the usage repository — the limit-check path never reads or
     *   stores the raw IP.
     * - {@link recordAnalysisUsageSafely} forwards this value as-is to
     *   `UsageRepository.recordUsage` (`ipAddress` field). Persistence
     *   semantics (raw vs hashed storage) are owned by the repository
     *   implementation; core does not assume either.
     */
    clientIp: string;
    /** Authenticated user UUID, or null/undefined for anonymous usage. */
    userId?: string | null;
    /** Model/backend identifier stored in usage_logs.model_used. */
    modelUsed?: string;
    /** Clock injection for UTC-day tests. Defaults to infrastructure time. */
    occurredAt?: Date;
}

/**
 * Dependencies required by daily usage limit checks.
 */
export interface UsageLimitDependencies {
    /** Repository that reads usage counts for a hashed IP. */
    usage: Pick<UsageRepository, 'getUsageToday'>;
}

/**
 * Input shared by daily usage limit checks.
 */
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

/**
 * Structured error code returned by analysis usage-limit checks.
 */
export type AnalysisLimitErrorCode = 'analysis_limit_exceeded';

/**
 * Structured error code returned by chatbot usage-limit checks.
 */
export type ChatbotLimitErrorCode = 'chatbot_limit_exceeded';

/**
 * Structured error returned when analysis usage is blocked.
 */
export interface AnalysisLimitError {
    /** Machine-readable error code. */
    code: AnalysisLimitErrorCode;
    /** Human-readable message for API/UI surfaces. */
    message: string;
    /** Feature whose daily limit was exceeded. */
    feature: 'analysisPerDay';
    /** Resolved tier used for the check. */
    tier: Tier;
}

/**
 * Structured error returned when chatbot usage is blocked.
 */
export interface ChatbotLimitError {
    /** Machine-readable error code. */
    code: ChatbotLimitErrorCode;
    /** Human-readable message for API/UI surfaces. */
    message: string;
    /** Feature whose daily limit was exceeded. */
    feature: 'chatbotPerDay';
    /** Resolved tier used for the check. */
    tier: Tier;
}

/**
 * @internal
 * Error code returned when a daily usage limit blocks a request.
 */
export type UsageLimitErrorCode =
    | AnalysisLimitError['code']
    | ChatbotLimitError['code'];

/**
 * @internal
 * Structured usage-limit error payload.
 */
export type UsageLimitError = AnalysisLimitError | ChatbotLimitError;

/** @internal Error payload templates before the request tier is attached. */
export interface UsageLimitErrorTemplate {
    analysisPerDay: Omit<AnalysisLimitError, 'tier'>;
    chatbotPerDay: Omit<ChatbotLimitError, 'tier'>;
}
