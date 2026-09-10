import { callClaude } from '@/infrastructure/ai/providers/anthropic';
import type {
    ClaudeAdaptiveReasoningConfig,
    ClaudeBudgetReasoningConfig,
} from '@/domain/types';
import type { ClaudeModelId } from '@/domain/analysis/modelSpecs';
import {
    AI_RETRY_DELAY_MS,
    AI_RETRY_MAX_ATTEMPTS,
    withRetry,
} from '@/infrastructure/ai/retry/withRetry';

export interface ClaudeWithRetryOptions {
    maxAttempts?: number;
    signal?: AbortSignal;
    abortIfCumulativeDelayReachesMs?: number;
    /** 추론 설정 오버라이드. 미지정 시 모델 스펙의 기본 상태가 적용된다. */
    reasoning?: ClaudeAdaptiveReasoningConfig | ClaudeBudgetReasoningConfig;
    system?: string;
    responseSchema?: unknown;
    jobId?: string;
}

/**
 * 429/5xx 재시도를 포함한 Claude 호출.
 * MAX_TOKENS 시 재시도 없이 즉시 throw — 출력 한도 초과는 effort 조정으로 해결 불가.
 * Provider별 retry 모듈은 동일한 패턴 — Gemini의 `callGeminiWithRetry`와 대칭.
 */
export async function callClaudeWithRetry(
    prompt: string,
    model: ClaudeModelId,
    apiKey: string,
    options: ClaudeWithRetryOptions = {}
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
            callClaude(prompt, {
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
