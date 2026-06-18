import { cleanupInBackground, fireAndForget } from '@/application/background';
import type { BackgroundTaskOptions } from '@/application/types';
import { normalizeMacroBriefing } from '@/domain/economy/normalizeMacroBriefing';
import type { MacroBriefingResponse } from '@/domain/types';
import type { PollMacroBriefingResult } from './types';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { MACRO_BRIEFING_CACHE_TTL } from '@/infrastructure/cache/config';
import {
    getJobError,
    getJobMeta,
    getJobResult,
    getJobStatus,
} from '@/infrastructure/jobs/queue';

/**
 * Poll the result of a macro briefing job submitted via {@link submitMacroBriefing}.
 *
 * Mirror of {@link pollBriefing}: `processing` while the worker runs, `error` on
 * missing/malformed result or worker failure, `done` with a normalized briefing.
 * The result is written under the same input-hashed cache key recorded in the
 * job meta at submit time; if the meta is absent (TTL expiry) the write is
 * skipped. On every terminal outcome the job is cleaned up (best-effort).
 *
 * @param jobId - Job identifier returned by {@link submitMacroBriefing}.
 * @param options - Optional background-task lifecycle hooks for edge runtimes —
 *   used to let cache writes and job cleanup outlive the response.
 * @returns Current job state: `processing` (worker not done), `error`
 *   (worker failure or missing/malformed result), or `done` with the
 *   normalized briefing and its ISO `generatedAt` timestamp.
 *
 * @example
 * ```ts
 * let polled = await pollMacroBriefing(jobId);
 * while (polled.status === 'processing') {
 *     await new Promise(r => setTimeout(r, 1000));
 *     polled = await pollMacroBriefing(jobId);
 * }
 * ```
 *
 * @see submitMacroBriefing
 */
export async function pollMacroBriefing(
    jobId: string,
    options?: BackgroundTaskOptions
): Promise<PollMacroBriefingResult> {
    const status = await getJobStatus(jobId);

    if (status === null || status === 'processing') {
        return { status: 'processing' };
    }

    if (status === 'error') {
        const error = await getJobError(jobId);
        cleanupInBackground(jobId, '[MacroBriefing/Poll]', options);
        return { status: 'error', error: error ?? 'Unknown error' };
    }

    // status === 'done'
    const [raw, meta] = await Promise.all([
        getJobResult(jobId),
        getJobMeta(jobId),
    ]);
    if (!raw) {
        cleanupInBackground(jobId, '[MacroBriefing/Poll]', options);
        return { status: 'error', error: 'Result not found' };
    }

    const briefing: MacroBriefingResponse = normalizeMacroBriefing(raw);

    if (!briefing.summary) {
        cleanupInBackground(jobId, '[MacroBriefing/Poll]', options);
        return { status: 'error', error: 'Invalid briefing result' };
    }

    const generatedAt = new Date().toISOString();

    const cacheKey = meta?.cacheKey;
    const cache = createCacheProvider();
    // Truthy check covers both `undefined` (no meta) and `''` (defensive — a blank
    // key would write to Redis under a real but useless slot).
    if (!cacheKey) {
        console.warn(
            '[MacroBriefing/Poll] meta cacheKey missing — skipping cache write'
        );
    } else if (cache !== null) {
        fireAndForget(
            cache
                .set(
                    cacheKey,
                    { briefing, generatedAt },
                    MACRO_BRIEFING_CACHE_TTL
                )
                .catch(err =>
                    console.error(
                        '[MacroBriefing/Poll] Cache write failed:',
                        err
                    )
                ),
            options
        );
    }

    cleanupInBackground(jobId, '[MacroBriefing/Poll]', options);
    return { status: 'done', briefing, generatedAt };
}
