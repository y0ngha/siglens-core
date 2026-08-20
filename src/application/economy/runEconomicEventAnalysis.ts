import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { dedupeInFlight } from '@/application/analysis/inFlight';
import { GEMINI_2_5_FLASH_LITE_MODEL } from '@/application/chat/constants';
import type {
    RunEconomicEventAnalysisOptions,
    RunEconomicEventAnalysisResult,
} from '@/application/economy/types';
import { buildEconomicEventAnalysisPrompt } from '@/domain/economy/economicEventPrompt';
import { normalizeEconomicEventAnalysis } from '@/domain/economy/normalizeEconomicEventAnalysis';
import type { EconomicEventAnalysisInput } from '@/domain/economy/types';
import type { ActiveModelId } from '@/domain/types';
import {
    buildEconomicEventCacheKey,
    ECONOMIC_EVENT_CACHE_TTL,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import {
    analysisSeed,
    hashAnalysisInput,
} from '@/infrastructure/hash/analysisInput';

/**
 * @internal Fixed model identifier for economic-event analysis.
 *
 * A short structured classification task (sentiment + two Korean sentences):
 * the cheapest non-reasoning line is the right cost/latency trade-off,
 * mirroring news-card analysis. Kept local so the run path is self-contained.
 *
 * ⚠️ `reasoning: false`는 Gemini 분기에서 `thinkingBudget: 0`이 된다. 리터럴
 * 0을 거부하는 Gemini 모델이 있으므로(runNewsCardAnalysis.ts의 같은 주석 참고)
 * 이 상수를 바꾸기 전에 대상 모델이 0을 받는지 확인할 것.
 */
const ECONOMIC_EVENT_MODEL: ActiveModelId = GEMINI_2_5_FLASH_LITE_MODEL;

/**
 * Build a deterministic hash of the economic-event input for cache-key use.
 *
 * Serializes fields in a FIXED order (region → event → impact → actual →
 * estimate → previous → unit) so the hash does not depend on the caller's
 * property insertion order.
 *
 * @internal
 */
function hashEconomicEventInput(input: EconomicEventAnalysisInput): string {
    return hashAnalysisInput(
        JSON.stringify({
            // 국가가 이름에 없는 발표(`Interest Rate Decision`, `CPI YoY`)는 두
            // 경제권에서 문자열이 완전히 같다. region이 키에 없으면 미국 해설이
            // 한국 이벤트에 그대로 캐시 히트되어, 프롬프트를 고친 의미가 사라진다.
            region: input.region,
            event: input.event,
            impact: input.impact,
            actual: input.actual,
            estimate: input.estimate,
            previous: input.previous,
            unit: input.unit,
        })
    );
}

/**
 * Run an economic-event AI analysis end-to-end: cache lookup → LLM call →
 * normalize → cache write → return.
 *
 * This is the direct (non-queued) replacement for `submitEconomicEventAnalysis`
 * + `pollEconomicEventAnalysis`. The caller awaits a single promise; no job
 * IDs, no Redis meta, no polling loop.
 *
 * Uses `callAnalysisAi` (not `callBriefingAi`) — the submit path dispatched to
 * the worker's `/analyze` endpoint, not `/briefing`. The model is fixed at
 * `gemini-2.5-flash-lite` with reasoning off (short structured classification task).
 *
 * Economic-event analysis has no usage gate — no tier, no BYOK, no quota check
 * or record. The analysis is public-economy data, same as congress trade analysis.
 *
 * Concurrent calls for the same `cacheKey` are deduplicated via
 * {@link dedupeInFlight}: only one LLM call fires; all waiting callers
 * receive the same result.
 *
 * Pass `options.signal` so a dropped connection aborts the in-flight LLM call.
 *
 * @throws {Error} If the AI provider call fails (network, 5xx, AbortError).
 *
 */
export async function runEconomicEventAnalysis(
    input: EconomicEventAnalysisInput,
    options?: RunEconomicEventAnalysisOptions
): Promise<RunEconomicEventAnalysisResult> {
    const inputHash = hashEconomicEventInput(input);
    const cacheKey = buildEconomicEventCacheKey(inputHash);

    const cache = createCacheProvider();
    if (cache !== null) {
        try {
            const cached = await cache.get<unknown>(cacheKey);
            if (cached !== null) {
                return {
                    status: 'cached',
                    result: normalizeEconomicEventAnalysis(cached),
                };
            }
        } catch (error) {
            console.error(
                '[RunEconomicEventAnalysis] Cache read failed:',
                error
            );
        }
    }

    // This builder has no skills catalog and no separate system prompt —
    // `stable` is always '' (Design C), so `prompt` is `dynamic` alone.
    const { dynamic } = buildEconomicEventAnalysisPrompt(input);
    const prompt = dynamic;

    const raw = await dedupeInFlight(cacheKey, () =>
        callAnalysisAi({
            prompt,
            model: ECONOMIC_EVENT_MODEL,
            signal: options?.signal,
            seed: analysisSeed(prompt),
            // 짧은 구조화 분류(sentiment + 두 문장)라 추론 이득이 없다.
            // 모델 스펙을 오버라이드하므로 ECONOMIC_EVENT_MODEL이 thinking
            // 모델로 바뀌어도 이 경로는 꺼진 상태를 유지한다.
            reasoning: false,
            correlationId: `economic-event:${input.event}`,
        })
    );

    // raw를 미리 JSON.parse하지 않는다 — 이 normalize 함수는 parseLlmPayload로
    // 코드펜스 제거·파싱·garbage 방어를 스스로 수행한다. 앞에서 파싱하면 LLM이
    // 비-JSON을 뱉었을 때 예외가 호출자까지 올라가 그 방어가 무력해진다
    // (구 poll* 경로도 파싱하지 않고 그대로 넘겼다).
    const result = normalizeEconomicEventAnalysis(raw);

    if (cache !== null) {
        // Fire-and-forget: cache write must not delay the response.
        cache
            .set(cacheKey, result, ECONOMIC_EVENT_CACHE_TTL)
            .catch(error =>
                console.error(
                    '[RunEconomicEventAnalysis] Cache write failed:',
                    error
                )
            );
    }

    // Usage invariant: economic-event analysis has no usage gate — no quota check
    // or record (public economy data, same as congress trend analysis).
    return { status: 'done', result };
}
