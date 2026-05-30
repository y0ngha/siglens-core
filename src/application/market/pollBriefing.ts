import { cleanupInBackground, fireAndForget } from '@/application/background';
import type { BackgroundTaskOptions } from '@/application/types';
import type {
    MarketBriefingResponse,
    PollBriefingResult,
} from '@/domain/types';
import { normalizeMarketBriefing } from '@/domain/analysis/normalizeMarketBriefing';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { MARKET_BRIEFING_CACHE_TTL } from '@/infrastructure/cache/config';
import {
    getJobError,
    getJobMeta,
    getJobResult,
    getJobStatus,
} from '@/infrastructure/jobs/queue';

/**
 * Poll the result of a briefing job submitted via {@link submitBriefing}.
 *
 * Returns one of three outcomes:
 * - `processing`: the worker has not finished yet. Caller should retry.
 * - `error`: missing or malformed result (`summary` field absent), or the
 *   worker reported a failure.
 * - `done`: normalized briefing plus its `generatedAt` timestamp. The result
 *   is written under the same input-hashed cache key recorded in the job meta
 *   at submit time, so only callers with identical inputs within the same hour
 *   get a cache hit. If the job meta / `cacheKey` is absent (e.g. TTL expiry),
 *   the cache write is skipped.
 *
 * On every terminal outcome (`error` or `done`) the job is cleaned up from
 * Redis (best-effort).
 *
 * @param jobId - The `jobId` returned by {@link submitBriefing}.
 * @param options - Optional background-task hooks. Pass Vercel's `waitUntil`
 *   so Redis cleanup and cache writes can continue after the response.
 * @returns The current poll outcome — see {@link PollBriefingResult}.
 *
 * @see submitBriefing
 */
export async function pollBriefing(
    jobId: string,
    options?: BackgroundTaskOptions
): Promise<PollBriefingResult> {
    const status = await getJobStatus(jobId);

    if (status === null || status === 'processing') {
        return { status: 'processing' };
    }

    if (status === 'error') {
        const error = await getJobError(jobId);
        cleanupInBackground(jobId, '[Briefing/Poll]', options);
        return { status: 'error', error: error ?? 'Unknown error' };
    }

    // status === 'done'
    const raw = await getJobResult(jobId);
    if (!raw) {
        cleanupInBackground(jobId, '[Briefing/Poll]', options);
        return { status: 'error', error: 'Result not found' };
    }

    const briefing: MarketBriefingResponse = normalizeMarketBriefing(raw);

    if (!briefing.summary) {
        cleanupInBackground(jobId, '[Briefing/Poll]', options);
        return { status: 'error', error: 'Invalid briefing result' };
    }

    const generatedAt = new Date().toISOString();

    // The briefing cache key folds in an input hash of the index/sector data,
    // which only the submit path can compute. submitBriefing stored that exact
    // key in the job meta, so we write under the SAME key here (read == write).
    // If the meta key is missing (e.g. TTL expiry), skip the write rather than
    // reconstruct a key that would diverge from the submit-side lookup.
    const meta = await getJobMeta(jobId);
    const cacheKey = meta?.cacheKey;
    const cache = createCacheProvider();
    if (cacheKey !== undefined && cache !== null) {
        fireAndForget(
            cache
                .set(
                    cacheKey,
                    { briefing, generatedAt },
                    MARKET_BRIEFING_CACHE_TTL
                )
                .catch(err =>
                    console.error('[Briefing/Poll] Cache write failed:', err)
                ),
            options
        );
    }

    cleanupInBackground(jobId, '[Briefing/Poll]', options);
    return { status: 'done', briefing, generatedAt };
}
