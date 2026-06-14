import { cleanupInBackground, fireAndForget } from '@/application/background';
import type { BackgroundTaskOptions } from '@/application/types';
import type { PollFinancialsAnalysisResult } from '@/application/financials/types';
import { normalizeFinancialsAnalysisResponse } from '@/domain/analysis/normalizeFinancials';
import type { FinancialsAnalysisResponse } from '@/domain/types';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { FINANCIALS_CACHE_TTL_SECONDS } from '@/infrastructure/cache/config';
import {
    getJobError,
    getJobMeta,
    getJobResult,
    getJobStatus,
} from '@/infrastructure/jobs/queue';

/**
 * Poll the result of a financials analysis job submitted via
 * {@link submitFinancialsAnalysis}.
 *
 * Returns one of three outcomes:
 * - `processing`: the worker has not finished yet. Caller should retry.
 * - `error`: the worker reported a failure, the result was missing, or the
 *   payload could not be normalized.
 * - `done`: the result is ready. The raw worker response is normalized via
 *   {@link normalizeFinancialsAnalysisResponse} and cached under the
 *   pre-computed `cacheKey` from job metadata before being returned.
 *
 * On `error` and `done`, the job's Redis state is cleaned up via `cleanupJob`
 * (best-effort — cleanup failures are logged but do not affect the return value).
 *
 * **Empty-response handling:** unlike {@link pollAnalysis}, this function does
 * not skip the cache write when the worker returns a sparse or empty result.
 * Financials analysis lacks a stable sentinel shape (no canonical fallback
 * string + all-empty-arrays invariant), so a reliable "is this a fallback?"
 * predicate cannot be defined without risking false positives on legitimately
 * sparse results. There are two distinct empty-payload scenarios:
 * - **Structurally malformed** (unparseable JSON or wrong field types):
 *   {@link normalizeFinancialsAnalysisResponse} throws → job transitions to
 *   the `error` path before any cache write occurs.
 * - **Content-empty** (valid JSON that normalises to empty strings / empty
 *   arrays, e.g. `{}`): normalization succeeds, the heuristic check below
 *   emits a `console.warn`, and the result is still cached and returned as
 *   `done` so the caller can surface it to the user.
 *
 * Cancel-after-poll: a successful {@link cancelFinancialsAnalysisJob} call
 * does NOT immediately flip the job status. This function will keep
 * returning `processing` until the worker observes the cancel signal on
 * its next `isJobCancelled` check and self-transitions. Bound your retry
 * loop with a caller-side timeout to avoid polling indefinitely against a
 * dead worker.
 *
 * @param jobId - The `jobId` returned by {@link submitFinancialsAnalysis}.
 * @param options - Optional background-task hooks. Pass Vercel's `waitUntil`
 *   so Redis cleanup and cache writes can continue after the response.
 * @returns The current poll outcome — see {@link PollFinancialsAnalysisResult}.
 *
 * @example
 * ```ts
 * const result = await pollFinancialsAnalysis(jobId);
 * if (result.status === 'processing') scheduleRetry();
 * else if (result.status === 'error') showError(result.error);
 * else renderFinancials(result.result);
 * ```
 *
 * @see submitFinancialsAnalysis
 * @see cancelFinancialsAnalysisJob
 */
export async function pollFinancialsAnalysis(
    jobId: string,
    options?: BackgroundTaskOptions
): Promise<PollFinancialsAnalysisResult> {
    const status = await getJobStatus(jobId);

    if (status === null || status === 'processing') {
        return { status: 'processing' };
    }

    if (status === 'error') {
        const error = await getJobError(jobId);
        cleanupInBackground(jobId, '[PollFinancials]', options);
        return { status: 'error', error: error ?? 'Unknown error' };
    }

    // status === 'done'
    const [rawResult, meta] = await Promise.all([
        getJobResult(jobId),
        getJobMeta(jobId),
    ]);

    if (!rawResult) {
        console.error('[PollFinancials] Result not found', {
            jobId,
            hasMeta: meta !== null,
            symbol: meta?.symbol,
        });
        cleanupInBackground(jobId, '[PollFinancials]', options);
        return { status: 'error', error: 'Result not found' };
    }

    // The worker stores the raw LLM response as a JSON string or object.
    // Normalize it through the financials response normalizer.
    let result: FinancialsAnalysisResponse;
    try {
        result = normalizeFinancialsAnalysisResponse(rawResult);
    } catch (error) {
        console.error('[PollFinancials] Normalization failed:', error);
        cleanupInBackground(jobId, '[PollFinancials]', options);
        return { status: 'error', error: 'Invalid response from worker' };
    }

    if (
        result.overallConclusionKo === '' &&
        result.axisAssessments.length === 0
    ) {
        console.warn('[PollFinancials] Empty financials analysis', { jobId });
    }

    // Cache the normalized result if a pre-computed cache key is available.
    if (meta?.cacheKey) {
        const cache = createCacheProvider();
        if (cache !== null) {
            fireAndForget(
                cache
                    .set(meta.cacheKey, result, FINANCIALS_CACHE_TTL_SECONDS)
                    .catch(error =>
                        console.error(
                            '[PollFinancials] Cache write failed:',
                            error
                        )
                    ),
                options
            );
        }
    }

    cleanupInBackground(jobId, '[PollFinancials]', options);

    return { status: 'done', result };
}
