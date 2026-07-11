import type { BackgroundTaskOptions } from '@/application/types';
import type { UserApiKeyRequiredError } from '@/application/byok/types';
import type {
    AnalysisLimitError,
    AnalysisUsageOptions,
} from '@/application/usage/types';
import type {
    AssetClass,
    EarningsCalendarItem,
    EnrichedNewsItem,
    ModelId,
    NewsAnalysisResponse,
    NewsCardAnalysis,
    NewsItem,
    Tier,
    TierConfig,
} from '@/domain/types';

// ─────────────────────────────────────────
// Submit News Analysis
// ─────────────────────────────────────────

/** Options controlling news analysis submission behavior. */
export interface SubmitNewsAnalysisOptions extends BackgroundTaskOptions {
    /** U.S. equity ticker (e.g. `"AAPL"`). */
    symbol: string;
    /** Full company name forwarded to the news analysis prompt. Defaults to `symbol` when omitted. */
    companyName?: string;
    /** LLM model identifier used for the analysis and cache scoping. */
    modelId: ModelId;
    /**
     * Enriched news items (already analyzed per-card by flash-lite).
     * If empty, submission returns `{ status: 'error', code: 'no_news' }`.
     */
    news: ReadonlyArray<EnrichedNewsItem>;
    /** Upcoming or recent earnings calendar entries for the symbol. */
    upcomingCalendar: readonly EarningsCalendarItem[];
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
     * analysis limit is checked before submission, and one usage record is
     * written on every path that returns a result (cache hit or successful
     * submit). Omit to skip both checks and recording.
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
     * Instrument asset class. Controls prompt framing: `'crypto'` drops
     * equity-specific language (earnings, fundamentals, analyst ratings).
     * Defaults to `'equity'` for backward compatibility.
     */
    assetClass?: AssetClass;
    /**
     * Per-request deep-thinking toggle (member-reasoning-toggle spec, Part A).
     * `true` requests the model's default/spec reasoning depth; `false` or
     * omitted requests the provider-minimized setting — the pre-toggle
     * default. Folded into the cache key so ON and OFF results never
     * collide; forwarded to the worker `/analyze` body only when `true`.
     */
    reasoning?: boolean;
}

/**
 * The caller receives a cached analysis — no new job was created.
 */
export interface SubmitNewsAnalysisCached {
    status: 'cached';
    result: NewsAnalysisResponse;
}

/**
 * A new analysis job was submitted; poll with `jobId` for the result.
 */
export interface SubmitNewsAnalysisSubmitted {
    status: 'submitted';
    jobId: string;
}

/**
 * Result variant when no news items were provided to analyze.
 */
export interface SubmitNewsAnalysisNoNewsError {
    status: 'error';
    code: 'no_news';
    error: string;
}

/**
 * Result variant when the daily analysis limit is exceeded.
 */
export interface SubmitNewsAnalysisLimitError {
    status: 'error';
    code: 'usage_limit_exceeded';
    error: AnalysisLimitError;
}

/**
 * Result variant when a user BYOK API key is required for the requested model+tier combo.
 */
export type SubmitNewsAnalysisApiKeyRequiredError = UserApiKeyRequiredError;

/**
 * Result indicating the analysis cache missed but no job was enqueued because
 * the caller opted out via `skipEnqueueIfMiss`. The consumer is expected to
 * render a fallback in this case.
 */
export interface SubmitNewsAnalysisMissNoTrigger {
    status: 'miss_no_trigger';
}

/** Union of all possible outcomes from {@link submitNewsAnalysis}. */
export type SubmitNewsAnalysisResult =
    | SubmitNewsAnalysisCached
    | SubmitNewsAnalysisSubmitted
    | SubmitNewsAnalysisMissNoTrigger
    | SubmitNewsAnalysisNoNewsError
    | SubmitNewsAnalysisLimitError
    | SubmitNewsAnalysisApiKeyRequiredError;

// ─────────────────────────────────────────
// Poll News Analysis
// ─────────────────────────────────────────

/** Outcome of {@link pollNewsAnalysis}: still processing, finished, or errored. */
export type PollNewsAnalysisResult =
    | { status: 'processing' }
    | { status: 'done'; result: NewsAnalysisResponse }
    | { status: 'error'; error: string };

// ─────────────────────────────────────────
// Submit News Card Analysis
// ─────────────────────────────────────────

/**
 * Options controlling per-card news analysis submission behavior.
 */
export interface SubmitNewsCardAnalysisOptions extends BackgroundTaskOptions {
    /** The raw news item to analyze. */
    item: NewsItem;
    /**
     * Override for the model's default thinking budget (tokens).
     * Pass `0` to disable extended thinking entirely — recommended for
     * translation and sentiment classification tasks where chain-of-thought
     * adds latency and cost without a quality benefit.
     *
     * When omitted the worker uses `MODEL_SPECS[model].thinkingBudget`.
     */
    thinkingBudget?: number;
}

/**
 * A new card analysis job was submitted; poll with `jobId` for the result.
 */
export interface SubmitNewsCardAnalysisSubmitted {
    status: 'submitted';
    jobId: string;
}

/**
 * Result of {@link submitNewsCardAnalysis}.
 *
 * Always `submitted`. The caller is responsible for filtering
 * already-analyzed items via their own persistence layer before calling
 * this function.
 */
export type SubmitNewsCardAnalysisResult = SubmitNewsCardAnalysisSubmitted;

// ─────────────────────────────────────────
// Poll News Card Analysis
// ─────────────────────────────────────────

/** Outcome of {@link pollNewsCardAnalysis}: still processing, finished, or errored. */
export type PollNewsCardAnalysisResult =
    | { status: 'processing' }
    | { status: 'done'; result: NewsCardAnalysis }
    | { status: 'error'; error: string };
