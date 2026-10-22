import type { KeyPolicy } from '@/domain/keyRouting';
import type { BackgroundTaskOptions, CacheOptions } from '@/application/types';
import type { AnalysisLocale } from '@/domain/analysis/outputLocale';
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
export interface SubmitMarketNewsDigestOptions
    extends BackgroundTaskOptions, CacheOptions {
    /** Feed-category bucket (e.g. `'crypto'`, `'general'`). */
    category: NewsFeedCategory;
    /** Human-readable Korean category label shown to the model (e.g. `'미국 암호화폐'`). */
    categoryLabel: string;
    /** LLM model identifier used for the analysis and cache scoping. */
    modelId: ModelId;
    /**
     * Enriched news items (already analyzed per-card).
     * If empty, submission returns `{ status: 'no_news' }`.
     */
    news: ReadonlyArray<EnrichedNewsItem>;
    /** Skills to inject. Only `category === 'news'` entries are used. Defaults to `[]`. */
    skills?: readonly Skill[];
    /** Resolved subscription tier. Defaults to the free tier when omitted. */
    tier?: Tier;
    /**
     * Per-request deep-thinking toggle, forwarded to `callAnalysisAi`.
     *
     * `true` forces reasoning on even when `MODEL_SPECS[modelId].thinking` is
     * `false` — that override is what lets the digest run reasoning on a cheap
     * non-reasoning model (`deepseek-v4.1-flash`) instead of paying for a
     * reasoning-tier model. `false` forces it off. Omitted preserves the
     * model spec's own default.
     *
     * The digest synthesises a whole category feed (dozens of already-analyzed
     * cards) into one narrative, which is where reasoning actually pays for
     * itself — unlike the per-card path, which is a deterministic translation
     * and stays off.
     *
     * Participates in the cache key (`:reason=on` suffix) and in the skill
     * sampling seed, so an on/off pair never shares a cached digest. `false`
     * and `undefined` key identically to omitting it, so entries written
     * before this option existed still hit.
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
     * Caller's own provider key. Used only when `keyPolicy` is `'byok-only'`
     * (this pipeline's fixed model is a free-class server-key model otherwise).
     */
    userApiKey?: string;
    /**
     * Which key pays for generation. Default `'tier'` (server key — this
     * pipeline's model is free-class). `'byok-only'` uses `userApiKey` instead,
     * throws `UserApiKeyMissingError` when it is missing, and never reads a
     * server key. Not part of any cache key, so results are shared across policies; a
     * cache hit is served even without a key (the key gate runs after the cache
     * read, before any data fetch or provider call), and concurrent byok-only
     * runs only join runs on the same key. See {@link KeyPolicy}.
     */
    keyPolicy?: KeyPolicy;
    /**
     * Cancellation signal for the in-flight LLM call (used by `runMarketNewsDigest`).
     * When provided, passed through to `callAnalysisAi` so a dropped connection
     * can abort the underlying AI provider request.
     *
     * Has no effect on `submitMarketNewsDigest` (the worker-based path).
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

/**
 * Subset of {@link SubmitMarketNewsDigestOptions} that participates in the
 * digest cache key. Runtime-only options (`force`, `signal`, …) are excluded
 * so a peek caller cannot accidentally shift the key.
 *
 * This is the parameter type of the public `peekMarketNewsDigestCache`.
 */
export type MarketNewsDigestCacheKeyOptions = Pick<
    SubmitMarketNewsDigestOptions,
    'category' | 'modelId' | 'news' | 'locale' | 'reasoning' | 'skills' | 'tier'
>;

/** @internal Cache key plus the sampled skills the key was derived from. */
export interface MarketNewsDigestCacheKeyPlan {
    cacheKey: string;
    /** Tier-sampled skills — the caller must build its prompt from exactly these. */
    skills: readonly Skill[];
}
