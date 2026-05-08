import type { BackgroundTaskOptions } from '@/application/types';
import type { UserApiKeyRequiredError } from '@/application/byok/types';
import type {
    AnalysisLimitError,
    AnalysisUsageOptions,
} from '@/application/usage/types';
import type {
    AnalysisResponse,
    ModelId,
    Tier,
    TierConfig,
    Timeframe,
    UserTierContext,
} from '@/domain/types';

export type { UserApiKeyRequiredError };

/**
 * Usage tracking and daily limit options for analysis submissions.
 *
 * Re-exported from `@/application/usage/types` so existing public imports
 * (`@y0ngha/siglens-core` → `AnalysisUsageOptions`) keep working. The same
 * type is shared by every analysis use-case (technical, fundamental, news,
 * overall) — see the canonical definition in `usage/types.ts`.
 */
export type { AnalysisUsageOptions };

/** Options controlling analysis submission behavior. */
export interface SubmitAnalysisOptions extends BackgroundTaskOptions {
    /** Optional usage tracking. Omitted callers keep the previous behavior. */
    usage?: AnalysisUsageOptions;
    /** Request-scoped tier context used to enforce timeframe access. */
    tierContext?: UserTierContext;
    /** Tier configuration override, mainly for tests and controlled rollouts. */
    tierConfig?: TierConfig;
    /** LLM model identifier used to isolate cached results per model and for worker routing. */
    modelId?: ModelId;
    /**
     * BYOK API key. Must be provided when a non-pro tier requests a premium model.
     * When provided, forwarded to the worker as the X-AI-API-KEY header.
     */
    userApiKey?: string;
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

/** Analysis error result when tier timeframe access is denied. */
export interface TierGateErrorResult {
    status: 'error';
    error: TierTimeframeAccessError;
}

/** Analysis error result: usage limit exceeded, tier timeframe denied, or BYOK key required. */
export type SubmitAnalysisErrorResult =
    | { status: 'error'; error: AnalysisLimitError }
    | UserApiKeyRequiredError
    | TierGateErrorResult;

/** Submit analysis outcome including application-level gate errors. */
export type SubmitAnalysisGatedResult =
    | { status: 'cached'; result: AnalysisResponse }
    | { status: 'submitted'; jobId: string }
    | SubmitAnalysisErrorResult;
