import type { CallAnalysisAiOptions } from '@/application/analysis/types';
import {
    DISABLED_THINKING_BUDGET,
    MODEL_SPECS,
    supportsDisabledThinking,
} from '@/domain/analysis/modelSpecs';
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
 * Models already warned about via {@link warnUnsupportedDisabledThinking}, so a
 * batch of calls on the same model logs once instead of once per item.
 */
const warnedDisabledThinkingModels = new Set<string>();

/**
 * Log, at most once per model, that `reasoning: false` could not be honored.
 *
 * @param model - The Gemini model that rejects a literal `thinkingBudget: 0`.
 */
function warnUnsupportedDisabledThinking(model: string): void {
    if (warnedDisabledThinkingModels.has(model)) return;
    warnedDisabledThinkingModels.add(model);
    console.warn(
        `[callAnalysisAi] reasoning:false ignored — "${model}" rejects a disabled thinking budget; falling back to its spec default.`
    );
}

/** @internal Test helper — clears the once-per-model warning set. */
export function _resetDisabledThinkingWarningsForTest(): void {
    warnedDisabledThinkingModels.clear();
}

/**
 * 분석용 AI 호출 — provider 라우팅, `reasoning` 번역, 재시도, JSON 정규화를 포함한다.
 *
 * `reasoning` boolean → per-provider translation (provider 어댑터로 디스패치하기 전 중앙 번역):
 *
 * - `reasoning === false` (MINIMIZE): deepseek → thinking:false / gemini →
 *   thinkingBudget:0 / claude·gpt → effort:'low'. 모델 스펙을 **오버라이드**한다
 *   (thinking 모델인 deepseek 스펙도 강제로 꺼진다).
 * - `reasoning === true` (ENABLE): deepseek → thinking:true (스펙 오버라이드 —
 *   deepseek-v4-flash처럼 spec.thinking:false인 모델도 켠다). gemini/claude/gpt는
 *   **오버라이드 없음** — 이미 스펙 강도로 추론하므로 스펙 기본이 그대로 적용된다.
 * - `reasoning === undefined`: 어디에도 오버라이드 없음 — 토글 도입 이전 동작
 *   (스펙 기본 / 호출자가 준 thinkingBudget)을 정확히 보존한다.
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
        thinkingBudget,
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

    // reasoning===false 만 최소화 effort로 번역한다 — true/undefined는 스펙 기본 유지(무개입).
    const minimizeEffort = reasoning === false;

    const raw = await dispatch();
    if (raw.trim() === '') {
        throw new Error('AI returned an empty response');
    }
    return normalizeJsonResponse(raw);

    function dispatch(): Promise<string> {
        // apiKey는 위 가드에서 이미 narrowing됐다.
        const key = apiKey as string;

        switch (MODEL_SPECS[model].provider) {
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
                        ...(minimizeEffort && { effort: 'low' as const }),
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
                        ...(minimizeEffort && { effort: 'low' as const }),
                    }
                );
            case 'gemini': {
                // reasoning===false는 thinkingBudget을 강제로 0(DISABLED_THINKING_BUDGET)으로
                // 눌러 호출자가 요청한 thinkingBudget보다 우선한다 — OFF는 완전 비활성이어야
                // 하기 때문이다. reasoning===true/undefined는 기존 동작(thinkingBudget 있으면
                // 사용, 없으면 스펙 기본)을 그대로 유지한다.
                //
                // 단, 리터럴 0을 400("This model only works in thinking mode")으로
                // 거부하는 Gemini 모델이 있다(`supportsDisabledThinking`). 그런
                // 모델에 0을 보내면 요청 자체가 죽으므로 스펙 기본으로 폴백하고
                // 모델당 1회 경고한다 — 추론이 조금 켜진 채로 응답하는 편이
                // 전 호출 400보다 낫다. 이 분기는 사용자가 모델과 추론 토글을
                // 모두 고르는 경로(옵션·펀더멘털·재무 등)에서 실제로 열린다.
                const canDisableThinking = supportsDisabledThinking(model);
                if (minimizeEffort && !canDisableThinking) {
                    warnUnsupportedDisabledThinking(model);
                }
                const budgetRef =
                    minimizeEffort && canDisableThinking
                        ? { current: DISABLED_THINKING_BUDGET }
                        : thinkingBudget !== undefined
                          ? { current: thinkingBudget }
                          : undefined;
                return callGeminiWithRetry(
                    prompt,
                    model as GeminiModelId,
                    key,
                    {
                        signal,
                        abortIfCumulativeDelayReachesMs:
                            ANALYSIS_MAX_RETRY_DELAY_MS,
                        budgetRef,
                        system,
                        responseSchema,
                        seed,
                        jobId: correlationId,
                    }
                );
            }
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
                        // deepseek만 reasoning===true도 번역 대상이다: OFF(false)는 최소화,
                        // ON(true)은 spec.thinking을 오버라이드해 강제 활성화한다(다른 provider와
                        // 달리 ON에서도 개입 — deepseek-v4-flash처럼 spec.thinking:false인 모델도
                        // 켜야 함). reasoning===undefined면 thinking:undefined가 전달되어
                        // deepseek 어댑터의 `options.thinking ?? spec.thinking` 폴백으로 스펙
                        // 기본이 그대로 유지된다.
                        thinking: reasoning,
                    }
                );
        }
    }
}
