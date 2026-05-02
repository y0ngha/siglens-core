import { fireAndForget } from '@/application/background';
import type { SubmitNewsCardAnalysisResult } from '@/application/news/types';
import type { BackgroundTaskOptions } from '@/application/types';
import { buildNewsCardAnalysisPrompt } from '@/domain/analysis/newsCardPrompt';
import { MS_PER_MINUTE } from '@/domain/constants/time';
import type { NewsItem } from '@/domain/types';
import {
    buildNewsCardCacheKey,
    NEWS_CARD_CACHE_TTL_SECONDS,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { readWorkerConfig } from '@/infrastructure/market/config';

/**
 * Model hard-coded for per-card translation and sentiment analysis.
 *
 * Flash-lite is chosen for its low cost and sub-second latency on brief
 * classification tasks. The model is intentionally not caller-configurable
 * so the cache key (keyed only by `newsId`) never produces cross-model
 * pollution in the permanent store.
 */
const NEWS_CARD_MODEL = 'gemini-2.5-flash-lite' as const;

/**
 * Per-card worker timeout.
 *
 * Flash-lite is fast — typical wall-clock latency is <10 s per card.
 * 2 minutes gives comfortable headroom for cold starts and retries without
 * holding the serverless function open longer than necessary.
 */
const SUBMIT_NEWS_CARD_ANALYSIS_TIMEOUT_MS = 2 * MS_PER_MINUTE;

/**
 * Submit a per-card news analysis job using the flash-lite model.
 *
 * Resolves to one of two outcomes:
 * - `cached`: a permanent per-card analysis already exists in Redis. The
 *   cache is keyed by `item.id` only; model is fixed to `NEWS_CARD_MODEL`.
 * - `submitted`: a `jobId` was registered and a fire-and-forget POST was
 *   sent to the configured worker. Poll the result with
 *   {@link pollNewsCardAnalysis}.
 *
 * Unlike full news analysis, this call has **no tier or usage gate** — it
 * is a lightweight per-item call that is bundled into the news data pipeline.
 *
 * The result cache TTL is {@link NEWS_CARD_CACHE_TTL_SECONDS} (30 days),
 * making it effectively permanent for the lifetime of a news article.
 *
 * @param item - Raw news article to translate and classify.
 * @param options - Optional background-task hooks. Pass Vercel's `waitUntil`
 *   so the worker dispatch can continue after the response.
 * @returns The submission outcome — see {@link SubmitNewsCardAnalysisResult}.
 *
 * @example
 * ```ts
 * const res = await submitNewsCardAnalysis(newsItem);
 * if (res.status === 'cached') return res.result;
 * const polled = await pollNewsCardAnalysis(res.jobId);
 * ```
 *
 * @see pollNewsCardAnalysis
 */
export async function submitNewsCardAnalysis(
    item: NewsItem,
    options?: BackgroundTaskOptions
): Promise<SubmitNewsCardAnalysisResult> {
    const cacheKey = buildNewsCardCacheKey(item.id);
    const cache = createCacheProvider();

    // ── 1. Check permanent cache (no tier/usage gate for card analysis) ──
    if (cache !== null) {
        try {
            const cached = await cache.get<import('@/domain/types').NewsCardAnalysis>(cacheKey);
            if (cached !== null) {
                return { status: 'cached', result: cached };
            }
        } catch (error) {
            console.error('[submitNewsCardAnalysis] Cache read failed:', error);
        }
    }

    // ── 2. Build prompt, enqueue job, fire-and-forget worker POST ──
    const { workerUrl, workerSecret } = readWorkerConfig();
    const prompt = buildNewsCardAnalysisPrompt(item);
    const jobId = crypto.randomUUID();

    await setJobMeta(jobId, {
        symbol: item.symbol,
        modelId: NEWS_CARD_MODEL,
        cacheKey,
    });

    const dispatch = fetch(`${workerUrl}/analyze`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Worker-Secret': workerSecret,
        },
        body: JSON.stringify({ jobId, prompt, model: NEWS_CARD_MODEL }),
        signal: AbortSignal.timeout(SUBMIT_NEWS_CARD_ANALYSIS_TIMEOUT_MS),
    }).catch(error => {
        console.error('[submitNewsCardAnalysis] Worker request failed:', error);
    });
    fireAndForget(dispatch, options);

    return { status: 'submitted', jobId };
}
