import { cleanupInBackground, fireAndForget } from '@/application/background';
import type { BackgroundTaskOptions } from '@/application/types';
import type { PollFundamentalAnalysisResult } from '@/application/fundamental/types';
import { normalizeFundamentalAnalysisResponse } from '@/domain/analysis/normalizeFundamental';
import type { FundamentalAnalysisResponse } from '@/domain/types';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { FUNDAMENTAL_CACHE_TTL_SECONDS } from '@/infrastructure/cache/config';
import {
    getJobError,
    getJobMeta,
    getJobResult,
    getJobStatus,
} from '@/infrastructure/jobs/queue';

/**
 * Poll the result of a fundamental analysis job submitted via
 * {@link submitFundamentalAnalysis}.
 *
 * Returns one of three outcomes:
 * - `processing`: the worker has not finished yet. Caller should retry.
 * - `error`: the worker reported a failure, the result was missing, or the
 *   payload could not be normalized.
 * - `done`: the result is ready. The raw worker response is normalized via
 *   {@link normalizeFundamentalAnalysisResponse} and cached under the
 *   pre-computed `cacheKey` from job metadata before being returned.
 *
 * On `error` and `done`, the job's Redis state is cleaned up via `cleanupJob`
 * (best-effort — cleanup failures are logged but do not affect the return value).
 *
 * Cancel-after-poll: a successful {@link cancelFundamentalAnalysisJob} call
 * does NOT immediately flip the job status. This function will keep
 * returning `processing` until the worker observes the cancel signal on
 * its next `isJobCancelled` check and self-transitions. Bound your retry
 * loop with a caller-side timeout to avoid polling indefinitely against a
 * dead worker.
 *
 * @param jobId - The `jobId` returned by {@link submitFundamentalAnalysis}.
 * @param options - Optional background-task hooks. Pass Vercel's `waitUntil`
 *   so Redis cleanup and cache writes can continue after the response.
 * @returns The current poll outcome — see {@link PollFundamentalAnalysisResult}.
 *
 * @example
 * ```ts
 * const result = await pollFundamentalAnalysis(jobId);
 * if (result.status === 'processing') scheduleRetry();
 * else if (result.status === 'error') showError(result.error);
 * else renderFundamental(result.result);
 * ```
 *
 * @see submitFundamentalAnalysis
 * @see cancelFundamentalAnalysisJob
 */
export async function pollFundamentalAnalysis(
    jobId: string,
    options?: BackgroundTaskOptions
): Promise<PollFundamentalAnalysisResult> {
    const status = await getJobStatus(jobId);

    if (status === null || status === 'processing') {
        return { status: 'processing' };
    }

    if (status === 'error') {
        const error = await getJobError(jobId);
        cleanupInBackground(jobId, '[PollFundamental]', options);
        return { status: 'error', error: error ?? 'Unknown error' };
    }

    // status === 'done'
    const [rawResult, meta] = await Promise.all([
        getJobResult(jobId),
        getJobMeta(jobId),
    ]);

    if (!rawResult) {
        console.error('[PollFundamental] Result not found', {
            jobId,
            hasMeta: meta !== null,
            symbol: meta?.symbol,
        });
        cleanupInBackground(jobId, '[PollFundamental]', options);
        return { status: 'error', error: 'Result not found' };
    }

    // The worker stores the raw LLM response as a JSON string or object.
    // Normalize it through the fundamental response normalizer.
    let result: FundamentalAnalysisResponse;
    try {
        const rawString =
            typeof rawResult === 'string'
                ? rawResult
                : JSON.stringify(rawResult);
        result = normalizeFundamentalAnalysisResponse(rawString);
    } catch (error) {
        console.error('[PollFundamental] Normalization failed:', error);
        cleanupInBackground(jobId, '[PollFundamental]', options);
        return { status: 'error', error: 'Invalid response from worker' };
    }

    // Cache the normalized result if a pre-computed cache key is available.
    if (meta?.cacheKey) {
        const cache = createCacheProvider();
        if (cache !== null) {
            fireAndForget(
                cache
                    .set(meta.cacheKey, result, FUNDAMENTAL_CACHE_TTL_SECONDS)
                    .catch(error =>
                        console.error(
                            '[PollFundamental] Cache write failed:',
                            error
                        )
                    ),
                options
            );
        }
    }

    cleanupInBackground(jobId, '[PollFundamental]', options);

    return { status: 'done', result };
}
