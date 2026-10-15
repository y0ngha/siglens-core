import type { KeyPolicy } from '@/domain/keyRouting';
import type { BackgroundTaskOptions } from '@/application/types';
import type { UserApiKeyRequiredError } from '@/application/byok/types';
import type {
    AnalysisLimitError,
    AnalysisUsageOptions,
} from '@/application/usage/types';
import type { AnalysisLocale } from '@/domain/analysis/outputLocale';
import type {
    CurrencyCode,
    FundamentalAnalysisResponse,
    ModelId,
    Tier,
    TierConfig,
} from '@/domain/types';
import type { FundamentalDataProvider } from '@/domain/ports/fundamentalDataProvider';

// ─────────────────────────────────────────
// Submit
// ─────────────────────────────────────────

/** Options controlling fundamental analysis submission behavior. */
export interface SubmitFundamentalAnalysisOptions extends BackgroundTaskOptions {
    /** U.S. equity ticker (e.g. `"AAPL"`). */
    symbol: string;
    /** LLM model identifier used for the analysis and cache scoping. */
    modelId: ModelId;
    /**
     * Fundamental data provider implementation (injected by the caller).
     * Core depends only on the interface — never on a concrete HTTP client.
     */
    dataProvider: FundamentalDataProvider;
    /**
     * Resolved subscription tier.
     *
     * Required in two cases:
     * 1. When `usage` is also provided — enforces the daily analysis limit.
     * 2. When a premium model is requested — determines BYOK key requirement.
     *    Defaults to {@link DEFAULT_TIER} (`'free'`) when omitted.
     */
    tier?: Tier;
    /** Tier configuration override, mainly for tests and controlled rollouts. */
    tierConfig?: TierConfig;
    /**
     * Optional usage tracking. When provided together with `tier`, the daily
     * analysis limit is checked before fetching data, and one usage record is
     * written on every path that returns a result (cache hit or successful
     * submit). Omit to skip both checks and recording (pre-Phase 4 behavior).
     */
    usage?: AnalysisUsageOptions;
    /**
     * Reference timestamp for limit checks. Defaults to `new Date()` at call
     * time. Useful in tests that need a fixed clock.
     */
    now?: Date;
    /**
     * BYOK API key. Must be provided when a non-pro tier requests a premium model.
     * When provided, forwarded to the worker as the X-AI-API-KEY header.
     */
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
     * When `true`, skip enqueueing a new analysis job on cache miss and return
     * `{ status: 'miss_no_trigger' }` instead. Cache hits are unaffected and
     * still returned. Intended for consumer-side gating of bot/crawler traffic
     * that should not trigger worker compute.
     */
    skipEnqueueIfMiss?: boolean;
    /**
     * When true, bypass the cache and enqueue a fresh analysis. Mirrors
     * submitAnalysis's positional force parameter so all four axes accept
     * the same re-analyze lever.
     */
    force?: boolean;
    /**
     * Per-request deep-thinking toggle (member-reasoning-toggle spec, Part A).
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
     * Listing quote currency, supplied from the caller's market profile (core
     * never derives it from the symbol — see {@link CurrencyCode}). Labels
     * market cap and price targets; statement figures use the snapshot's own
     * reporting currency. Defaults to `'USD'`. Not part of the cache key: it is
     * a fixed property of the symbol.
     */
    currency?: CurrencyCode;
    /**
     * Current price in the listing's quote currency, supplied by the caller
     * (core has no quote provider of its own — the fundamental data provider
     * carries no live price). Threaded onto `FundamentalSnapshot.currentPrice`
     * so `## Derived Metrics`'s price-relative lines (target upside) can
     * compute instead of reading `N/A` on every request. Invalid values
     * (non-finite, zero, or negative — a quote failure renders `0` in this
     * codebase) are treated as absent, never as a real price. Not part of the
     * cache key: like `currentPrice` on the analogous technical-axis path,
     * this is a point-in-time reading, not a property the cached prompt
     * should be keyed on.
     *
     * May also be a lazy getter (spec 2026-09-18):
     * `runFundamentalAnalysis` only calls it AFTER the cache check misses, so
     * a cache HIT never pays for a quote fetch the caller would otherwise
     * have to do eagerly on every call regardless of whether it was needed.
     */
    currentPrice?: number | null | (() => Promise<number | null>);
    /**
     * Cancellation signal for the in-flight LLM call (used by `runFundamentalAnalysis`).
     * When provided, passed through to `callAnalysisAi` so a dropped connection
     * can abort the underlying AI provider request. Has no effect on
     * `submitFundamentalAnalysis` (the worker-based path does not accept a signal).
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
export interface SubmitFundamentalAnalysisCached {
    status: 'cached';
    result: FundamentalAnalysisResponse;
}

/**
 * A new analysis job was submitted; poll with `jobId` for the result.
 */
export interface SubmitFundamentalAnalysisSubmitted {
    status: 'submitted';
    jobId: string;
}

/**
 * Result variant when the daily analysis limit is exceeded.
 */
export interface SubmitFundamentalAnalysisLimitError {
    status: 'error';
    code: 'usage_limit_exceeded';
    error: AnalysisLimitError;
}

/**
 * Result variant when the provider fetch or data normalization fails.
 */
export interface SubmitFundamentalAnalysisFetchError {
    status: 'error';
    code: 'fetch_failed';
    error?: string;
}

/**
 * Result variant when a user BYOK API key is required for the requested model+tier combo.
 */
export type SubmitFundamentalAnalysisApiKeyRequiredError =
    UserApiKeyRequiredError;

/**
 * Result indicating the analysis cache missed but no job was enqueued because
 * the caller opted out via `skipEnqueueIfMiss`. The consumer is expected to
 * render a fallback in this case.
 */
export interface SubmitFundamentalAnalysisMissNoTrigger {
    status: 'miss_no_trigger';
}

/** Union of all possible outcomes from {@link submitFundamentalAnalysis}. */
export type SubmitFundamentalAnalysisResult =
    | SubmitFundamentalAnalysisCached
    | SubmitFundamentalAnalysisSubmitted
    | SubmitFundamentalAnalysisMissNoTrigger
    | SubmitFundamentalAnalysisLimitError
    | SubmitFundamentalAnalysisFetchError
    | SubmitFundamentalAnalysisApiKeyRequiredError;

// ─────────────────────────────────────────
// Poll
// ─────────────────────────────────────────

/** Outcome of {@link pollFundamentalAnalysis}: still processing, finished, or errored. */
export type PollFundamentalAnalysisResult =
    | { status: 'processing' }
    | { status: 'done'; result: FundamentalAnalysisResponse }
    | { status: 'error'; error: string };

// ─────────────────────────────────────────
// Run (direct, non-queued)
// ─────────────────────────────────────────

/**
 * Result of a `runFundamentalAnalysis` call — the direct (non-queued) successor
 * to the `submitFundamentalAnalysis` + `pollFundamentalAnalysis` pair.
 *
 * - `cached`: a recent analysis was found in the cache and returned as-is.
 * - `done`: the LLM completed and the result is ready.
 * - `miss_no_trigger`: cache missed and `skipEnqueueIfMiss` was set; caller
 *   should render a fallback.
 * - `error`: a usage limit, BYOK gate, or provider fetch error denied the
 *   request.
 * - `key_error`: a BYOK API key is required for the requested model+tier combo.
 *
 * LLM-level failures (provider errors, network, abort) propagate as thrown
 * exceptions so the caller can map them to appropriate HTTP responses.
 */
export type RunFundamentalAnalysisResult =
    | SubmitFundamentalAnalysisCached
    | { status: 'done'; result: FundamentalAnalysisResponse }
    | SubmitFundamentalAnalysisMissNoTrigger
    | SubmitFundamentalAnalysisLimitError
    | SubmitFundamentalAnalysisFetchError
    | SubmitFundamentalAnalysisApiKeyRequiredError;
