import { cleanupInBackground, fireAndForget } from '@/application/background';
import type { BackgroundTaskOptions } from '@/application/types';
import { normalizeEconomicEventAnalysis } from '@/domain/economy/normalizeEconomicEventAnalysis';
import type { EconomicEventAnalysis } from '@/domain/economy/types';
import type { PollEconomicEventAnalysisResult } from './types';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { ECONOMIC_EVENT_CACHE_TTL } from '@/infrastructure/cache/config';
import {
    getJobError,
    getJobMeta,
    getJobResult,
    getJobStatus,
} from '@/infrastructure/jobs/queue';

/**
 * Poll the result of an economic-event analysis job submitted via
 * {@link submitEconomicEventAnalysis}.
 *
 * Returns one of three outcomes:
 * - `processing`: the worker has not finished yet. Caller should retry.
 * - `error`: the worker reported a failure, the result was missing, or the
 *   payload could not be normalized.
 * - `done`: the result is ready. The raw worker response is normalized via
 *   {@link normalizeEconomicEventAnalysis}, written to cache under the key
 *   stored in job meta at submit time, and returned.
 *
 * On every terminal outcome (`done` or `error`) the job is cleaned up
 * (best-effort — cleanup failures are logged but do not affect the return value).
 *
 * @param jobId - Job identifier returned by {@link submitEconomicEventAnalysis}.
 * @param options - Optional background-task lifecycle hooks for edge runtimes —
 *   used to let cache writes and job cleanup outlive the response.
 * @returns Current job state — see {@link PollEconomicEventAnalysisResult}.
 *
 * @example
 * ```ts
 * let polled = await pollEconomicEventAnalysis(jobId);
 * while (polled.status === 'processing') {
 *     await new Promise(r => setTimeout(r, 1000));
 *     polled = await pollEconomicEventAnalysis(jobId);
 * }
 * ```
 *
 * @see submitEconomicEventAnalysis
 */
export async function pollEconomicEventAnalysis(
    jobId: string,
    options?: BackgroundTaskOptions
): Promise<PollEconomicEventAnalysisResult> {
    const status = await getJobStatus(jobId);

    if (status === null || status === 'processing') {
        return { status: 'processing' };
    }

    if (status === 'error') {
        const error = await getJobError(jobId);
        cleanupInBackground(jobId, '[EconomicEventAnalysis/Poll]', options);
        return { status: 'error', error: error ?? 'Unknown error' };
    }

    // status === 'done'
    const [raw, meta] = await Promise.all([
        getJobResult(jobId),
        getJobMeta(jobId),
    ]);

    if (!raw) {
        cleanupInBackground(jobId, '[EconomicEventAnalysis/Poll]', options);
        return { status: 'error', error: 'Result not found' };
    }

    const result: EconomicEventAnalysis = normalizeEconomicEventAnalysis(raw);

    const cacheKey = meta?.cacheKey;
    const cache = createCacheProvider();
    // Truthy check covers both `undefined` (no meta) and `''` (blank key guard).
    if (!cacheKey) {
        console.warn(
            '[EconomicEventAnalysis/Poll] meta cacheKey missing — skipping cache write'
        );
    } else if (cache !== null) {
        fireAndForget(
            cache
                .set(cacheKey, result, ECONOMIC_EVENT_CACHE_TTL)
                .catch(err =>
                    console.error(
                        '[EconomicEventAnalysis/Poll] Cache write failed:',
                        err
                    )
                ),
            options
        );
    }

    cleanupInBackground(jobId, '[EconomicEventAnalysis/Poll]', options);
    return { status: 'done', result };
}
