import { callDeepSeek } from '@/infrastructure/ai/providers/deepseek';
import type { DeepSeekModelId } from '@/domain/analysis/modelSpecs';
import type { DeepSeekReasoningConfig } from '@/domain/types';
import {
    AI_RETRY_DELAY_MS,
    AI_RETRY_MAX_ATTEMPTS,
    withRetry,
} from '@/infrastructure/ai/retry/withRetry';

export interface DeepSeekWithRetryOptions {
    maxAttempts?: number;
    signal?: AbortSignal;
    abortIfCumulativeDelayReachesMs?: number;
    /** 추론 설정 오버라이드. 미지정 시 모델 스펙의 기본 상태가 적용된다. */
    reasoning?: DeepSeekReasoningConfig;
    system?: string;
    responseSchema?: unknown;
    jobId?: string;
}

/**
 * 429/5xx 재시도를 결합한 DeepSeek 호출.
 * Provider별 retry 모듈은 동일한 패턴 — ChatGPT/Gemini/Claude의 retry 모듈과 대칭.
 * DeepSeek은 thinking이 model spec의 boolean 고정값이라(런타임 조정 대상 아님) budget
 * 축소 로직 없이 단순 withRetry로 래핑한다 (ChatGPT와 동일).
 */
export async function callDeepSeekWithRetry(
    prompt: string,
    model: DeepSeekModelId,
    apiKey: string,
    options: DeepSeekWithRetryOptions = {}
): Promise<string> {
    const {
        maxAttempts = AI_RETRY_MAX_ATTEMPTS,
        signal,
        abortIfCumulativeDelayReachesMs,
        reasoning,
        system,
        responseSchema,
        jobId,
    } = options;
    return withRetry(
        () =>
            callDeepSeek(prompt, {
                model,
                apiKey,
                reasoning,
                signal,
                system,
                responseSchema,
                jobId,
            }),
        {
            maxAttempts,
            baseDelayMs: AI_RETRY_DELAY_MS,
            abortIfCumulativeDelayReachesMs,
        }
    );
}
