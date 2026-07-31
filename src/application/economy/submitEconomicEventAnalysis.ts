import { fireAndForget } from '@/application/background';
import { dispatchWorkerJob } from '@/application/workerDispatch';
import type { BackgroundTaskOptions } from '@/application/types';
import { GEMINI_2_5_FLASH_LITE_MODEL } from '@/application/chat/constants';
import { buildEconomicEventAnalysisPrompt } from '@/domain/economy/economicEventPrompt';
import { normalizeEconomicEventAnalysis } from '@/domain/economy/normalizeEconomicEventAnalysis';
import type { EconomicEventAnalysisInput } from '@/domain/economy/types';
import type { SubmitEconomicEventAnalysisResult } from './types';
import { buildEconomicEventCacheKey } from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import {
    analysisSeed,
    hashAnalysisInput,
} from '@/infrastructure/hash/analysisInput';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { readWorkerConfig } from '@/infrastructure/market/config';
import { FETCH_DEFAULT_TIME_OUT } from '@/infrastructure/market/constants';

/** Stable job-meta `symbol` marker for economic-event analysis jobs (not symbol-bound). */
const ECONOMIC_EVENT_JOB_SYMBOL = 'economic-event';

/**
 * @internal Fixed model identifier for economic-event analysis.
 *
 * A short structured classification task (sentiment + two Korean sentences):
 * flash-lite is the right cost/latency trade-off, mirroring news-card analysis.
 * Aliased from the shared {@link GEMINI_2_5_FLASH_LITE_MODEL} constant so all
 * flash-lite consumers stay in sync via a single source of truth.
 */
export const ECONOMIC_EVENT_MODEL_ID = GEMINI_2_5_FLASH_LITE_MODEL;

/**
 * Build a deterministic hash of the economic-event input for cache-key use.
 *
 * Serializes all fields that affect the prompt output so different events or
 * different announced figures always hash to a different key.
 *
 * @internal
 */
function hashEconomicEventInput(input: EconomicEventAnalysisInput): string {
    return hashAnalysisInput(
        JSON.stringify({
            event: input.event,
            impact: input.impact,
            actual: input.actual,
            estimate: input.estimate,
            previous: input.previous,
            unit: input.unit,
        })
    );
}

/**
 * Submit an economic-event AI analysis job.
 *
 * Checks the Redis cache first: a HIT returns the cached analysis immediately
 * (`status: 'cached'`). A MISS builds the prompt, enqueues a worker job via
 * fire-and-forget POST to `${workerUrl}/analyze`, and returns
 * `{ status: 'submitted', jobId }`.
 *
 * The cache key is deterministic per (event identity + announced figures +
 * prompt-template version) so the same release always hits the same cache
 * entry, and a prompt-template update (version bump) automatically misses.
 *
 * @param input - The announced economic event data to analyse.
 * @param options - Optional background-task lifecycle hooks for edge runtimes —
 *   used to let the fire-and-forget worker dispatch outlive the response.
 * @returns A cached analysis or a freshly submitted job descriptor.
 * @throws {Error} If `WORKER_URL` / `WORKER_SECRET` are missing in env.
 *
 * @example
 * ```ts
 * const res = await submitEconomicEventAnalysis(input);
 * if (res.status === 'submitted') {
 *     const polled = await pollEconomicEventAnalysis(res.jobId);
 * }
 * ```
 *
 * @see pollEconomicEventAnalysis
 */
export async function submitEconomicEventAnalysis(
    input: EconomicEventAnalysisInput,
    options?: BackgroundTaskOptions
): Promise<SubmitEconomicEventAnalysisResult> {
    const inputHash = hashEconomicEventInput(input);
    const cacheKey = buildEconomicEventCacheKey(inputHash);

    const cache = createCacheProvider();
    if (cache !== null) {
        try {
            const cached = await cache.get<unknown>(cacheKey);
            if (cached !== null) {
                // Cache stores the raw analysis result — normalize defensively on read.
                return {
                    status: 'cached',
                    result: normalizeEconomicEventAnalysis(cached),
                };
            }
        } catch (error) {
            console.error(
                '[EconomicEventAnalysis/Submit] Cache read failed:',
                error
            );
        }
    }

    const { workerUrl, workerSecret } = readWorkerConfig();
    // This builder has no skills catalog and no separate system prompt (the
    // role framing lives in `dynamic` itself) — `stable` is always '' (spec
    // §3.2/Design C), so there is nothing to fold; `prompt` is `dynamic` alone.
    const { dynamic } = buildEconomicEventAnalysisPrompt(input);
    const prompt = dynamic;
    const jobId = crypto.randomUUID();

    // Persist the cache key in job meta so pollEconomicEventAnalysis writes the
    // result under the SAME key the submit path looked up. Best-effort: a
    // meta-store failure must never block job submission.
    try {
        await setJobMeta(jobId, {
            symbol: ECONOMIC_EVENT_JOB_SYMBOL,
            cacheKey,
        });
    } catch (error) {
        console.error(
            '[EconomicEventAnalysis/Submit] Failed to store job meta:',
            error
        );
    }

    const dispatch = dispatchWorkerJob(
        `${workerUrl}/analyze`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Worker-Secret': workerSecret,
            },
            body: JSON.stringify({
                jobId,
                prompt,
                model: ECONOMIC_EVENT_MODEL_ID,
                seed: analysisSeed(prompt),
            }),
            signal: AbortSignal.timeout(FETCH_DEFAULT_TIME_OUT),
        },
        jobId,
        '[EconomicEventAnalysis/Submit]'
    );
    fireAndForget(dispatch, options);

    return { status: 'submitted', jobId };
}
