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
    /** Bar resolution. */
    timeframe: Timeframe;
    /** `true` if skills failed to load when the job was submitted. */
    skillsDegraded: boolean;
    /** Last bar close — used as the reconciliation reference for SL/TP validation when the AI omits an entry price. */
    lastClose?: number;
    /** Last ATR — used to derive fallback SL/TP levels; when absent the AI's original values are preserved. */
    atr?: number;
}
