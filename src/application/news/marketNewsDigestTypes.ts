import type { BackgroundTaskOptions } from '@/application/types';
import type {
    EnrichedNewsItem,
    ModelId,
    NewsAnalysisResponse,
    NewsFeedCategory,
    Skill,
    Tier,
} from '@/domain/types';

/**
 * Options for submitting a market-news category digest job.
 *
 * Unlike {@link SubmitNewsAnalysisOptions}, this variant has no symbol,
 * companyName, earnings calendar, usage, or BYOK handling. The category
 * digest is a public analysis of the market-wide news flow for a single feed
 * category with optional tier-aware skill sampling.
 */
export interface SubmitMarketNewsDigestOptions extends BackgroundTaskOptions {
    /** Feed-category bucket (e.g. `'crypto'`, `'general'`). */
    category: NewsFeedCategory;
    /** Human-readable Korean category label shown to the model (e.g. `'미국 암호화폐'`). */
    categoryLabel: string;
    /** LLM model identifier used for the analysis and cache scoping. */
    modelId: ModelId;
    /**
     * Enriched news items (already analyzed per-card by flash-lite).
     * If empty, submission returns `{ status: 'no_news' }`.
     */
    news: ReadonlyArray<EnrichedNewsItem>;
    /** Skills to inject. Only `category === 'news'` entries are used. Defaults to `[]`. */
    skills?: readonly Skill[];
    /** Resolved subscription tier. Defaults to the free tier when omitted. */
    tier?: Tier;
    /**
     * When `true`, skip enqueueing a new job on cache miss and return
     * `{ status: 'miss_no_trigger' }`. Cache hits are unaffected.
     * Intended for bot/crawler gating. Takes precedence over `force`.
     */
    skipEnqueueIfMiss?: boolean;
    /**
     * When true, bypass the cache and enqueue a fresh analysis (mirrors the per-symbol
     * pattern). NOTE: `skipEnqueueIfMiss` still takes precedence — when both `force`
     * and `skipEnqueueIfMiss` are set, the function returns `miss_no_trigger` without
     * dispatching a worker job (preserves the bot cost guard).
     */
    force?: boolean;
    /**
     * Cancellation signal for the in-flight LLM call (used by `runMarketNewsDigest`).
     * When provided, passed through to `callAnalysisAi` so a dropped connection
     * can abort the underlying AI provider request.
     *
     * Has no effect on `submitMarketNewsDigest` (the worker-based path).
     */
    signal?: AbortSignal;
}

/** The caller receives a cached category digest — no new job was created. */
export interface SubmitMarketNewsDigestCached {
    status: 'cached';
    result: NewsAnalysisResponse;
}

/** A new digest job was submitted; poll with `jobId` for the result. */
export interface SubmitMarketNewsDigestSubmitted {
    status: 'submitted';
    jobId: string;
}

/** Result variant when the cache missed but `skipEnqueueIfMiss` was set. */
export interface SubmitMarketNewsDigestMissNoTrigger {
    status: 'miss_no_trigger';
}

/** Result variant when no news items were provided to analyze. */
export interface SubmitMarketNewsDigestNoNewsError {
    status: 'no_news';
}

/** Union of all possible outcomes from {@link submitMarketNewsDigest}. */
export type SubmitMarketNewsDigestResult =
    | SubmitMarketNewsDigestCached
    | SubmitMarketNewsDigestSubmitted
    | SubmitMarketNewsDigestMissNoTrigger
    | SubmitMarketNewsDigestNoNewsError;

/** Outcome of {@link pollMarketNewsDigest}: still processing. */
export interface PollMarketNewsDigestProcessing {
    status: 'processing';
}
/** Outcome of {@link pollMarketNewsDigest}: result is ready. */
export interface PollMarketNewsDigestDone {
    status: 'done';
    result: NewsAnalysisResponse;
}
/** Outcome of {@link pollMarketNewsDigest}: worker reported a failure or normalization error. */
export interface PollMarketNewsDigestError {
    status: 'error';
    error: string;
}
/** Union of all possible outcomes from {@link pollMarketNewsDigest}. */
export type PollMarketNewsDigestResult =
    | PollMarketNewsDigestProcessing
    | PollMarketNewsDigestDone
    | PollMarketNewsDigestError;

// ─────────────────────────────────────────
// Run Market News Digest (direct-await, non-queued)
// ─────────────────────────────────────────

/** Result variant when the LLM completed and the digest is ready. */
export interface RunMarketNewsDigestDone {
    status: 'done';
    result: NewsAnalysisResponse;
}

/**
 * Result of a `runMarketNewsDigest` call — the direct (non-queued) successor
 * to the `submitMarketNewsDigest` + `pollMarketNewsDigest` pair.
 *
 * - `cached`: a recent digest was found in the cache and returned as-is.
 * - `done`: the LLM completed and the result is ready.
 * - `miss_no_trigger`: cache missed and `skipEnqueueIfMiss` was set.
 * - `no_news`: the `news` array was empty; LLM was not called.
 *
 * LLM-level failures propagate as thrown exceptions. Unlike `pollMarketNewsDigest`,
 * there is no `error` variant — normalization is applied to a validated JSON
 * object from `callAnalysisAi`, so structural failures surface as thrown exceptions.
 */
export type RunMarketNewsDigestResult =
    | SubmitMarketNewsDigestCached
    | RunMarketNewsDigestDone
    | SubmitMarketNewsDigestMissNoTrigger
    | SubmitMarketNewsDigestNoNewsError;
