import { cleanupInBackground, fireAndForget } from '@/application/background';
import type { BackgroundTaskOptions } from '@/application/types';
import type {
    MarketBriefingResponse,
    PollBriefingResult,
} from '@/domain/types';
import { normalizeMarketBriefing } from '@/domain/analysis/normalizeMarketBriefing';
import { ISO_DATE_HOUR_PREFIX_LENGTH } from '@/domain/constants/format';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import {
    buildBriefingCacheKey,
    MARKET_BRIEFING_CACHE_TTL,
} from '@/infrastructure/cache/config';
import {
    getJobError,
    getJobResult,
    getJobStatus,
} from '@/infrastructure/jobs/queue';

/**
 * Poll the result of a briefing job submitted via {@link submitBriefing}.
 *
 * Returns one of three outcomes:
 * - `processing`: the worker has not finished yet. Caller should retry.
 * - `error`: missing or malformed result (`summary` field absent), or the
 *   worker reported a failure.
 * - `done`: normalized briefing plus its `generatedAt` timestamp. The result
 *   is also written to the hourly briefing cache so subsequent
 *   {@link submitBriefing} calls within the same hour return it as cached.
 *
 * On every terminal outcome (`error` or `done`) the job is cleaned up from
 * Redis (best-effort).
 *
 * @param jobId - The `jobId` returned by {@link submitBriefing}.
 * @param options - Optional background-task hooks. Pass Vercel's `waitUntil`
 *   so Redis cleanup and cache writes can continue after the response.
 * @returns The current poll outcome — see {@link PollBriefingResult}.
 *
 * @see submitBriefing
 */
export async function pollBriefing(
    jobId: string,
    options?: BackgroundTaskOptions
): Promise<PollBriefingResult> {
    const status = await getJobStatus(jobId);

    if (status === null || status === 'processing') {
        return { status: 'processing' };
    }

    if (status === 'error') {
        const error = await getJobError(jobId);
        cleanupInBackground(jobId, '[Briefing/Poll]', options);
        return { status: 'error', error: error ?? 'Unknown error' };
    }

    // status === 'done'
    const raw = await getJobResult(jobId);
    if (!raw) {
        cleanupInBackground(jobId, '[Briefing/Poll]', options);
        return { status: 'error', error: 'Result not found' };
    }

    const briefing: MarketBriefingResponse = normalizeMarketBriefing(raw);

    if (!briefing.summary) {
        cleanupInBackground(jobId, '[Briefing/Poll]', options);
        return { status: 'error', error: 'Invalid briefing result' };
    }

    const now = new Date();
    const generatedAt = now.toISOString();
    const dateHour = generatedAt.slice(0, ISO_DATE_HOUR_PREFIX_LENGTH);
    const cacheKey = buildBriefingCacheKey(dateHour);
    const cache = createCacheProvider();
    if (cache !== null) {
        fireAndForget(
            cache
                .set(
                    cacheKey,
                    { briefing, generatedAt },
                    MARKET_BRIEFING_CACHE_TTL
                )
                .catch(err =>
                    console.error('[Briefing/Poll] Cache write failed:', err)
                ),
            options
        );
    }

    cleanupInBackground(jobId, '[Briefing/Poll]', options);
    return { status: 'done', briefing, generatedAt };
}
