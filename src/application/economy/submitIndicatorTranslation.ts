import { fireAndForget } from '@/application/background';
import type { BackgroundTaskOptions } from '@/application/types';
import { buildIndicatorTranslationPrompt } from '@/domain/economy/indicatorTranslationPrompt';
import { normalizeIndicatorTranslation } from '@/domain/economy/normalizeIndicatorTranslation';
import type { SubmitIndicatorTranslationResult } from './types';
import { buildIndicatorTranslationCacheKey } from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import {
    analysisSeed,
    hashAnalysisInput,
} from '@/infrastructure/hash/analysisInput';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { readWorkerConfig } from '@/infrastructure/market/config';
import { FETCH_DEFAULT_TIME_OUT } from '@/infrastructure/market/constants';

/** Stable job-meta `symbol` marker for indicator translation jobs (not symbol-bound). */
const INDICATOR_TRANSLATION_JOB_SYMBOL = 'indicator-translation';

/**
 * @internal Fixed model identifier for indicator name translation.
 *
 * Translation is a short one-field task (single Korean string): flash-lite
 * is the right cost/latency trade-off, mirroring economic-event analysis.
 */
export const INDICATOR_TRANSLATION_MODEL_ID = 'gemini-2.5-flash-lite' as const;

/**
 * Submit an indicator-name AI translation job.
 *
 * Checks the Redis cache first: a HIT returns the cached Korean name
 * immediately (`status: 'cached'`). A MISS builds the prompt, enqueues a
 * worker job via fire-and-forget POST to `${workerUrl}/analyze`, and returns
 * `{ status: 'submitted', jobId }`.
 *
 * The cache key is deterministic per (normalizedName + prompt-template
 * version) so the same indicator name always hits the same cache entry, and
 * a prompt-template update (version bump) automatically misses.
 *
 * @param normalizedName - English economic-indicator base name to translate
 *   (e.g. `"Core PCE Price Index YoY"`).
 * @param options - Optional background-task lifecycle hooks for edge runtimes —
 *   used to let the fire-and-forget worker dispatch outlive the response.
 * @returns A cached translation or a freshly submitted job descriptor.
 * @throws {Error} If `WORKER_URL` / `WORKER_SECRET` are missing in env.
 *
 * @example
 * ```ts
 * const res = await submitIndicatorTranslation('Unemployment Claims');
 * if (res.status === 'submitted') {
 *     const polled = await pollIndicatorTranslation(res.jobId);
 * }
 * ```
 *
 * @see pollIndicatorTranslation
 */
export async function submitIndicatorTranslation(
    normalizedName: string,
    options?: BackgroundTaskOptions
): Promise<SubmitIndicatorTranslationResult> {
    const nameHash = hashAnalysisInput(normalizedName);
    const cacheKey = buildIndicatorTranslationCacheKey(nameHash);

    const cache = createCacheProvider();
    if (cache !== null) {
        try {
            const cached = await cache.get<unknown>(cacheKey);
            if (cached !== null) {
                // Cache stores the raw translation result — normalize defensively on read.
                return {
                    status: 'cached',
                    nameKo: normalizeIndicatorTranslation(cached),
                };
            }
        } catch (error) {
            console.error(
                '[IndicatorTranslation/Submit] Cache read failed:',
                error
            );
        }
    }

    const { workerUrl, workerSecret } = readWorkerConfig();
    const prompt = buildIndicatorTranslationPrompt(normalizedName);
    const jobId = crypto.randomUUID();

    // Persist the cache key in job meta so pollIndicatorTranslation writes the
    // result under the SAME key the submit path looked up. Best-effort: a
    // meta-store failure must never block job submission.
    try {
        await setJobMeta(jobId, {
            symbol: INDICATOR_TRANSLATION_JOB_SYMBOL,
            cacheKey,
        });
    } catch (error) {
        console.error(
            '[IndicatorTranslation/Submit] Failed to store job meta:',
            error
        );
    }

    const dispatch = fetch(`${workerUrl}/analyze`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Worker-Secret': workerSecret,
        },
        body: JSON.stringify({
            jobId,
            prompt,
            model: INDICATOR_TRANSLATION_MODEL_ID,
            seed: analysisSeed(prompt),
        }),
        signal: AbortSignal.timeout(FETCH_DEFAULT_TIME_OUT),
    }).catch(error => {
        console.error(
            '[IndicatorTranslation/Submit] Worker request failed:',
            error
        );
    });
    fireAndForget(dispatch, options);

    return { status: 'submitted', jobId };
}
