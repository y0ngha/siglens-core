import { fireAndForget } from '@/application/background';
import type { BackgroundTaskOptions } from '@/application/types';
import { buildMarketBriefingPrompt } from '@/domain/analysis/marketBriefingPrompt';
import { normalizeMarketBriefing } from '@/domain/analysis/normalizeMarketBriefing';
import { ISO_DATE_HOUR_PREFIX_LENGTH } from '@/domain/constants/format';
import type { MarketSummaryData, SubmitBriefingResult } from '@/domain/types';
import { buildBriefingCacheKey } from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import type { CachedBriefingData } from '@/infrastructure/cache/types';
import { claimOrJoinInFlightJob } from '@/infrastructure/jobs/queue';
import { readWorkerConfig } from '@/infrastructure/market/config';
import { FETCH_DEFAULT_TIME_OUT } from '@/infrastructure/market/constants';

/**
 * Submit a market briefing job from the current dashboard summary.
 *
 * The briefing cache is keyed by the current ISO date+hour, so within a given
 * hour all callers receive the same cached briefing. Resolves to:
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
 * const summary = await getMarketSummary();
 * const briefing = await submitBriefing(summary);
 * if (briefing.status === 'submitted') {
 *     const polled = await pollBriefing(briefing.jobId);
 * }
 * ```
 *
 * @see pollBriefing
 * @see getMarketSummaryWithBriefing
 */
export async function submitBriefing(
    data: MarketSummaryData,
    options?: BackgroundTaskOptions
): Promise<SubmitBriefingResult> {
    const now = new Date();
    const dateHour = now.toISOString().slice(0, ISO_DATE_HOUR_PREFIX_LENGTH);
    const cacheKey = buildBriefingCacheKey(dateHour);

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

    const prompt = buildMarketBriefingPrompt(data.indices, data.sectors);
    const newJobId = crypto.randomUUID();
    // Dedup: 같은 시간대(cacheKey)에 동시 요청이 들어와도 worker 호출은 1번만.
    // 다른 submitter는 기존 jobId만 받아서 polling한다.
    const claim = await claimOrJoinInFlightJob(cacheKey, newJobId);

    if (claim.status === 'joined') {
        return { status: 'submitted', jobId: claim.jobId };
    }

    const { jobId } = claim;
    // briefing은 symbol에 묶이지 않으므로 setJobMeta는 의도적으로 생략한다.
    // 결과적으로 cleanup이 cacheKey를 모르므로 in-flight 슬롯은 1시간 TTL로
    // 자연 정리되는데, briefing cacheKey 자체가 시간 단위이므로 다음 시간대로
    // 넘어가면 어차피 새 키를 사용한다 — TTL 정리는 동작상 안전하다.

    // fire-and-forget: serverless 환경에선 options.waitUntil로 응답 후 promise 종료 보장.
    const dispatch = fetch(`${workerUrl}/briefing`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Worker-Secret': workerSecret,
        },
        body: JSON.stringify({ jobId, prompt }),
        signal: AbortSignal.timeout(FETCH_DEFAULT_TIME_OUT),
    }).catch(error => {
        console.error('[Briefing/Submit] Worker request failed:', error);
    });
    fireAndForget(dispatch, options);

    return { status: 'submitted', jobId };
}
