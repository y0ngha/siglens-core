import type { KeyPolicy } from '@/domain/keyRouting';
import type { BackgroundTaskOptions, CacheOptions } from '@/application/types';
import type { UserApiKeyRequiredError } from '@/application/byok/types';
import type {
    AnalysisLimitError,
    AnalysisUsageOptions,
} from '@/application/usage/types';
import type { AnalysisLocale } from '@/domain/analysis/outputLocale';
import type {
    ModelId,
    OptionsAnalysisResponse,
    OptionsExpirationFilter,
    OptionsSnapshot,
    Tier,
    TierConfig,
} from '@/domain/types';

// ─────────────────────────────────────────
// Submit Options Analysis
// ─────────────────────────────────────────

/**
 * Options controlling options analysis submission behavior.
 */
export interface SubmitOptionsAnalysisOptions
    extends BackgroundTaskOptions, CacheOptions {
    /** U.S. equity ticker (e.g. `"AAPL"`). */
    symbol: string;
    /** Company display name for the prompt. Defaults to `symbol` when omitted. */
    companyName?: string;
    /**
     * Target expiration — see {@link OptionsExpirationFilter}. `'YYYY-MM-DD'`
     * selects a single expiration; `'all'` aggregates every expiration in the
     * snapshot (per-chain summaries only, never the full chain, to keep
     * prompt tokens bounded).
     */
    expirationDate: OptionsExpirationFilter;
    /** LLM model identifier used for the analysis and cache scoping. */
    modelId: ModelId;
    /**
     * Caller pre-fetches the options snapshot through the {@link OptionsDataProvider}
     * interface and passes it in. This keeps the use-case decoupled from the
     * concrete provider implementation.
     */
    snapshot: OptionsSnapshot;
    /**
     * Resolved subscription tier. Must be provided when `usage` is also
     * given (enforces the daily analysis limit) or when a premium model is
     * requested (BYOK requirement). Defaults to {@link DEFAULT_TIER}
     * (`'free'`) when omitted.
     */
    tier?: Tier;
    /** Tier configuration override, mainly for tests and controlled rollouts. */
    tierConfig?: TierConfig;
    /**
     * Optional usage tracking. When provided together with `tier`, the daily
     * analysis limit is checked before submission, and one usage record is
     * written on every path that returns a result.
     */
    usage?: AnalysisUsageOptions;
    /**
     * Reference timestamp for time-dependent operations: limit checks,
     * usage recording, and the normalizer's `analyzedAt` (always used
     * directly — the LLM-supplied value is discarded). Defaults to
     * `new Date()`.
     */
    now?: Date;
    /** BYOK API key. Must be provided when a non-pro tier requests a premium model. */
    userApiKey?: string;
    /**
     * Which key pays for generation. Default `'tier'` (free/member models on
     * the server key, byok-class models on `userApiKey`). `'byok-only'` makes
     * every generation use `userApiKey` regardless of model or tier, returns
     * the `key_error` result when it is missing, disables the server-key
     * `providerFallback`, and never reads a server key. Not part of any cache
     * key, so results are shared across policies; a cache hit is served even
     * without a key (the key gate runs after the cache read, before any data
     * fetch or provider call), and concurrent byok-only runs only join runs on
     * the same key. See {@link KeyPolicy}.
     */
    keyPolicy?: KeyPolicy;
    /**
     * When `true`, skip enqueueing on cache miss and return `miss_no_trigger`.
     * Used to gate bot/crawler traffic.
     */
    skipEnqueueIfMiss?: boolean;
    /**
     * When true, bypass the cache and enqueue a fresh analysis. Mirrors
     * submitAnalysis's positional force parameter so all four axes accept
     * the same re-analyze lever.
     */
    force?: boolean;
    /**
     * Per-request deep-thinking toggle.
     * `true` requests the model's default/spec reasoning depth; `false` or
     * omitted requests the provider-minimized setting — the pre-toggle
     * default. Folded into the cache key so ON and OFF results never
     * collide; forwarded to the worker `/analyze` body only when `true`.
     */
    reasoning?: boolean;
    /**
     * Output language for the generated analysis text.
     *
     * Omit it to keep the previous behaviour exactly: Korean output and the
     * same cache key this request used before the field existed.
     */
    locale?: AnalysisLocale;
    /**
     * Cancellation signal for the in-flight LLM call (used by `runOptionsAnalysis`).
     * When provided, passed through to `callAnalysisAi` so a dropped connection
     * can abort the underlying AI provider request. Has no effect on
     * `submitOptionsAnalysis` (the worker-based path does not accept a signal).
     */
    signal?: AbortSignal;
    /**
     * Retry a failed server-key DeepSeek generation once on the fallback Gemini
     * model (see `callAnalysisAi`). Default off — set only by callers where the
     * user could not choose the model (SEO prewarm, the ai.siglens.io agent);
     * a user-selected model must fail visibly instead.
     */
    providerFallback?: boolean;
}

