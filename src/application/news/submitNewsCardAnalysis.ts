import { fireAndForget } from '@/application/background';
import type {
    SubmitNewsCardAnalysisOptions,
    SubmitNewsCardAnalysisResult,
} from '@/application/news/types';
import { normalizeNewsCardAnalysis } from '@/domain/analysis/normalizeNews';
import { buildNewsCardAnalysisPrompt } from '@/domain/analysis/newsCardPrompt';
import { MS_PER_MINUTE } from '@/domain/constants/time';
import type { NewsCardAnalysis } from '@/domain/types';
import {
    buildNewsCardCacheKey,
    NEWS_CARD_MODEL_ID,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { readWorkerConfig } from '@/infrastructure/market/config';

/**
 * Per-card worker timeout.
 *
 * 30 minutes gives the dispatcher enough headroom for fire-and-forget dispatch:
 * per-card calls share a single background POST, and the worker can take longer
 * than typical when news bodies are large or rate-limit retries kick in.
 */
const SUBMIT_NEWS_CARD_ANALYSIS_TIMEOUT_MINUTES = 30;
const SUBMIT_NEWS_CARD_ANALYSIS_TIMEOUT_MS =
    SUBMIT_NEWS_CARD_ANALYSIS_TIMEOUT_MINUTES * MS_PER_MINUTE;

/**
 * Submit a per-card news analysis job using the flash-lite model.
 *
 * Resolves to one of two outcomes:
 * - `cached`: a permanent per-card analysis already exists in Redis. The
 *   cache is keyed by `item.id` only; model is fixed to `NEWS_CARD_MODEL_ID`.
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
 * @param options - Options object containing the raw news item and optional background-task hooks.
 *   Pass Vercel's `waitUntil` so the worker dispatch can continue after the response.
 * @returns The submission outcome — see {@link SubmitNewsCardAnalysisResult}.
 *
 * @example
 * ```ts
 * const res = await submitNewsCardAnalysis({ item: newsItem });
 * if (res.status === 'cached') return res.result;
 * const polled = await pollNewsCardAnalysis(res.jobId);
 * ```
 *
 * @see pollNewsCardAnalysis
 */
export async function submitNewsCardAnalysis(
    options: SubmitNewsCardAnalysisOptions
): Promise<SubmitNewsCardAnalysisResult> {
    const { item } = options;
    const cacheKey = buildNewsCardCacheKey(item.id);
    const cache = createCacheProvider();

    // ── 1. Check permanent cache (no tier/usage gate for card analysis) ──
    if (cache !== null) {
        try {
            const cached = await cache.get<NewsCardAnalysis>(cacheKey);
            // Lightweight structural validation — schema drift from a prior
            // release should fall through as a cache miss rather than poison
            // the response. The schema-version prefix on the cache key is the
            // primary invalidation lever (see CACHE_KEY_SCHEMA_VERSION); this
            // check is a belt-and-braces fallback.
            if (cached !== null) {
                return {
                    status: 'cached',
                    result: normalizeNewsCardAnalysis(cached),
                };
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
        modelId: NEWS_CARD_MODEL_ID,
        cacheKey,
    });

    const dispatch = fetch(`${workerUrl}/analyze`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Worker-Secret': workerSecret,
        },
        body: JSON.stringify({ jobId, prompt, model: NEWS_CARD_MODEL_ID }),
        signal: AbortSignal.timeout(SUBMIT_NEWS_CARD_ANALYSIS_TIMEOUT_MS),
    }).catch(error => {
        console.error('[submitNewsCardAnalysis] Worker request failed:', error);
    });
    fireAndForget(dispatch, options);

    return { status: 'submitted', jobId };
}
