import {
    MODEL_SPECS,
    getThinkingLevelSequence,
} from '@/domain/analysis/modelSpecs';
import {
    callGemini,
    MAX_TOKENS_CODE,
} from '@/infrastructure/ai/providers/gemini';
import type { GeminiModelId } from '@/domain/analysis/modelSpecs';
import type { GeminiModelSpec, GeminiThinkingLevel } from '@/domain/types';
import { resolveReasoningConfig } from '@/domain/types';
import {
    AI_RETRY_DELAY_MS,
    AI_RETRY_MAX_ATTEMPTS,
    hasErrorCode,
    withRetry,
} from '@/infrastructure/ai/retry/withRetry';

/**
 * Mutable level reference — withRetry 체인에서 낮아진 level을 보존한다.
 * 매 시도마다 `current`가 다음 level로 갱신된다.
 */
type ThinkingLevelRef = { current: GeminiThinkingLevel };

/**
 * MAX_TOKENS 발생 시 thinking level을 한 단계씩 낮추며 같은 요청을 이어서 재시도한다.
 * `levelRef.current`는 매 시도마다 업데이트되어 5xx 재시도 시 낮아진 level에서 재개한다.
 *
 * 바닥은 모델마다 다르다 — `gemini-3.8-flash` /
 * `gemini-3.1-pro-preview`는 `'minimal'`을 400으로 거부하므로 `'low'`가 한계다.
 * 그래서 시퀀스의 floor를 스펙의 OFF level에서 가져온다.
 *
 * @internal
 */
export async function callGeminiReducingLevel(
    prompt: string,
    model: GeminiModelId,
    apiKey: string,
    signal: AbortSignal | undefined,
    levelRef: ThinkingLevelRef,
    system?: string,
    responseSchema?: unknown,
    seed?: number,
    jobId?: string
): Promise<string> {
    // `as const satisfies` keeps each row's literal shape, which would make
    // `ReasoningModes<T>` infer T from `off` alone. Widen to the interface first.
    const spec: GeminiModelSpec = MODEL_SPECS[model];
    const floor = spec.reasoning.off.level;
    const levels = getThinkingLevelSequence(levelRef.current, floor);
    const levelCount = levels.length;

    for (let i = 0; i < levelCount; i++) {
        const level = levels[i];
        levelRef.current = level;
        try {
            return await callGemini(prompt, {
                apiKey,
                model,
                thinkingLevel: level,
                seed,
                signal,
                system,
                responseSchema,
                jobId,
            });
        } catch (error) {
            if (hasErrorCode(error, MAX_TOKENS_CODE)) {
                const next = levels[i + 1];
                if (next !== undefined) {
                    console.warn(
                        `[Worker] Gemini MAX_TOKENS (thinkingLevel=${level}). Retrying with level=${next}.`
                    );
                    continue;
                }
                // 최저 level에서도 MAX_TOKENS → 응답 자체가 너무 긴 경우.
                // 이 모델은 추론을 완전히 끄지 못할 수 있으므로(`hardOff: false`)
                // "thinking disabled"라고 단정하지 않는다.
                console.error(
                    `[Worker] Gemini MAX_TOKENS at the model's lowest thinking level (${level}). Response is too long.`
                );
                throw error;
            }

            // 429/5xx 등 일시적 에러 → 외부 withRetry로 전파
            // levelRef.current는 이미 현재 level로 설정되어 있음
            throw error;
        }
    }

    // getThinkingLevelSequence()는 항상 최소 한 항목을 반환하므로 루프는 return/throw로 빠져나간다.
    /* istanbul ignore next */
    throw new Error('All thinking level steps exhausted');
}

/**
 * Thinking level a model starts at when the caller expressed no preference.
 *
 * @internal
 */
function resolveDefaultThinkingLevel(
    model: GeminiModelId
): GeminiThinkingLevel {
    const spec: GeminiModelSpec = MODEL_SPECS[model];
    return resolveReasoningConfig(spec.reasoning, undefined).level;
}

export interface GeminiWithRetryOptions {
    maxAttempts?: number;
    signal?: AbortSignal;
    abortIfCumulativeDelayReachesMs?: number;
    /** 미지정 시 모델 스펙의 기본 상태에서 해석된 level로 새 참조가 생성됨 */
    levelRef?: ThinkingLevelRef;
    system?: string;
    responseSchema?: unknown;
    /** core가 디스패치하는 deterministic seed. 미지정 시 seed 미설정. */
    seed?: number;
    jobId?: string;
}

export async function callGeminiWithRetry(
    prompt: string,
    model: GeminiModelId,
    apiKey: string,
    options: GeminiWithRetryOptions = {}
): Promise<string> {
    const {
        maxAttempts = AI_RETRY_MAX_ATTEMPTS,
        signal,
        abortIfCumulativeDelayReachesMs,
        levelRef = { current: resolveDefaultThinkingLevel(model) },
        system,
        responseSchema,
        seed,
        jobId,
    } = options;
    return withRetry(
        () =>
            callGeminiReducingLevel(
                prompt,
                model,
                apiKey,
                signal,
                levelRef,
                system,
                responseSchema,
                seed,
                jobId
            ),
        {
            maxAttempts,
            baseDelayMs: AI_RETRY_DELAY_MS,
            abortIfCumulativeDelayReachesMs,
        }
    );
}
