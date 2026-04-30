import type { BackgroundTaskOptions } from '@/application/types';
import type { SubmitAnalysisError } from '@/application/usage/types';
import type {
    AnalysisResponse,
    Tier,
    TierConfig,
    Timeframe,
    UserTierContext,
} from '@/domain/types';
import type { UsageRepository } from '@/infrastructure/db';

/** Usage tracking and daily limit options for analysis submissions. */
export interface AnalysisUsageOptions {
    /** Repository used to check today's count and record successful usage. */
    usageRepository: UsageRepository;
    /** Raw client IP. It is hashed before persistence and never stored. */
    clientIp: string;
    /** Resolved subscription tier for the request. */
    tier: Tier;
    /** Authenticated user UUID, or null/undefined for anonymous usage. */
    userId?: string | null;
    /** Model/backend identifier stored in usage_logs.model_used. */
    modelUsed?: string;
    /** Clock injection for UTC-day tests. Defaults to infrastructure time. */
    occurredAt?: Date;
}

/** Options controlling analysis submission behavior. */
export interface SubmitAnalysisOptions extends BackgroundTaskOptions {
    /** Optional usage tracking. Omitted callers keep the previous behavior. */
    usage?: AnalysisUsageOptions;
    /** Request-scoped tier context used to enforce timeframe access. */
    tierContext?: UserTierContext;
    /** Tier configuration override, mainly for tests and controlled rollouts. */
    tierConfig?: TierConfig;
}

/** Error returned when application tier gates block a timeframe request. */
export interface TierTimeframeAccessError {
    /** Machine-readable reason for the denial. */
    code: 'timeframe_not_allowed';
    /** Human-readable explanation suitable for API responses. */
    message: string;
    /** Tier used for the access decision. */
    tier: Tier;
    /** Timeframe requested by the caller. */
    timeframe: Timeframe;
    /** Timeframes available to the tier under the active config. */
    allowedTimeframes: Timeframe[];
}

/** Submit analysis outcome for application-level denials. */
export interface TierGateErrorResult {
    status: 'error';
    error: TierTimeframeAccessError;
}

/** Submit analysis outcome for application-level denials. */
export type SubmitAnalysisErrorResult =
    | { status: 'error'; error: SubmitAnalysisError }
    | TierGateErrorResult;

/** Submit analysis outcome including application-level gate errors. */
export type SubmitAnalysisGatedResult =
    | { status: 'cached'; result: AnalysisResponse }
    | { status: 'submitted'; jobId: string }
    | SubmitAnalysisErrorResult;
