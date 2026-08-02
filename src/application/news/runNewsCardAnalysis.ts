import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { dedupeInFlight } from '@/application/analysis/inFlight';
import { NEWS_CARD_MODEL_ID } from '@/application/news/submitNewsCardAnalysis';
import type {
    RunNewsCardAnalysisResult,
    SubmitNewsCardAnalysisOptions,
} from '@/application/news/types';
import { normalizeNewsCardAnalysis } from '@/domain/analysis/normalizeNews';
import { buildNewsCardAnalysisPrompt } from '@/domain/analysis/newsCardPrompt';
import { NEWS_CARD_RESPONSE_SCHEMA } from '@/domain/analysis/responseSchemas';
import { NEWS_CARD_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import { analysisSeed } from '@/infrastructure/hash/analysisInput';

/**
 * Run a per-card news analysis end-to-end: build prompt → LLM call →
 * normalize → return.
 *
 * This is the direct (non-queued) replacement for the
 * `submitNewsCardAnalysis` + `pollNewsCardAnalysis` pair. The caller awaits a
 * single promise; no job IDs, no Redis meta, no polling loop.
 *
 * There is **no cache read or write** — the caller is responsible for:
 * 1. Filtering out already-analyzed items via their own persistence layer
 *    before calling this function.
 * 2. Persisting the result after this call returns.
 *
 * Concurrent calls for the same `item.id` are deduplicated via
 * {@link dedupeInFlight}: only one LLM call fires; all waiting callers
 * receive the same result.
 *
 * Unlike the other run* functions, there is **no tier, usage, or BYOK gate**
 * — per-card analysis is a lightweight data-pipeline call, not a member
 * feature.
 *
 * Pass `options.signal` so a dropped connection aborts the in-flight LLM call.
 *
 * @throws If the AI provider call fails (network, 5xx, abort). There are no
 *   gate denials to return — failures are always thrown.
 *
 * @see submitNewsCardAnalysis — the queued predecessor; still exported for
 *   the existing production path until siglens switches to runNewsCardAnalysis.
 */
export async function runNewsCardAnalysis(
    options: SubmitNewsCardAnalysisOptions
): Promise<RunNewsCardAnalysisResult> {
    const { item, thinkingBudget } = options;

    const { stable, dynamic } = buildNewsCardAnalysisPrompt(item);
    // Design C: this builder has no skills catalog, so `stable` is always ''
    // and `system` stays the base persona unchanged.
    const system = stable
        ? `${NEWS_CARD_SYSTEM_PROMPT}\n\n${stable}`
        : NEWS_CARD_SYSTEM_PROMPT;
    const prompt = dynamic;

    const raw = await dedupeInFlight(`news-card:${item.id}`, () =>
        callAnalysisAi({
            prompt,
            model: NEWS_CARD_MODEL_ID,
            signal: options.signal,
            system,
            responseSchema: NEWS_CARD_RESPONSE_SCHEMA,
            seed: analysisSeed(`${system}\n\n${prompt}`),
            thinkingBudget,
            correlationId: `${item.id}:newsCard`,
        })
    );

    // Inline post-processing (formerly in pollNewsCardAnalysis). No job queue involved.
    // raw를 미리 JSON.parse하지 않는다 — 이 normalize 함수는 parseLlmPayload로
    // 코드펜스 제거·파싱·garbage 방어를 스스로 수행한다. 앞에서 파싱하면 LLM이
    // 비-JSON을 뱉었을 때 예외가 호출자까지 올라가 그 방어가 무력해진다
    // (구 poll* 경로도 파싱하지 않고 그대로 넘겼다).
    const result = normalizeNewsCardAnalysis(raw);

    if (result.titleKo === '' && result.summaryKo === '') {
        console.warn('[RunNewsCardAnalysis] Empty news card analysis', {
            id: item.id,
        });
    }

    return { status: 'done', result };
}
