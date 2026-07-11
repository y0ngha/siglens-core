import type { BackgroundTaskOptions } from '@/application/types';
import type { UserApiKeyRequiredError } from '@/application/byok/types';
import type {
    AnalysisLimitError,
    AnalysisUsageOptions,
} from '@/application/usage/types';
import type {
    AnalysisResponse,
    AssetClass,
    ModelId,
    Tier,
    TierConfig,
    Timeframe,
    UserTierContext,
} from '@/domain/types';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';

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

/**
 * Options controlling analysis submission behavior.
 */
export interface SubmitAnalysisOptions extends BackgroundTaskOptions {
    /**
     * Market data provider injected by the consumer (siglens app).
     *
     * Must be provided when a cache miss can occur and bars will be fetched.
     * May be omitted when `skipEnqueueIfMiss: true` — that path short-circuits
     * before the fetch site.
     */
    marketDataProvider?: MarketDataProvider;
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
    /**
     * When `true`, skip enqueueing a new analysis job on cache miss and return
     * `{ status: 'miss_no_trigger' }` instead. Cache hits are unaffected and
     * still returned. Intended for consumer-side gating of bot/crawler traffic
     * that should not trigger worker compute.
     */
    skipEnqueueIfMiss?: boolean;
    /**
     * Instrument asset class. Controls prompt framing: `'crypto'` drops
     * equity-specific language (earnings, fundamentals, analyst ratings) and
     * adds 24/7 context. Defaults to `'equity'` for backward compatibility.
     */
    assetClass?: AssetClass;
    /**
     * Per-request deep-thinking toggle (member-reasoning-toggle spec, Part A).
     * `true` requests the model's default/spec reasoning depth; `false` or
     * omitted requests the provider-minimized (worker-side) setting — the
     * pre-toggle default. Folded into the cache key so ON and OFF results
     * never collide (see {@link buildAnalysisCacheKey}); forwarded to the
     * worker `/analyze` body only when `true`. Tier enforcement (free tier
     * must not receive `true`) is the caller's responsibility — core forwards
     * whatever value it is given.
     */
    reasoning?: boolean;
}

/**
 * Error returned when application tier gates block a timeframe request.
 */
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

/**
 * Analysis error result when tier timeframe access is denied.
 */
export interface TierGateErrorResult {
    status: 'error';
    error: TierTimeframeAccessError;
}

/**
 * Analysis error result: usage limit exceeded, tier timeframe denied, or BYOK key required.
 */
export type SubmitAnalysisErrorResult =
    | { status: 'error'; error: AnalysisLimitError }
    | UserApiKeyRequiredError
    | TierGateErrorResult;

/**
 * Result indicating the analysis cache missed but no job was enqueued because
 * the caller opted out via `skipEnqueueIfMiss`. The consumer is expected to
 * render a fallback in this case.
 */
export interface SubmitAnalysisMissNoTrigger {
    status: 'miss_no_trigger';
}

/** Submit analysis outcome including application-level gate errors. */
export type SubmitAnalysisGatedResult =
    | { status: 'cached'; result: AnalysisResponse }
    | { status: 'submitted'; jobId: string }
    | SubmitAnalysisMissNoTrigger
    | SubmitAnalysisErrorResult;
