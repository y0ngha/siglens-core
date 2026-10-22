import {
    assertByokOnlyKeyPresent,
    resolveInFlightKey,
} from '@/application/byok/gate';
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { dedupeInFlight } from '@/application/analysis/inFlight';
import { DEEPSEEK_V4_1_FLASH_MODEL } from '@/application/chat/constants';
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
 * 카드당 번역+라벨링은 고빈도 저난도 작업이라 가장 싼 non-reasoning 라인이
 * 맞다. DeepSeek를 고른 이유는 **자동 prefix 캐싱**이다 — 프롬프트의 고정부
 * (`stable`, 로케일별로 고정)가 시스템 프롬프트로 앞에 붙고 기사 본문이 맨
 * 뒤에 오므로, 카드가 달라져도 앞쪽 큰 덩어리가 캐시 적중된다. Gemini
 * flash-lite 경로는 캐시 적중이 0%였다.
 *
 * 예전에 "DeepSeek는 `responseSchema`를 강제하지 않는다"는 이유로 Gemini로
 * 되돌렸지만 그 전제는 이미 낡았다. core #193 이후 DeepSeek 어댑터도
 * Responses API `json_schema`로 스키마를 강제한다. 8/20 되돌림은 비용 급증이
 * 뉴스 카드 때문인지 가려지지 않은 채 이뤄졌다 — 같은 시기에 prewarm의 뉴스
 * 카드 물량이 늘었고(#740), 모든 경로가 DeepSeek로 옮겨 갔으며(#731),
 * 피크 시간대 2배 요금이 겹쳤다.
 *
 * ⚠️ 아래 `reasoning: false`는 스펙의 `reasoning.off` 설정으로 해석된다
 * (DeepSeek에서는 effort `none`). 이 상수를 Gemini 모델로 되돌릴 때는
 * 대상 모델의 `supportsHardOff`를 확인할 것 — 대부분의 Gemini 모델은 추론을
 * 완전히 끄지 못해 이 저비용 경로가 조용히 사고 토큰을 쓰기 시작한다.
 */
export const NEWS_CARD_MODEL_ID = DEEPSEEK_V4_1_FLASH_MODEL;

/**
 * Run a per-card news analysis end-to-end: build prompt → LLM call →
 * normalize → return.
 *
 * The caller awaits a
 * single promise; no job IDs, no Redis meta, no polling loop.
 *
 * There is **no cache read or write** — the caller is responsible for:
 * 1. Filtering out already-analyzed items via their own persistence layer
 *    before calling this function.
 * 2. Persisting the result after this call returns.
 *
 * Concurrent calls sharing the same in-flight key (`item.id` + locale under
 * `keyPolicy: 'tier'`; additionally the same `userApiKey`, scoped by a hash, under
 * `'byok-only'`) are deduplicated via {@link dedupeInFlight}: only one LLM call
 * fires; all waiting callers with that key receive the same result.
 *
 * Unlike the other run* functions, there is **no tier or usage gate** and, by
 * default, no user key — per-card analysis is a lightweight data-pipeline call
 * on the server key. With `keyPolicy: 'byok-only'` it runs on `userApiKey`
 * instead. There is no cache, so that key gate is the first thing it does.
 *
 * Pass `options.signal` so a dropped connection aborts the in-flight LLM call.
 *
 * @throws If the AI provider call fails (network, 5xx, abort).
 * @throws {UserApiKeyMissingError} When `options.keyPolicy` is `'byok-only'`
 *   (or any non-`'tier'` value) and `options.userApiKey` is missing or empty.
 *   Thrown before the prompt is built or any provider call (this function has no
 *   cache).
 */
export async function runNewsCardAnalysis(
    options: SubmitNewsCardAnalysisOptions
): Promise<RunNewsCardAnalysisResult> {
    const { item } = options;

    // byok-only: no cache here, so the key gate is the first thing — before
    // the prompt is built or anything is joined or dispatched.
    assertByokOnlyKeyPresent(options.keyPolicy, options.userApiKey);

    const locale = options.locale ?? DEFAULT_ANALYSIS_LOCALE;
    const { stable, dynamic } = buildNewsCardAnalysisPrompt(item, locale);
    // `stable` is the locale-fixed rule block; folding it into the system
    // prompt makes it the cacheable prefix. The article sits last in `prompt`,
    // followed only by the locale-fixed language reminder (empty for ko).
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
    const inFlightKey = resolveInFlightKey(
        `news-card:${item.id}${localeKeySuffixFor(locale)}`,
        options.keyPolicy,
        options.userApiKey
    );
    const raw = await dedupeInFlight(inFlightKey, () =>
        callAnalysisAi({
            prompt,
            model: NEWS_CARD_MODEL_ID,
            userApiKey: options.userApiKey,
            keyPolicy: options.keyPolicy,
            signal: options.signal,
            fallbackOnProviderFailure: options.providerFallback,
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

    // Inline post-processing. No job queue involved.
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
