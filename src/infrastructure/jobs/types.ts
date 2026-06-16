import type { Timeframe } from '@/domain/types';

/** @internal Lifecycle status of an analysis or briefing job. */
export type JobStatus = 'processing' | 'done' | 'error';

/**
 * @internal Per-job metadata stored alongside the result so {@link pollAnalysis} can
 * reconstruct cache keys and run domain-side reconciliation without fetching
 * the bars again.
 */
export interface JobMeta {
    /**
     * U.S. stock ticker (e.g. `AAPL`) or the sentinel `market` for
     * market-briefing jobs. For technical, fundamental, news, overall, and
     * market-briefing analysis jobs only. Do not use for market-news feed-bucket
     * digests — use {@link category} instead.
     */
    symbol?: string;
    /**
     * Feed-bucket identifier for market-news category digest jobs (e.g. `crypto`,
     * `macro`). Distinct from {@link symbol}, which is reserved for U.S. stock
     * ticker analyses. Not set on symbol-scoped analysis jobs.
     */
    category?: string;
    /**
     * Bar resolution. Required for technical-analysis jobs and overall
     * analysis jobs (both are timeframe-bound). Omitted for fundamental and
     * news analysis jobs that are not timeframe-bound.
     */
    timeframe?: Timeframe;
    /**
     * Set to `true` when the loaded skills failed to read from disk and the
     * analysis ran with an empty skills list. Used by the worker / consumer
     * to surface a degraded warning.
     *
     * Applies only to job types that load skills directly at submit time:
     * technical, fundamental, and news analysis jobs. The overall analysis
     * pipeline composes pre-computed axis results and does not load skills
     * itself, so this field is not set on overall jobs.
     */
    skillsDegraded?: boolean;
    /** Last bar close — used as the reconciliation reference for SL/TP validation when the AI omits an entry price. */
    lastClose?: number;
    /** Last ATR — used to derive fallback SL/TP levels; when absent the AI's original values are preserved. */
    atr?: number;
    /** LLM model identifier used to isolate analysis results by model in the cache. */
    modelId?: string;
    /**
     * Pre-computed cache key stored at job submission time so the poll step
     * can write the result without recomputing the key. Used by fundamental,
     * news, overall, and market-briefing analysis jobs whose cache keys include
     * an input hash.
     */
    cacheKey?: string;
    /**
     * Options OI snapshot staleness marker (overall analysis jobs only).
     * Stored at submit time so `pollOverallAnalysis` can echo it back via
     * `OverallAnalysisResponse.optionsOiStale` when normalizing the worker
     * response. The caller (app side) decides the value using
     * `isOpenInterestSnapshotStale + isUsOptionsRegularSession`.
     */
    optionsOiStale?: boolean;
}
