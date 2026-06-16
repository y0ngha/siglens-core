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

function tryNormalizeNews(
    raw: unknown
): { ok: true; result: NewsAnalysisResponse } | { ok: false; error: unknown } {
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
 * - `done`: the result is ready. The raw worker response is normalized via
 *   {@link normalizeNewsAnalysisResponse} and cached under the pre-computed
 *   `cacheKey` from job metadata before being returned.
 *
 * Mirrors {@link pollNewsAnalysis}, adapted to the category-digest context
 * (no symbol in log messages; no per-company fallback sentinel). Unlike
 * {@link pollNewsAnalysis}, an empty or sparse digest result is still cached —
 * do not add an empty-skip guard here; the warn log at line ~79 is intentional.
 *
 * @param jobId   - The `jobId` returned by {@link submitMarketNewsDigest}.
 * @param options - Optional background-task hooks.
 * @returns The current poll outcome — see {@link PollMarketNewsDigestResult}.
 *
 * @see submitMarketNewsDigest
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
        cleanupInBackground(jobId, '[PollMarketNewsDigest]', options);
        return { status: 'error', error: error ?? 'Unknown error' };
    }

    // status === 'done'
    const [rawResult, meta] = await Promise.all([
        getJobResult(jobId),
        getJobMeta(jobId),
    ]);

    if (!rawResult) {
        console.error('[PollMarketNewsDigest] Result not found', {
            jobId,
            hasMeta: meta !== null,
            // `symbol` carries the category string (see submitMarketNewsDigest).
            category: meta?.symbol,
        });
        cleanupInBackground(jobId, '[PollMarketNewsDigest]', options);
        return { status: 'error', error: 'Result not found' };
    }

    // Normalize the raw LLM response through the shared news response normalizer.
    const normalized = tryNormalizeNews(rawResult);
    if (!normalized.ok) {
        console.error(
            '[PollMarketNewsDigest] Normalization failed:',
            normalized.error
        );
        cleanupInBackground(jobId, '[PollMarketNewsDigest]', options);
        return { status: 'error', error: 'Invalid response from worker' };
    }
    const result = normalized.result;

    if (result.currentDriverKo === '' && result.keyEventsKo.length === 0) {
        console.warn(
            '[PollMarketNewsDigest] Empty digest; raw payload likely malformed',
            { jobId }
        );
    }

    // Cache the normalized result if a pre-computed cache key is available.
    if (meta?.cacheKey) {
        const cache = createCacheProvider();
        if (cache !== null) {
            fireAndForget(
                cache
                    .set(meta.cacheKey, result, NEWS_CACHE_TTL_SECONDS)
                    .catch(error =>
                        console.error(
                            '[PollMarketNewsDigest] Cache write failed:',
                            error
                        )
                    ),
                options
            );
        }
    }

    cleanupInBackground(jobId, '[PollMarketNewsDigest]', options);

    return { status: 'done', result };
}
