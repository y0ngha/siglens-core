import type { CallAnalysisAiOptions } from '@/application/analysis/types';
import { MODEL_SPECS, supportsHardOff } from '@/domain/analysis/modelSpecs';
import type { ModelSpec } from '@/domain/types';
import { resolveReasoningConfig } from '@/domain/types';
import type {
    ChatGPTModelId,
    ClaudeModelId,
    DeepSeekModelId,
    GeminiModelId,
} from '@/domain/analysis/modelSpecs';
import { shouldUseServerKey } from '@/domain/keyRouting';
import { getProviderForModel } from '@/domain/llm/providers';
import { normalizeJsonResponse } from '@/infrastructure/ai/normalizeJsonResponse';
import { callClaudeWithRetry } from '@/infrastructure/ai/retry/anthropicRetry';
import { callDeepSeekWithRetry } from '@/infrastructure/ai/retry/deepseekRetry';
import { callGeminiWithRetry } from '@/infrastructure/ai/retry/geminiRetry';
import { callChatGPTWithRetry } from '@/infrastructure/ai/retry/openaiRetry';
import { resolveServerApiKey } from '@/infrastructure/ai/serverKeys';

/**
 * 비용/CPU 안전 상한 — provider가 5xx/429로 지속 degrade할 때 누적 재시도 지연을 제한한다.
 *
 * ⚠️ 이 cap은 **Gemini·DeepSeek 경로에만** 적용된다. Claude/ChatGPT는
 * `abortIfCumulativeDelayReachesMs` 없이 호출되어 의도적으로 `withRetry`의 default 5분
 * 상한을 유지한다 — 원래도 Gemini 전용 cap이었다. 향후 유지보수자가 "누락된 cap"으로
 * 오인해 Claude/ChatGPT에 추가하지 않도록 명시한다.
 */
const ANALYSIS_MAX_RETRY_DELAY_MS = 30_000;

/**
 * Models already warned about via {@link warnPartialHardOff}, so a batch of
 * calls on the same model logs once instead of once per item.
 */
const warnedPartialHardOffModels = new Set<string>();

/**
 * Log, at most once per model, that `reasoning: false` could not fully disable
 * reasoning.
 *
 * The call still succeeds — the model runs at the lowest strength it accepts —
 * but it keeps spending thinking tokens, so a caller that assumed "off means
 * zero" would be wrong about both cost and latency.
 *
 * @param model - A model whose spec sets `hardOff: false`.
 */
function warnPartialHardOff(model: string): void {
    if (warnedPartialHardOffModels.has(model)) return;
    warnedPartialHardOffModels.add(model);
    console.warn(
        `[callAnalysisAi] reasoning:false only partially honored — "${model}" cannot disable reasoning; using its lowest supported level instead.`
    );
}

/** @internal Test helper — clears the once-per-model warning set. */
export function _resetPartialHardOffWarningsForTest(): void {
    warnedPartialHardOffModels.clear();
}

/**
 * 분석용 AI 호출 — provider 라우팅, `reasoning` 해석, 재시도, JSON 정규화를 포함한다.
 *
 * `reasoning`은 provider별로 번역되지 않는다. 각 모델 스펙이 두 상태를 모두
 * 들고 있고(`ReasoningModes`), `resolveReasoningConfig`가 그중 하나를 골라
 * 어댑터에 그대로 넘긴다:
 *
 * - `reasoning === false` → `spec.reasoning.off`
 * - `reasoning === true` → `spec.reasoning.on`
 * - `reasoning === undefined` → `spec.reasoning.default`가 가리키는 쪽
 *
 * ⚠️ `false`가 "추론 없음"을 보장하지는 않는다. 일부 모델은 완전 비활성이
 * 불가능해 `off`가 최저 강도일 뿐이며, 그 경우 모델당 1회 경고를 남긴다
 * (`supportsHardOff` 참고).
 */
export async function callAnalysisAi(
    options: CallAnalysisAiOptions
): Promise<string> {
    const {
        prompt,
        model,
        tier,
        userApiKey,
        signal,
        system,
        responseSchema,
        seed,
        reasoning,
        correlationId,
    } = options;

    const useServerKey = shouldUseServerKey(model, tier);
    const apiKey = useServerKey
        ? resolveServerApiKey(getProviderForModel(model))
        : userApiKey;

    if (apiKey === undefined) {
        throw new Error(
            'User API key required for this model and tier combination'
        );
    }

    // 추론 OFF를 요청했지만 모델이 완전히 끄지 못하는 경우(`hardOff: false`)를
    // 모델당 한 번 알린다. 요청은 성공하되 사고 토큰이 계속 소비된다.
    if (reasoning === false && !supportsHardOff(model)) {
        warnPartialHardOff(model);
    }

    const raw = await dispatch();
    if (raw.trim() === '') {
        throw new Error('AI returned an empty response');
    }
    return normalizeJsonResponse(raw);

    function dispatch(): Promise<string> {
        // apiKey는 위 가드에서 이미 narrowing됐다.
        const key = apiKey as string;
        // 스펙이 OFF/ON 두 상태를 모두 들고 있어 provider별 번역 분기가 필요 없다.
        // `resolveReasoningConfig`가 호출자의 `reasoning`(또는 스펙 기본)을 해석해
        // 그 provider가 이해하는 설정을 그대로 돌려준다. 이 덕분에
        // `reasoning === true`가 전 provider에서 스펙을 오버라이드한다 — 예전에는
        // DeepSeek만 그랬고, 그래서 스펙 기본이 OFF가 되면 토글을 켜도 아무 일도
        // 일어나지 않았다.
        const spec: ModelSpec = MODEL_SPECS[model];

        switch (spec.provider) {
            case 'claude':
                return callClaudeWithRetry(
                    prompt,
                    model as ClaudeModelId,
                    key,
                    {
                        signal,
                        system,
                        responseSchema,
                        jobId: correlationId,
                        reasoning: resolveReasoningConfig(
                            spec.reasoning,
                            reasoning
                        ),
                    }
                );
            case 'chatgpt':
                return callChatGPTWithRetry(
                    prompt,
                    model as ChatGPTModelId,
                    key,
                    {
                        signal,
                        system,
                        responseSchema,
                        jobId: correlationId,
                        reasoning: resolveReasoningConfig(
                            spec.reasoning,
                            reasoning
                        ),
                    }
                );
            case 'gemini':
                return callGeminiWithRetry(
                    prompt,
                    model as GeminiModelId,
                    key,
                    {
                        signal,
                        abortIfCumulativeDelayReachesMs:
                            ANALYSIS_MAX_RETRY_DELAY_MS,
                        system,
                        responseSchema,
                        seed,
                        jobId: correlationId,
                        levelRef: {
                            current: resolveReasoningConfig(
                                spec.reasoning,
                                reasoning
                            ).level,
                        },
                    }
                );
            case 'deepseek':
                return callDeepSeekWithRetry(
                    prompt,
                    model as DeepSeekModelId,
                    key,
                    {
                        signal,
                        // DeepSeek은 free/server-key 모델(모든 tier 사용 가능)이라 Gemini free
                        // 경로와 동일한 리스크 프로파일 — 같은 30s cap을 적용한다.
                        abortIfCumulativeDelayReachesMs:
                            ANALYSIS_MAX_RETRY_DELAY_MS,
                        system,
                        responseSchema,
                        jobId: correlationId,
                        reasoning: resolveReasoningConfig(
                            spec.reasoning,
                            reasoning
                        ),
                    }
                );
        }
    }
}
