import type { Timeframe } from '@/domain/types';

/** Lifecycle status of an analysis or briefing job. */
export type JobStatus = 'processing' | 'done' | 'error';

/** @internal Redis `SET` options accepted by the job-queue Redis client. */
export interface RedisSetOpts {
    ex: number;
}

/** @internal Minimal Redis surface used by the job-queue layer. */
export interface JobRedisClient {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, opts: RedisSetOpts): Promise<unknown>;
    del(...keys: string[]): Promise<number>;
}

/**
 * Per-job metadata stored alongside the result so {@link pollAnalysis} can
 * reconstruct cache keys and run domain-side reconciliation without fetching
 * the bars again.
 */
export interface JobMeta {
    /** U.S. equity ticker. */
    symbol: string;
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
     * news, and overall analysis jobs whose cache keys include an input hash.
     */
    cacheKey?: string;
}