/**
 * The caller receives a cached analysis — no new job was created.
 */
export interface SubmitOptionsAnalysisCached {
    status: 'cached';
    result: OptionsAnalysisResponse;
}

/**
 * A new analysis job was submitted; poll with `jobId` for the result.
 */
export interface SubmitOptionsAnalysisSubmitted {
    status: 'submitted';
    jobId: string;
}

/**
 * The analysis cache missed but no job was enqueued (`skipEnqueueIfMiss`).
 */
export interface SubmitOptionsAnalysisMissNoTrigger {
    status: 'miss_no_trigger';
}

/**
 * Result variant when the daily analysis limit is exceeded.
 *
 * The `status` is `'limit_error'` (not `'error'`) so callers can
 * exhaustively narrow the union via `switch (result.status)` without
 * needing to inspect the `code` field.
 */
export interface SubmitOptionsAnalysisLimitError {
    status: 'limit_error';
    code: 'usage_limit_exceeded';
    error: AnalysisLimitError;
}

/**
 * Result variant when the underlying snapshot has no chains to analyze.
 *
 * The `status` is `'no_chains_error'` (not `'error'`) so callers can
 * exhaustively narrow the union via `switch (result.status)` without
 * needing to inspect the `code` field.
 */
export interface SubmitOptionsAnalysisNoChainsError {
    status: 'no_chains_error';
    code: 'no_options_chains';
    error: string;
}

/**
 * Result variant when a user BYOK API key is required for the requested model+tier combo.
 */
export type SubmitOptionsAnalysisApiKeyRequiredError = UserApiKeyRequiredError;

/** Union of all possible outcomes from `submitOptionsAnalysis`. */
export type SubmitOptionsAnalysisResult =
    | SubmitOptionsAnalysisCached
    | SubmitOptionsAnalysisSubmitted
    | SubmitOptionsAnalysisMissNoTrigger
    | SubmitOptionsAnalysisNoChainsError
    | SubmitOptionsAnalysisLimitError
    | SubmitOptionsAnalysisApiKeyRequiredError;

// ─────────────────────────────────────────
// Poll Options Analysis
// ─────────────────────────────────────────

/**
 * Worker has not finished yet — caller should retry.
 */
export interface PollOptionsAnalysisProcessing {
    status: 'processing';
}

/**
 * Worker finished successfully — `result` is the normalized analysis.
 */
export interface PollOptionsAnalysisDone {
    status: 'done';
    result: OptionsAnalysisResponse;
}

/**
 * Worker reported a failure, result missing, or normalization failed.
 */
export interface PollOptionsAnalysisError {
    status: 'error';
    error: string;
}

/** Outcome of `pollOptionsAnalysis`: still processing, finished, or errored. */
export type PollOptionsAnalysisResult =
    | PollOptionsAnalysisProcessing
    | PollOptionsAnalysisDone
    | PollOptionsAnalysisError;

// ─────────────────────────────────────────
// Run (direct, non-queued)
// ─────────────────────────────────────────

/**
 * Result of a `runOptionsAnalysis` call — the direct (non-queued) successor
 * to the `submitOptionsAnalysis` + `pollOptionsAnalysis` pair.
 *
 * - `cached`: a recent analysis was found in the cache and returned as-is.
 * - `done`: the LLM completed and the result is ready.
 * - `miss_no_trigger`: cache missed and `skipEnqueueIfMiss` was set; caller
 *   should render a fallback.
 * - `no_chains_error`: the snapshot has no usable options chains (graceful skip).
 * - `limit_error`: the per-tier daily analysis limit was exceeded.
 * - `key_error`: a BYOK API key is required for the requested model+tier combo.
 *
 * LLM-level failures (provider errors, network, abort) propagate as thrown
 * exceptions so the caller can map them to appropriate HTTP responses.
 */
export type RunOptionsAnalysisResult =
    | SubmitOptionsAnalysisCached
    | { status: 'done'; result: OptionsAnalysisResponse }
    | SubmitOptionsAnalysisMissNoTrigger
    | SubmitOptionsAnalysisNoChainsError
    | SubmitOptionsAnalysisLimitError
    | SubmitOptionsAnalysisApiKeyRequiredError;
