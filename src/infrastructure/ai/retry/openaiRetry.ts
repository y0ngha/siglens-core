import type { EffortLevel } from '@/domain/types';
import { callChatGPT } from '@/infrastructure/ai/providers/openai';
import type { ChatGPTModelId } from '@/domain/analysis/modelSpecs';
import {
    AI_RETRY_DELAY_MS,
    AI_RETRY_MAX_ATTEMPTS,
    withRetry,
} from '@/infrastructure/ai/retry/withRetry';

export interface ChatGPTWithRetryOptions {
    maxAttempts?: number;
    signal?: AbortSignal;
    abortIfCumulativeDelayReachesMs?: number;
    /** Reasoning toggle override (spec §A.2) — forwarded to `callChatGPT`. */
    effort?: EffortLevel;
    system?: string;
    responseSchema?: unknown;
    jobId?: string;
}

/**
 * 429/5xx 재시도를 결합한 ChatGPT 호출.
 * Provider별 retry 모듈은 동일한 패턴 — Gemini/Claude의 retry 모듈과 대칭.
 * ChatGPT는 thinking budget 개념이 없어 budget 축소 로직 없이 단순 withRetry로 래핑한다.
 */
export async function callChatGPTWithRetry(
    prompt: string,
    model: ChatGPTModelId,
    apiKey: string,
    options: ChatGPTWithRetryOptions = {}
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
            callChatGPT(prompt, {
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
