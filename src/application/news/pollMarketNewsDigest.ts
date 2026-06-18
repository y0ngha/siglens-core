import { cleanupInBackground, fireAndForget } from '@/application/background';
import type { BackgroundTaskOptions } from '@/application/types';
import type { PollMarketNewsDigestResult } from '@/application/news/marketNewsDigestTypes';
import { normalizeNewsAnalysisResponse } from '@/domain/analysis/normalizeNews';
import type { NewsAnalysisResponse } from '@/domain/types';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { NEWS_CACHE_TTL_SECONDS } from '@/infrastructure/cache/config';
import {
    getJobError,
    getJobMeta,
    getJobResult,
    getJobStatus,
} from '@/infrastructure/jobs/queue';

const LOG_TAG = '[PollMarketNewsDigest]' as const;

type TryNormalizeNewsResult =
    | { ok: true; result: NewsAnalysisResponse }
    | { ok: false; error: unknown };

function tryNormalizeNews(raw: unknown): TryNormalizeNewsResult {
    try {
        return { ok: true, result: normalizeNewsAnalysisResponse(raw) };
    } catch (error) {
        return { ok: false, error };
    }
}

/**
 * Poll the result of a market-news category digest job submitted via
 * {@link submitMarketNewsDigest}.
 *
 * Returns one of three outcomes:
 * - `processing`: the worker has not finished yet. Caller should retry.
 * - `error`: the worker reported a failure, the result was missing, or the
 *   payload could not be normalized.
 * - `done`: the result is ready. The raw LLM response is normalized into a
 *   {@link NewsAnalysisResponse} and cached under the pre-computed
 *   `cacheKey` from job metadata before being returned.
 *
 * Mirrors {@link pollNewsAnalysis}, adapted to the category-digest context
 * (no symbol in log messages; no per-company fallback sentinel). Unlike
 * {@link pollNewsAnalysis}, an empty or sparse digest result is still cached —
 * callers rely on the cached entry being present even when sparse.
 *
 * @param jobId   - The `jobId` returned by {@link submitMarketNewsDigest}.
 * @param options - Optional background-task hooks.
 * @returns The current poll outcome — see {@link PollMarketNewsDigestResult}.
 *
 * @see submitMarketNewsDigest
 *
 * @example
 * ```ts
 * const polled = await pollMarketNewsDigest(jobId);
 * if (polled.status === 'done') return polled.result;
 * if (polled.status === 'error') throw new Error(polled.error);
 * // 'processing' → retry after a short delay
 * ```
 */
export async function pollMarketNewsDigest(
    jobId: string,
    options?: BackgroundTaskOptions
): Promise<PollMarketNewsDigestResult> {
    const status = await getJobStatus(jobId);

    if (status === null || status === 'processing') {
        return { status: 'processing' };
    }

    if (status === 'error') {
        const error = await getJobError(jobId);
        cleanupInBackground(jobId, LOG_TAG, options);
        return { status: 'error', error: error ?? 'Unknown error' };
    }

    // status === 'done'
    const [rawResult, meta] = await Promise.all([
        getJobResult(jobId),
        getJobMeta(jobId),
    ]);

    if (!rawResult) {
        console.error(LOG_TAG, 'Result not found', {
            jobId,
            hasMeta: meta !== null,
            category: meta?.category,
        });
        cleanupInBackground(jobId, LOG_TAG, options);
        return { status: 'error', error: 'Result not found' };
    }

    // Normalize the raw LLM response through the shared news response normalizer.
    const normalized = tryNormalizeNews(rawResult);
    if (!normalized.ok) {
        console.error(LOG_TAG, 'Normalization failed:', normalized.error);
        cleanupInBackground(jobId, LOG_TAG, options);
        return { status: 'error', error: 'Invalid response from worker' };
    }
    const result = normalized.result;

    // Do not skip empty/sparse digest results — callers rely on the cached entry being
    // present even when currentDriverKo === '' && keyEventsKo.length === 0.
    if (result.currentDriverKo === '' && result.keyEventsKo.length === 0) {
        console.warn(LOG_TAG, 'Empty digest; raw payload likely malformed', {
            jobId,
        });
    }

    // Cache the normalized result if a pre-computed cache key is available.
    if (meta?.cacheKey) {
        const cache = createCacheProvider();
        if (cache !== null) {
            fireAndForget(
                cache
                    .set(meta.cacheKey, result, NEWS_CACHE_TTL_SECONDS)
                    .catch(error =>
                        console.error(LOG_TAG, 'Cache write failed:', error)
                    ),
                options
            );
        }
    }

    cleanupInBackground(jobId, LOG_TAG, options);

    return { status: 'done', result };
}
