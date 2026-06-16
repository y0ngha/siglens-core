import type { BackgroundTaskOptions } from '@/application/types';
import type {
    EnrichedNewsItem,
    ModelId,
    NewsAnalysisResponse,
    NewsFeedCategory,
    Skill,
} from '@/domain/types';

/**
 * Options for submitting a market-news category digest job.
 *
 * Unlike {@link SubmitNewsAnalysisOptions}, this variant has no symbol,
 * companyName, earnings calendar, tier, usage, or BYOK handling — the
 * category digest is a public, non-gated analysis of the market-wide news
 * flow for a single feed category.
 */
export interface SubmitMarketNewsDigestOptions extends BackgroundTaskOptions {
    /** Feed-category bucket (e.g. `'crypto'`, `'general'`). */
    category: NewsFeedCategory;
    /** Human Korean label shown to the model, e.g. '미국 암호화폐'. */
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
    /**
     * When `true`, skip enqueueing a new job on cache miss and return
     * `{ status: 'miss_no_trigger' }`. Cache hits are unaffected.
     * Intended for bot/crawler gating.
     */
    skipEnqueueIfMiss?: boolean;
    /**
     * When `true`, bypass the cache and enqueue a fresh analysis regardless of
     * whether a warm cache entry exists.
     */
    force?: boolean;
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

/** Outcome of {@link pollMarketNewsDigest}: still processing, finished, or errored. */
export type PollMarketNewsDigestResult =
    | { status: 'processing' }
    | { status: 'done'; result: NewsAnalysisResponse }
    | { status: 'error'; error: string };
