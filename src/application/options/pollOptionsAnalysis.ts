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

const LOG_PREFIX = '[PollOptions]';

/**
 * Poll the result of an options analysis job submitted via
 * {@link submitOptionsAnalysis}.
 *
 * Returns one of three outcomes:
 * - `processing`: the worker has not finished yet. Caller should retry.
 * - `error`: the worker reported a failure status, or the job result was
 *   missing from the store ("Result not found"). Normalization failures
 *   never produce `error` — every malformed payload falls back to a valid
 *   {@link OptionsAnalysisResponse} via {@link normalizeOptionsAnalysisResponse}.
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
 * Options analysis intentionally does not expose a `cancel` use-case. The
 * submit/poll lifecycle is bounded by the worker timeout, and the front-end
 * pageHide flow cleans the Redis job state on its own; adding a cancel
 * surface would be YAGNI for the current consumers.
 *
 * @param jobId - The `jobId` returned by {@link submitOptionsAnalysis}.
 * @param options - Optional background-task hooks. Pass Vercel's `waitUntil`
 *   so Redis cleanup and cache writes can continue after the response.
 * @param now - Reference timestamp injected into the normalizer's
 *   `analyzedAt` fallback. Defaults to `new Date()`.
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
    options?: BackgroundTaskOptions,
    now?: Date
): Promise<PollOptionsAnalysisResult> {
    const status = await getJobStatus(jobId);

    if (status === null || status === 'processing') {
        return { status: 'processing' };
    }

    if (status === 'error') {
        const error = await getJobError(jobId);
        cleanupInBackground(jobId, LOG_PREFIX, options);
        return { status: 'error', error: error ?? 'Unknown error' };
    }

    // status === 'done'
    const [rawResult, meta] = await Promise.all([
        getJobResult(jobId),
        getJobMeta(jobId),
    ]);

    if (rawResult === null) {
        console.error(`${LOG_PREFIX} Result not found`, {
            jobId,
            hasMeta: meta !== null,
            symbol: meta?.symbol,
        });
        cleanupInBackground(jobId, LOG_PREFIX, options);
        return { status: 'error', error: 'Result not found' };
    }

    // The worker stores the raw LLM response as a JSON string or object.
    // Normalize it through the options response normalizer.
    // normalizeOptionsAnalysisResponse never throws — every field has a fallback.
    const result: OptionsAnalysisResponse = normalizeOptionsAnalysisResponse(
        rawResult,
        now ?? new Date()
    );

    if (
        result.summary === '' &&
        result.perExpiration.length === 0 &&
        result.signals.length === 0
    ) {
        console.warn(`${LOG_PREFIX} Empty options analysis`, { jobId });
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
                            `${LOG_PREFIX} Cache write failed:`,
                            error
                        )
                    ),
                options
            );
        }
    }

    cleanupInBackground(jobId, LOG_PREFIX, options);

    return { status: 'done', result };
}
