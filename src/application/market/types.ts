import type { BackgroundTaskOptions } from '@/application/types';
import type { UserApiKeyRequiredError } from '@/application/byok/types';
import type {
    AnalysisLimitError,
    AnalysisUsageOptions,
} from '@/application/usage/types';
import { getAllowedTimeframes } from '@/domain/tier';
import type {
    AnalysisResponse,
    AssetClass,
    FilteredAnalysisResponse,
    ModelId,
    PositionBucket,
    Tier,
    TierConfig,
    TierInfoDepth,
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
    /**
     * Member position-bucket hint
     * (personalized-analysis-by-position-bucket spec, Subsystem C). A
     * FINISHED bucket enum — never the raw average price or quantity —
     * derived by the caller from a server-read holding. Folded into the
     * cache key (see {@link buildAnalysisCacheKey}'s `positionBucket` param)
     * AFTER the reasoning suffix, and injected as a neutral Korean hint into
     * the prompt's `dynamic` section (see `buildAnalysisPrompt`'s
     * `positionBucket` param) — never into `stable`, and never joined into
     * the skill-sampling seed (the bucket must not change which skills are
     * sampled). `undefined` (no holding, free tier, or an unbucketable
     * position) produces the exact same cache key and prompt as omitting the
     * option entirely (backward compatible). Tier/holding gating (free tier
     * must never receive a bucket) is the caller's responsibility — core
     * forwards whatever value it is given.
     */
    positionBucket?: PositionBucket;
    /**
     * Cancellation signal for the in-flight LLM call (used by `runAnalysis`).
     * When provided, passed through to `callAnalysisAi` so a dropped SSE
     * connection can abort the underlying AI provider request rather than
     * letting it run to completion against a gone client.
     *
     * Has no effect on `submitAnalysis` / `pollAnalysis` (the worker-based
     * submit/poll pair does not accept a signal).
     */
    signal?: AbortSignal;
}

/**
 * Options controlling a public analysis poll response.
 *
 * The resolved caller tier is intentionally supplied at poll time: a job can
 * outlive a tier change, and its submit-time tier must never determine what a
 * later caller can read.
 */
export interface PollAnalysisOptions extends BackgroundTaskOptions {
    /** Resolved tier of the caller receiving this poll response. */
    tier?: Tier;
    /** Tier policy used to filter this poll response. */
    tierConfig?: TierConfig;
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
 * @internal
 * Build the human-readable "timeframe not allowed" message shared by the
 * submit-path {@link buildTimeframeNotAllowedError} and both poll paths
 * (`pollAnalysis`, `pollOverallAnalysis`) so the wording never drifts between
 * the three call sites that report the same denial.
 *
 * @param tier - Tier used for the access decision.
 * @param timeframe - Timeframe requested by the caller.
 * @returns The message string embedded in the timeframe-gate error/result.
 */
export function timeframeNotAllowedMessage(
    tier: Tier,
    timeframe: Timeframe
): string {
    return `Timeframe ${timeframe} is not available for ${tier} tier.`;
}

/**
 * @internal
 * Build the {@link TierTimeframeAccessError} payload for a denied timeframe
 * request. Shared by every submit use-case that runs the timeframe gate
 * (`submitAnalysis`'s `submitAnalysisWithVisibility` and
 * `submitOverallAnalysis`) so the error shape stays byte-identical across
 * axes instead of being hand-duplicated at each call site.
 *
 * @param tier - Tier used for the access decision.
 * @param timeframe - Timeframe requested by the caller.
 * @param tierConfig - Tier configuration; defaults to {@link TIER_CONFIG} at
 *   each call site (this helper takes it as a required parameter so callers
 *   pass the same resolved config they used for the `isTimeframeAllowed` check).
 * @returns The error payload to embed in a `{ status: 'error', error }` result.
 */
export function buildTimeframeNotAllowedError(
    tier: Tier,
    timeframe: Timeframe,
    tierConfig: TierConfig
): TierTimeframeAccessError {
    return {
        code: 'timeframe_not_allowed',
        message: timeframeNotAllowedMessage(tier, timeframe),
        tier,
        timeframe,
        allowedTimeframes: getAllowedTimeframes(tier, tierConfig),
    };
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

/**
 * Result of a `runAnalysis` call — the direct (non-queued) successor to the
 * `submitAnalysis` + `pollAnalysis` pair.
 *
 * - `cached`: a recent analysis was found in the cache and returned as-is.
 * - `done`: the LLM completed and the result is ready.
 * - `miss_no_trigger`: cache missed and `skipEnqueueIfMiss` was set; caller
 *   should render a fallback.
 * - `error`: a tier gate, usage limit, or BYOK gate denied the request.
 *
 * LLM-level failures (provider errors, network, abort) propagate as thrown
 * exceptions so the SSE handler can map them to appropriate HTTP responses.
 */
export type RunAnalysisResult =
    | {
          status: 'cached';
          result: AnalysisResponse | FilteredAnalysisResponse;
          lockedInfoDepth: readonly TierInfoDepth[];
      }
    | {
          status: 'done';
          result: AnalysisResponse | FilteredAnalysisResponse;
          lockedInfoDepth: readonly TierInfoDepth[];
      }
    | SubmitAnalysisMissNoTrigger
    | SubmitAnalysisErrorResult;

/** Submit analysis outcome including application-level gate errors. */
export type SubmitAnalysisGatedResult =
    | {
          status: 'cached';
          result: AnalysisResponse | FilteredAnalysisResponse;
          lockedInfoDepth: readonly TierInfoDepth[];
      }
    | { status: 'submitted'; jobId: string }
    | SubmitAnalysisMissNoTrigger
    | SubmitAnalysisErrorResult;
