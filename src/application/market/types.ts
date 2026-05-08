import type { BackgroundTaskOptions } from '@/application/types';
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
    /** User-supplied AI API key forwarded as `X-AI-API-KEY` to the worker. Must be provided when the selected model requires a user-supplied API key; omit for platform-managed models. */
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

/** Result variant when a user BYOK API key is required for the requested model+tier combo. */
export interface UserApiKeyRequiredError {
    code: 'user_api_key_required';
    message: string;
}

/** Analysis error result: usage limit exceeded or tier timeframe denied. */
export type SubmitAnalysisErrorResult =
    | { status: 'error'; error: AnalysisLimitError }
    | { status: 'error'; error: UserApiKeyRequiredError }
    | TierGateErrorResult;

/** Submit analysis outcome including application-level gate errors. */
export type SubmitAnalysisGatedResult =
    | { status: 'cached'; result: AnalysisResponse }
    | { status: 'submitted'; jobId: string }
    | SubmitAnalysisErrorResult;
