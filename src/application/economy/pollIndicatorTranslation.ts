import { cleanupInBackground, fireAndForget } from '@/application/background';
import type { BackgroundTaskOptions } from '@/application/types';
import { normalizeIndicatorTranslation } from '@/domain/economy/normalizeIndicatorTranslation';
import type { PollIndicatorTranslationResult } from './types';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { INDICATOR_TRANSLATION_CACHE_TTL } from '@/infrastructure/cache/config';
import {
    getJobError,
    getJobMeta,
    getJobResult,
    getJobStatus,
} from '@/infrastructure/jobs/queue';

/**
 * Poll the result of an indicator-name translation job submitted via
 * {@link submitIndicatorTranslation}.
 *
 * Returns one of three outcomes:
 * - `processing`: the worker has not finished yet. Caller should retry.
 * - `error`: the worker reported a failure, the result was missing, or the
 *   payload could not be normalized.
 * - `done`: the translation is ready. The raw worker response is normalized
 *   via {@link normalizeIndicatorTranslation}, written to cache under the key
 *   stored in job meta at submit time, and returned as `{ status: 'done', nameKo }`.
 *   An empty `nameKo` (`''`) signals that the LLM returned garbage — callers
 *   should fall back to the original English name.
 *
 * On every terminal outcome (`done` or `error`) the job is cleaned up
 * (best-effort — cleanup failures are logged but do not affect the return value).
 *
 * @param jobId - Job identifier returned by {@link submitIndicatorTranslation}.
 * @param options - Optional background-task lifecycle hooks for edge runtimes —
 *   used to let cache writes and job cleanup outlive the response.
 * @returns Current job state — see {@link PollIndicatorTranslationResult}.
 *
 * @example
 * ```ts
 * let polled = await pollIndicatorTranslation(jobId);
 * while (polled.status === 'processing') {
 *     await new Promise(r => setTimeout(r, 1000));
 *     polled = await pollIndicatorTranslation(jobId);
 * }
 * ```
 *
 * @see submitIndicatorTranslation
 */
export async function pollIndicatorTranslation(
    jobId: string,
    options?: BackgroundTaskOptions
): Promise<PollIndicatorTranslationResult> {
    const status = await getJobStatus(jobId);

    if (status === null || status === 'processing') {
        return { status: 'processing' };
    }

    if (status === 'error') {
        const error = await getJobError(jobId);
        cleanupInBackground(jobId, '[IndicatorTranslation/Poll]', options);
        return { status: 'error', error: error ?? 'Unknown error' };
    }

    // status === 'done'
    const [raw, meta] = await Promise.all([
        getJobResult(jobId),
        getJobMeta(jobId),
    ]);

    if (!raw) {
        cleanupInBackground(jobId, '[IndicatorTranslation/Poll]', options);
        return { status: 'error', error: 'Result not found' };
    }

    const nameKo: string = normalizeIndicatorTranslation(raw);

    const cacheKey = meta?.cacheKey;
    const cache = createCacheProvider();
    // Truthy check covers both `undefined` (no meta) and `''` (blank key guard).
    if (!cacheKey) {
        console.warn(
            '[IndicatorTranslation/Poll] meta cacheKey missing — skipping cache write'
        );
    } else if (cache !== null) {
        // Cache the result as { nameKo } so that normalizeIndicatorTranslation
        // in the submit cache-hit path can parse it with the same logic used
        // for raw LLM responses — no special-casing of bare strings needed.
        fireAndForget(
            cache
                .set(cacheKey, { nameKo }, INDICATOR_TRANSLATION_CACHE_TTL)
                .catch(err =>
                    console.error(
                        '[IndicatorTranslation/Poll] Cache write failed:',
                        err
                    )
                ),
            options
        );
    }

    cleanupInBackground(jobId, '[IndicatorTranslation/Poll]', options);
    return { status: 'done', nameKo };
}
