import { cleanupInBackground, fireAndForget } from '@/application/background';
import type { BackgroundTaskOptions } from '@/application/types';
import type { PollNewsCardAnalysisResult } from '@/application/news/types';
import { normalizeNewsCardAnalysis } from '@/domain/analysis/normalizeNews';
import type { NewsCardAnalysis } from '@/domain/types';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { NEWS_CARD_CACHE_TTL_SECONDS } from '@/infrastructure/cache/config';
import {
    getJobError,
    getJobMeta,
    getJobResult,
    getJobStatus,
} from '@/infrastructure/jobs/queue';

/**
 * Poll the result of a per-card news analysis job submitted via
 * {@link submitNewsCardAnalysis}.
 *
 * Returns one of three outcomes:
 * - `processing`: the worker has not finished yet. Caller should retry.
 * - `error`: the worker reported a failure, the result was missing, or the
 *   payload could not be normalized.
 * - `done`: the result is ready. The raw worker response is normalized via
 *   {@link normalizeNewsCardAnalysis} and permanently cached under the
 *   pre-computed `cacheKey` from job metadata (TTL: 30 days) before being
 *   returned.
 *
 * On `error` and `done`, the job's Redis state is cleaned up via `cleanupJob`
 * (best-effort — cleanup failures are logged but do not affect the return value).
 *
 * **Empty-response handling:** this function does not skip the cache write when
 * the worker returns a sparse result. News-card analysis lacks a canonical
 * fallback sentinel shape, so a reliable empty-detection predicate cannot be
 * defined without risking false positives on legitimately sparse responses.
 * Malformed payloads are handled upstream: {@link normalizeNewsCardAnalysis}
 * throws, transitioning the job to the `error` path before any cache write
 * occurs. A `console.warn` is emitted when heuristic empty-field checks fire.
 *
 * Cancel-after-poll: a successful {@link cancelNewsAnalysisJob} call does
 * NOT immediately flip the job status. This function will keep returning
 * `processing` until the worker observes the cancel signal on its next
 * `isJobCancelled` check and self-transitions. Bound your retry loop with
 * a caller-side timeout to avoid polling indefinitely against a dead worker.
 *
 * @param jobId - The `jobId` returned by {@link submitNewsCardAnalysis}.
 * @param options - Optional background-task hooks. Pass Vercel's `waitUntil`
 *   so Redis cleanup and cache writes can continue after the response.
 * @returns The current poll outcome — see {@link PollNewsCardAnalysisResult}.
 *
 * @example
 * ```ts
 * const result = await pollNewsCardAnalysis(jobId);
 * if (result.status === 'processing') scheduleRetry();
 * else if (result.status === 'error') showError(result.error);
 * else renderCard(result.result);
 * ```
 *
 * @see submitNewsCardAnalysis
 * @see cancelNewsAnalysisJob
 */
export async function pollNewsCardAnalysis(
    jobId: string,
    options?: BackgroundTaskOptions
): Promise<PollNewsCardAnalysisResult> {
    const status = await getJobStatus(jobId);

    if (status === null || status === 'processing') {
        return { status: 'processing' };
    }

    if (status === 'error') {
        const error = await getJobError(jobId);
        cleanupInBackground(jobId, '[PollNewsCard]', options);
        return { status: 'error', error: error ?? 'Unknown error' };
    }

    // status === 'done'
    const [rawResult, meta] = await Promise.all([
        getJobResult(jobId),
        getJobMeta(jobId),
    ]);

    if (!rawResult) {
        console.error('[PollNewsCard] Result not found', {
            jobId,
            hasMeta: meta !== null,
            symbol: meta?.symbol,
        });
        cleanupInBackground(jobId, '[PollNewsCard]', options);
        return { status: 'error', error: 'Result not found' };
    }

    // Normalize the raw LLM response through the news-card normalizer.
    let result: NewsCardAnalysis;
    try {
        result = normalizeNewsCardAnalysis(rawResult);
    } catch (error) {
        console.error('[PollNewsCard] Normalization failed:', error);
        cleanupInBackground(jobId, '[PollNewsCard]', options);
        return { status: 'error', error: 'Invalid response from worker' };
    }

    if (result.titleKo === '' && result.summaryKo === '') {
        console.warn('[PollNewsCard] Empty news card analysis', { jobId });
    }

    // Permanently cache the result if a pre-computed cache key is available.
    if (meta?.cacheKey) {
        const cache = createCacheProvider();
        if (cache !== null) {
            fireAndForget(
                cache
                    .set(meta.cacheKey, result, NEWS_CARD_CACHE_TTL_SECONDS)
                    .catch(error =>
                        console.error(
                            '[PollNewsCard] Cache write failed:',
                            error
                        )
                    ),
                options
            );
        }
    }

    cleanupInBackground(jobId, '[PollNewsCard]', options);

    return { status: 'done', result };
}
