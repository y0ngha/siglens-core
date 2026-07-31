import { fireAndForget } from '@/application/background';
import { dispatchWorkerJob } from '@/application/workerDispatch';
import type { BackgroundTaskOptions } from '@/application/types';
import { buildMacroBriefingPrompt } from '@/domain/economy/macroBriefingPrompt';
import { normalizeMacroBriefing } from '@/domain/economy/normalizeMacroBriefing';
import { ISO_DATE_HOUR_PREFIX_LENGTH } from '@/domain/constants/format';
import type { EconomySnapshot } from '@/domain/types';
import type { SubmitMacroBriefingResult } from './types';
import {
    BRIEFING_MODEL_ID,
    buildMacroBriefingCacheKey,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import type { CachedMacroBriefingData } from '@/infrastructure/cache/types';
import { analysisSeed } from '@/infrastructure/hash/analysisInput';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { readWorkerConfig } from '@/infrastructure/market/config';
import { FETCH_DEFAULT_TIME_OUT } from '@/infrastructure/market/constants';
import { hashMacroBriefingInput } from './macroBriefingInputHash';

/** Stable job-meta `symbol` marker for macro-briefing jobs (not symbol-bound). */
const MACRO_BRIEFING_JOB_SYMBOL = 'economy';

/**
 * Submit a macro (economy) briefing job from the current economy snapshot.
 *
 * Mirrors {@link submitBriefing} but for the `/economy` page: the cache is keyed
 * by ISO date+hour, the briefing model, and a deterministic hash of the
 * indicator/treasury/calendar snapshot, so identical-input callers within the
 * hour share the cached briefing while changed data produces a fresh job.
 * Reuses the generic worker `/briefing` endpoint and job queue.
 *
 * @param data - Economy snapshot (indicators + treasury + calendar).
 * @param options - Optional background-task lifecycle hooks for edge runtimes —
 *   used to let the fire-and-forget worker dispatch outlive the response.
 * @returns A cached briefing or a freshly submitted job descriptor.
 * @throws {Error} If `WORKER_URL` / `WORKER_SECRET` are missing in env.
 *
 * @example
 * ```ts
 * const result = await submitMacroBriefing(economySnapshot);
 * if (result.status === 'submitted') {
 *     const polled = await pollMacroBriefing(result.jobId);
 * }
 * ```
 *
 * @see pollMacroBriefing
 */
export async function submitMacroBriefing(
    data: EconomySnapshot,
    options?: BackgroundTaskOptions
): Promise<SubmitMacroBriefingResult> {
    const now = new Date();
    const dateHour = now.toISOString().slice(0, ISO_DATE_HOUR_PREFIX_LENGTH);
    const inputHash = hashMacroBriefingInput(data);
    const cacheKey = buildMacroBriefingCacheKey(
        dateHour,
        BRIEFING_MODEL_ID,
        inputHash
    );

    const cache = createCacheProvider();
    if (cache !== null) {
        try {
            const cached = await cache.get<CachedMacroBriefingData>(cacheKey);
            // briefing == null인 envelope은 cache miss로 처리 — peekMacroBriefingCache와
            // 동작 대칭. 그렇지 않으면 빈 summary briefing이 cached 상태로 반환돼 소비자가
            // 별도 비대칭 검사를 해야 한다.
            if (cached !== null && cached.briefing != null) {
                return {
                    status: 'cached',
                    briefing: normalizeMacroBriefing(cached.briefing),
                    generatedAt: cached.generatedAt,
                };
            }
        } catch (error) {
            console.error('[MacroBriefing/Submit] Cache read failed:', error);
        }
    }

    const { workerUrl, workerSecret } = readWorkerConfig();

    // This builder has no skills catalog and no separate system prompt (the
    // role framing lives in `dynamic` itself) — `stable` is always '' (spec
    // §3.2/Design C), so there is nothing to fold; `prompt` is `dynamic` alone.
    const { dynamic } = buildMacroBriefingPrompt(data);
    const prompt = dynamic;
    const jobId = crypto.randomUUID();

    // Persist the input-hashed cache key so pollMacroBriefing writes the result
    // under the SAME key the submit path looked up. Best-effort: a meta-store
    // failure must never block job submission, so we log and continue.
    try {
        await setJobMeta(jobId, {
            symbol: MACRO_BRIEFING_JOB_SYMBOL,
            cacheKey,
        });
    } catch (error) {
        console.error(
            '[MacroBriefing/Submit] Failed to store job meta:',
            error
        );
    }

    const dispatch = dispatchWorkerJob(
        `${workerUrl}/briefing`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Worker-Secret': workerSecret,
            },
            body: JSON.stringify({
                jobId,
                prompt,
                model: BRIEFING_MODEL_ID,
                seed: analysisSeed(prompt),
            }),
            signal: AbortSignal.timeout(FETCH_DEFAULT_TIME_OUT),
        },
        jobId,
        '[MacroBriefing/Submit]'
    );
    fireAndForget(dispatch, options);

    return { status: 'submitted', jobId };
}
