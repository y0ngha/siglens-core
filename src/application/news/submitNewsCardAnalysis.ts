import { fireAndForget } from '@/application/background';
import type {
    SubmitNewsCardAnalysisOptions,
    SubmitNewsCardAnalysisResult,
} from '@/application/news/types';
import { buildNewsCardAnalysisPrompt } from '@/domain/analysis/newsCardPrompt';
import { NEWS_CARD_RESPONSE_SCHEMA } from '@/domain/analysis/responseSchemas';
import { NEWS_CARD_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import { MS_PER_MINUTE } from '@/domain/constants/time';
import type { AnalysisType } from '@/domain/types';
import { analysisSeed } from '@/infrastructure/hash/analysisInput';
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
 * @internal
 * Fixed model identifier for per-card news translation and sentiment analysis.
 */
export const NEWS_CARD_MODEL_ID = 'gemini-2.5-flash-lite' as const;

/**
 * Submit a per-card news analysis job using the flash-lite model.
 *
 * Always returns `submitted` — there is no cache check. The caller is
 * responsible for:
 * 1. Filtering out already-analyzed items via their own persistence layer
 *    before calling this function.
 * 2. Persisting the result after polling completes.
 *
 * Unlike full news analysis, this call has **no tier or usage gate** — it
 * is a lightweight per-item call that is bundled into the news data pipeline.
 *
 * @param options - Options object containing the raw news item and optional background-task hooks.
 *   Pass Vercel's `waitUntil` so the worker dispatch can continue after the response.
 * @returns The submission outcome — see {@link SubmitNewsCardAnalysisResult}.
 *
 * @example
 * ```ts
 * const res = await submitNewsCardAnalysis({ item: newsItem });
 * const polled = await pollNewsCardAnalysis(res.jobId);
 * ```
 *
 * @see pollNewsCardAnalysis
 */
export async function submitNewsCardAnalysis(
    options: SubmitNewsCardAnalysisOptions
): Promise<SubmitNewsCardAnalysisResult> {
    const { item, thinkingBudget } = options;

    // Build prompt, enqueue job, fire-and-forget worker POST
    const { workerUrl, workerSecret } = readWorkerConfig();
    const { stable, dynamic } = buildNewsCardAnalysisPrompt(item);
    // Design C (A/B-gate validated): fold the always-on skill digest
    // (`stable`) into the SYSTEM prompt; send `dynamic` alone as the user
    // prompt. This builder has no skills catalog, so `stable` is always ''
    // and `system` stays the base persona unchanged.
    const system = stable
        ? `${NEWS_CARD_SYSTEM_PROMPT}\n\n${stable}`
        : NEWS_CARD_SYSTEM_PROMPT;
    const prompt = dynamic;
    const jobId = crypto.randomUUID();

    await setJobMeta(jobId, {
        symbol: item.symbol,
        modelId: NEWS_CARD_MODEL_ID,
    });

    const dispatch = fetch(`${workerUrl}/analyze`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Worker-Secret': workerSecret,
        },
        body: JSON.stringify({
            jobId,
            prompt,
            seed: analysisSeed(`${system}\n\n${prompt}`),
            model: NEWS_CARD_MODEL_ID,
            ...(thinkingBudget !== undefined && { thinkingBudget }),
            analysisType: 'newsCard' satisfies AnalysisType,
            system,
            responseSchema: NEWS_CARD_RESPONSE_SCHEMA,
        }),
        signal: AbortSignal.timeout(SUBMIT_NEWS_CARD_ANALYSIS_TIMEOUT_MS),
    }).catch(error => {
        console.error('[submitNewsCardAnalysis] Worker request failed:', error);
    });
    fireAndForget(dispatch, options);

    return { status: 'submitted', jobId };
}
