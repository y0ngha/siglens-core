import {
    callClaude,
    type EffortLevel,
} from '@/infrastructure/ai/providers/anthropic';
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
    effort?: EffortLevel;
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
        effort,
        system,
        responseSchema,
        jobId,
    } = options;
    return withRetry(
        () =>
            callClaude(prompt, {
                model,
                apiKey,
                effort,
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
