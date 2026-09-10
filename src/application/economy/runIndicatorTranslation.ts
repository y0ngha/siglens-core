import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { dedupeInFlight } from '@/application/analysis/inFlight';
import { GEMINI_FLASH_LITE_MODEL } from '@/application/chat/constants';
import type {
    RunIndicatorTranslationOptions,
    RunIndicatorTranslationResult,
} from '@/application/economy/types';
import { buildIndicatorTranslationPrompt } from '@/domain/economy/indicatorTranslationPrompt';
import { normalizeIndicatorTranslation } from '@/domain/economy/normalizeIndicatorTranslation';
import type { ActiveModelId } from '@/domain/types';
import {
    buildIndicatorTranslationCacheKey,
    INDICATOR_TRANSLATION_CACHE_TTL,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import {
    analysisSeed,
    hashAnalysisInput,
} from '@/infrastructure/hash/analysisInput';

/**
 * @internal Fixed model identifier for indicator name translation.
 *
 * Translation is a short one-field task (single Korean string): the cheapest
 * non-reasoning line is the right cost/latency trade-off. Kept local so the
 * run path is self-contained.
 *
 * ⚠️ `reasoning: false`는 스펙의 `reasoning.off` 설정으로 해석된다. Gemini
 * 모델 대부분은 추론을 완전히 끄지 못하므로(runNewsCardAnalysis.ts의 같은 주석
 * 참고) 이 상수를 바꾸기 전에 대상 모델의 `supportsHardOff`를 확인할 것.
 */
const INDICATOR_TRANSLATION_MODEL: ActiveModelId = GEMINI_FLASH_LITE_MODEL;

/**
 * Run an indicator-name AI translation end-to-end: cache lookup → LLM call →
 * normalize → cache write → return.
 *
 * This is the direct (non-queued) replacement for `submitIndicatorTranslation`
 * + `pollIndicatorTranslation`. The caller awaits a single promise; no job IDs,
 * no Redis meta, no polling loop.
 *
 * Uses `callAnalysisAi` (not `callBriefingAi`) — the submit path dispatched to
 * the worker's `/analyze` endpoint, not `/briefing`. The model is fixed at
 * `gemini-2.5-flash-lite` with reasoning off (single Korean string output).
 *
 * Indicator translation has no usage gate — no tier, no BYOK, no quota check.
 *
 * The cache TTL is 30 days (indicator names rarely change). An empty `nameKo`
 * result (garbage from the LLM) is cached and returned — callers should fall
 * back to the original English name when `nameKo === ''`.
 *
 * Concurrent calls for the same `cacheKey` are deduplicated via
 * {@link dedupeInFlight}: only one LLM call fires; all waiting callers
 * receive the same result.
 *
 * Pass `options.signal` so a dropped connection aborts the in-flight LLM call.
 *
 * @throws If the AI provider call fails (network, 5xx, AbortError).
 *
 * @see submitIndicatorTranslation — the queued predecessor; still exported for
 *   the existing production path until siglens switches to runIndicatorTranslation.
 */
export async function runIndicatorTranslation(
    normalizedName: string,
    options?: RunIndicatorTranslationOptions
): Promise<RunIndicatorTranslationResult> {
    const nameHash = hashAnalysisInput(normalizedName);
    const cacheKey = buildIndicatorTranslationCacheKey(nameHash);

    const cache = createCacheProvider();
    if (cache !== null) {
        try {
            const cached = await cache.get<unknown>(cacheKey);
            if (cached !== null) {
                return {
                    status: 'cached',
                    nameKo: normalizeIndicatorTranslation(cached),
                };
            }
        } catch (error) {
            console.error(
                '[RunIndicatorTranslation] Cache read failed:',
                error
            );
        }
    }

    // This builder has no skills catalog and no separate system prompt —
    // `stable` is always '' (Design C), so `prompt` is `dynamic` alone.
    const { dynamic } = buildIndicatorTranslationPrompt(normalizedName);
    const prompt = dynamic;

    const raw = await dedupeInFlight(cacheKey, () =>
        callAnalysisAi({
            prompt,
            model: INDICATOR_TRANSLATION_MODEL,
            signal: options?.signal,
            seed: analysisSeed(prompt),
            // 지표명 한 줄 번역 — 사실상 사전 조회다. 추론은 지연·출력 토큰만
            // 늘린다. 모델 스펙을 오버라이드하므로 INDICATOR_TRANSLATION_MODEL이
            // thinking 모델로 바뀌어도 이 경로는 꺼진 상태를 유지한다.
            reasoning: false,
            correlationId: `indicator-translation:${normalizedName}`,
        })
    );

    // raw를 JSON.parse하지 않고 그대로 넘긴다 — normalizeIndicatorTranslation이
    // 코드펜스 제거·파싱·garbage 방어를 모두 수행하며 "never throws"를 계약으로
    // 보장한다. 여기서 미리 파싱하면 LLM이 비-JSON을 뱉었을 때 그 계약을 깨고
    // 예외가 호출자까지 올라간다(구 pollIndicatorTranslation도 파싱하지 않았다).
    const nameKo: string = normalizeIndicatorTranslation(raw);

    if (cache !== null) {
        // Cache the result as { nameKo } so normalizeIndicatorTranslation can
        // parse it with the same logic used for raw LLM responses — mirrors the
        // pollIndicatorTranslation cache write format.
        // Fire-and-forget: cache write must not delay the response.
        cache
            .set(cacheKey, { nameKo }, INDICATOR_TRANSLATION_CACHE_TTL)
            .catch(error =>
                console.error(
                    '[RunIndicatorTranslation] Cache write failed:',
                    error
                )
            );
    }

    // Usage invariant: indicator translation has no usage gate — no quota check
    // or record (same as economic-event analysis and congress trend).
    return { status: 'done', nameKo };
}
