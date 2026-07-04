import { fireAndForget } from '@/application/background';
import type { BackgroundTaskOptions } from '@/application/types';
import { buildMarketBriefingPrompt } from '@/domain/analysis/marketBriefingPrompt';
import { normalizeMarketBriefing } from '@/domain/analysis/normalizeMarketBriefing';
import { ISO_DATE_HOUR_PREFIX_LENGTH } from '@/domain/constants/format';
import type { MarketSummaryData, SubmitBriefingResult } from '@/domain/types';
import {
    BRIEFING_MODEL_ID,
    buildBriefingCacheKey,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import type { CachedBriefingData } from '@/infrastructure/cache/types';
import { analysisSeed } from '@/infrastructure/hash/analysisInput';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { readWorkerConfig } from '@/infrastructure/market/config';
import { FETCH_DEFAULT_TIME_OUT } from '@/infrastructure/market/constants';
import { hashBriefingInput } from './briefingInputHash';

/** Stable job-meta `symbol` marker for market-briefing jobs (not symbol-bound). */
const BRIEFING_JOB_SYMBOL = 'market';

/**
 * Submit a market briefing job from the current dashboard summary.
 *
 * The briefing cache is keyed by the current ISO date+hour, the briefing model
 * identifier, and a deterministic hash of the index/sector quote values, so
 * identical-input callers within the hour share the cached briefing, while a
 * model change or changed underlying data within the same hour produces a cache
 * miss and a fresh briefing job. Resolves to:
 * - `cached`: the latest briefing for the current hour is reused (already
 *   normalized via {@link normalizeMarketBriefing}).
 * - `submitted`: a new `jobId` was registered and a fire-and-forget HTTP POST
 *   was sent to the worker's `/briefing` endpoint. Poll with {@link pollBriefing}.
 *
 * @param data - Market summary input (indices + sector ETFs) typically
 *   produced by {@link getMarketSummary}.
 * @param options - Optional background-task hooks. Pass Vercel's `waitUntil`
 *   so the worker dispatch can continue after the response.
 * @returns Either a cached briefing or a freshly submitted job descriptor —
 *   see {@link SubmitBriefingResult}.
 *
 * @throws {Error} If `WORKER_URL` / `WORKER_SECRET` are missing in env.
 *
 * @example
 * ```ts
 * const summary = await getMarketSummary(provider, marketIndices, sectorEtfs);
 * const briefing = await submitBriefing(summary);
 * if (briefing.status === 'submitted') {
 *     const polled = await pollBriefing(briefing.jobId);
 * }
 * ```
 *
 * @see pollBriefing
 */
export async function submitBriefing(
    data: MarketSummaryData,
    options?: BackgroundTaskOptions
): Promise<SubmitBriefingResult> {
    const now = new Date();
    const dateHour = now.toISOString().slice(0, ISO_DATE_HOUR_PREFIX_LENGTH);
    const inputHash = hashBriefingInput(data.indices, data.sectors);
    const cacheKey = buildBriefingCacheKey(
        dateHour,
        BRIEFING_MODEL_ID,
        inputHash
    );

    const cache = createCacheProvider();
    if (cache !== null) {
        try {
            const cached = await cache.get<CachedBriefingData>(cacheKey);
            if (cached !== null) {
                return {
                    status: 'cached',
                    briefing: normalizeMarketBriefing(cached.briefing),
                    generatedAt: cached.generatedAt,
                };
            }
        } catch (error) {
            console.error('[Briefing/Submit] Cache read failed:', error);
        }
    }

    const { workerUrl, workerSecret } = readWorkerConfig();

    const { stable: promptStable, dynamic: promptDynamic } =
        buildMarketBriefingPrompt(data.indices, data.sectors);
    // Legacy combined string — kept as the `prompt` fallback field for one
    // release so a not-yet-upgraded worker (pre PR4a) still works (spec
    // §3.4's hard contract: join with EXACTLY '\n\n' for seed/legacy parity).
    const prompt = `${promptStable}\n\n${promptDynamic}`;
    const jobId = crypto.randomUUID();

    // Persist the input-hashed cache key so pollBriefing writes the result
    // under the SAME key the submit path looked up — without this, the poll
    // step (which has no access to the index/sector data) could not
    // reconstruct the input hash and read/write keys would diverge.
    //
    // INTENTIONAL graceful degradation: the cache write is best-effort/optional.
    // If the meta isn't stored, poll simply skips the cache write (a cold-but-
    // correct path). A meta-store failure must never block job submission, so we
    // log and continue rather than propagate.
    try {
        await setJobMeta(jobId, { symbol: BRIEFING_JOB_SYMBOL, cacheKey });
    } catch (error) {
        console.error('[Briefing/Submit] Failed to store job meta:', error);
    }

    // fire-and-forget: serverless 환경에선 options.waitUntil로 응답 후 promise 종료 보장.
    const dispatch = fetch(`${workerUrl}/briefing`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Worker-Secret': workerSecret,
        },
        body: JSON.stringify({
            jobId,
            prompt,
            promptStable,
            promptDynamic,
            model: BRIEFING_MODEL_ID,
            seed: analysisSeed(prompt),
        }),
        signal: AbortSignal.timeout(FETCH_DEFAULT_TIME_OUT),
    }).catch(error => {
        console.error('[Briefing/Submit] Worker request failed:', error);
    });
    fireAndForget(dispatch, options);

    return { status: 'submitted', jobId };
}
