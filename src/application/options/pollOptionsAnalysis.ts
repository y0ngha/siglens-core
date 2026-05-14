import { cleanupInBackground, fireAndForget } from '@/application/background';
import type { BackgroundTaskOptions } from '@/application/types';
import type { PollOptionsAnalysisResult } from '@/application/options/types';
import { normalizeOptionsAnalysisResponse } from '@/domain/analysis/normalizeOptions';
import type { OptionsAnalysisResponse } from '@/domain/types';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { OPTIONS_CACHE_TTL_SECONDS } from '@/infrastructure/cache/config';
import {
    getJobError,
    getJobMeta,
    getJobResult,
    getJobStatus,
} from '@/infrastructure/jobs/queue';

/**
 * Poll the result of an options analysis job submitted via
 * {@link submitOptionsAnalysis}.
 *
 * Returns one of three outcomes:
 * - `processing`: the worker has not finished yet. Caller should retry.
 * - `error`: the worker reported a failure, the result was missing, or the
 *   payload could not be normalized.
 * - `done`: the result is ready. The raw worker response is normalized via
 *   {@link normalizeOptionsAnalysisResponse} and cached under the pre-computed
 *   `cacheKey` from job metadata before being returned.
 *
 * On `error` and `done`, the job's Redis state is cleaned up via `cleanupJob`
 * (best-effort — cleanup failures are logged but do not affect the return value).
 *
 * **Empty-response handling:** this function does not skip the cache write when
 * the worker returns a sparse result. {@link normalizeOptionsAnalysisResponse}
 * never throws — every field has a fallback. A `console.warn` is emitted when
 * heuristic empty-field checks fire (summary blank, no expirations, no signals).
 *
 * Cancel-after-poll: a successful {@link cancelOptionsAnalysisJob} call does
 * NOT immediately flip the job status. This function will keep returning
 * `processing` until the worker observes the cancel signal on its next
 * `isJobCancelled` check and self-transitions. Bound your retry loop with
 * a caller-side timeout to avoid polling indefinitely against a dead worker.
 *
 * @param jobId - The `jobId` returned by {@link submitOptionsAnalysis}.
 * @param options - Optional background-task hooks. Pass Vercel's `waitUntil`
 *   so Redis cleanup and cache writes can continue after the response.
 * @returns The current poll outcome — see {@link PollOptionsAnalysisResult}.
 *
 * @example
 * ```ts
 * const result = await pollOptionsAnalysis(jobId);
 * if (result.status === 'processing') scheduleRetry();
 * else if (result.status === 'error') showError(result.error);
 * else renderOptions(result.result);
 * ```
 *
 * @see submitOptionsAnalysis
 */
export async function pollOptionsAnalysis(
    jobId: string,
    options?: BackgroundTaskOptions
): Promise<PollOptionsAnalysisResult> {
    const status = await getJobStatus(jobId);

    if (status === null || status === 'processing') {
        return { status: 'processing' };
    }

    if (status === 'error') {
        const error = await getJobError(jobId);
        cleanupInBackground(jobId, '[PollOptions]', options);
        return { status: 'error', error: error ?? 'Unknown error' };
    }

    // status === 'done'
    const [rawResult, meta] = await Promise.all([
        getJobResult(jobId),
        getJobMeta(jobId),
    ]);

    if (!rawResult) {
        console.error('[PollOptions] Result not found', {
            jobId,
            hasMeta: meta !== null,
            symbol: meta?.symbol,
        });
        cleanupInBackground(jobId, '[PollOptions]', options);
        return { status: 'error', error: 'Result not found' };
    }

    // The worker stores the raw LLM response as a JSON string or object.
    // Normalize it through the options response normalizer.
    // normalizeOptionsAnalysisResponse never throws — every field has a fallback.
    const result: OptionsAnalysisResponse =
        normalizeOptionsAnalysisResponse(rawResult);

    if (
        result.summary === '' &&
        result.perExpiration.length === 0 &&
        result.signals.length === 0
    ) {
        console.warn('[PollOptions] Empty options analysis', { jobId });
    }

    // Cache the normalized result if a pre-computed cache key is available.
    if (meta?.cacheKey) {
        const cache = createCacheProvider();
        if (cache !== null) {
            fireAndForget(
                cache
                    .set(meta.cacheKey, result, OPTIONS_CACHE_TTL_SECONDS)
                    .catch(error =>
                        console.error(
                            '[PollOptions] Cache write failed:',
                            error
                        )
                    ),
                options
            );
        }
    }

    cleanupInBackground(jobId, '[PollOptions]', options);

    return { status: 'done', result };
}
