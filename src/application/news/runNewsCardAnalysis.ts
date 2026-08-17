import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { dedupeInFlight } from '@/application/analysis/inFlight';
import { DEEPSEEK_V4_FLASH_MODEL } from '@/application/chat/constants';
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
 * @internal
 * Fixed model identifier for per-card news translation and sentiment analysis.
 *
 * 구 submitNewsCardAnalysis에서 이전 — job 큐 제거로 그 파일이 사라졌다.
 *
 * ⚠️ DeepSeek 어댑터는 `responseSchema`를 무시하고
 * `response_format: { type: 'json_object' }`만 건다(`infrastructure/ai/providers/deepseek.ts`).
 * 필드 계약은 `buildNewsCardAnalysisPrompt`의 Output Schema/Allowed Values
 * 블록과 `normalizeNewsCardAnalysis`가 함께 진다 — 아래 `responseSchema` 인자는
 * Gemini/Claude/GPT로 되돌릴 때를 위해 남겨둔 것이지, 지금 이 모델에서는
 * 강제력이 없다.
 */
export const NEWS_CARD_MODEL_ID = DEEPSEEK_V4_FLASH_MODEL;

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
    const { item } = options;

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
            // 번역 + 라벨링은 결정적 변환이라 추론에서 얻을 품질 이득이 없고
            // 지연·출력 토큰만 는다. `reasoning: false`는 모델 스펙을
            // **오버라이드**하므로, 누가 NEWS_CARD_MODEL_ID를 thinking 모델
            // (deepseek-v4-pro 등)로 바꿔도 이 경로는 계속 꺼진 상태로 돈다.
            // (구 Gemini 경로의 `thinkingBudget: 0`을 대체 — 그 인자는 deepseek
            // 분기에서 무시되므로 그대로 뒀다면 조용히 무력화됐을 것이다.)
            reasoning: false,
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
