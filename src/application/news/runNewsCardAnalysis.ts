import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { dedupeInFlight } from '@/application/analysis/inFlight';
import { GEMINI_2_5_FLASH_LITE_MODEL } from '@/application/chat/constants';
import type {
    RunNewsCardAnalysisResult,
    SubmitNewsCardAnalysisOptions,
} from '@/application/news/types';
import { normalizeNewsCardAnalysis } from '@/domain/analysis/normalizeNews';
import { buildNewsCardAnalysisPrompt } from '@/domain/analysis/newsCardPrompt';
import {
    DEFAULT_ANALYSIS_LOCALE,
    localeKeySuffixFor,
    outputLanguageReminder,
} from '@/domain/analysis/outputLocale';
import { NEWS_CARD_RESPONSE_SCHEMA } from '@/domain/analysis/responseSchemas';
import { newsCardSystemPrompt } from '@/domain/analysis/systemPrompt';
import { analysisSeed } from '@/infrastructure/hash/analysisInput';

/**
 * @internal
 * Fixed model identifier for per-card news translation and sentiment analysis.
 *
 * 구 submitNewsCardAnalysis에서 이전 — job 큐 제거로 그 파일이 사라졌다.
 *
 * 카드당 번역+라벨링은 고빈도 저난도 작업이라 가장 싼 non-reasoning 라인이
 * 맞다. DeepSeek로 옮겼다가 되돌린 이유는 비용이다(2026-08-18 마이그레이션
 * 이후 DeepSeek 지출 급증). Gemini 어댑터는 `responseSchema`를 실제로
 * 강제하므로 필드 계약이 프롬프트+normalize에만 실려 있던 DeepSeek 경로보다
 * 오히려 안전하다.
 *
 * ⚠️ 아래 `reasoning: false`는 Gemini 분기에서 `thinkingBudget: 0`으로
 * 번역된다(`callAnalysisAi`). 리터럴 0을 400으로 거부하는 Gemini 모델이
 * 있으므로(`gemini-3.1-pro-preview`·`gemini-3.5-flash-lite`·`gemini-3.6-flash`
 * — 2026-07-31 라이브 실측) 이 상수를 바꿀 때는 대상 모델이 0을 받는지
 * 먼저 확인할 것. 세대(2.5 vs 3.x)로 갈리지 않는다.
 */
export const NEWS_CARD_MODEL_ID = GEMINI_2_5_FLASH_LITE_MODEL;

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

    const locale = options.locale ?? DEFAULT_ANALYSIS_LOCALE;
    const { stable, dynamic } = buildNewsCardAnalysisPrompt(item, locale);
    // Design C: this builder has no skills catalog, so `stable` is always ''
    // and `system` stays the base persona unchanged.
    const system = stable
        ? `${newsCardSystemPrompt(locale)}\n\n${stable}`
        : newsCardSystemPrompt(locale);
    // 출력 언어를 **마지막 지시**로 한 번 더 못 박는다 — 유저 프롬프트의 필드
    // 설명은 언어를 `Korean`으로 적어 둔 곳이 많아 그것만으로는 뒤집히지 않는다.
    // 기본 로케일(ko)에서는 빈 문자열이라 프롬프트 바이트가 예전과 같다.
    const prompt = `${dynamic}${outputLanguageReminder(locale)}`;

    /*
     * in-flight 키에 로케일이 들어가야 한다. 같은 카드에 언어가 다른 동시
     * 요청이 오면 하나로 합쳐져 늦게 부른 쪽이 **요청하지 않은 언어**를 받는다.
     * 캐시 키와 같은 규약이라 ko는 접미가 없다.
     */
    const inFlightKey = `news-card:${item.id}${localeKeySuffixFor(locale)}`;
    const raw = await dedupeInFlight(inFlightKey, () =>
        callAnalysisAi({
            prompt,
            model: NEWS_CARD_MODEL_ID,
            signal: options.signal,
            system,
            responseSchema: NEWS_CARD_RESPONSE_SCHEMA,
            seed: analysisSeed(`${system}\n\n${prompt}`),
            // 번역 + 라벨링은 결정적 변환이라 추론에서 얻을 품질 이득이 없고
            // 지연·출력 토큰만 는다. `reasoning: false`는 모델 스펙을
            // **오버라이드**하므로, 누가 NEWS_CARD_MODEL_ID를 thinking 모델로
            // 바꿔도 이 경로는 계속 꺼진 상태로 돈다.
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
