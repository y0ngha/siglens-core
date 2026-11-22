import { constants } from 'node:http2';
import { callDeepSeek } from '@/infrastructure/ai/providers/deepseek';
import type { ErrorKind } from '@/infrastructure/ai/retry/withRetry';
import type { DeepSeekModelId } from '@/domain/analysis/modelSpecs';
import type { DeepSeekReasoningConfig } from '@/domain/types';
import {
    AI_RETRY_DELAY_MS,
    AI_RETRY_MAX_ATTEMPTS,
    classifyError,
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
 * DeepSeek 분류기. 클라이언트를 `maxRetries: 0`으로 만들어 SDK 재시도가 없으므로,
 * SDK가 재시도하던 조건 중 `classifyError`가 놓치는 408(요청 타임아웃)과 409(락
 * 타임아웃)를 여기서 받는다. 429/5xx는 `classifyError`가, 연결 오류·타임아웃은
 * `callDeepSeek`가 붙이는 `retryable`을 `classifyError`가 받는다.
 */
export function classifyDeepSeekError(error: unknown): ErrorKind {
    if (typeof error === 'object' && error !== null && 'status' in error) {
        const { status } = error as { status: unknown };
        if (
            status === constants.HTTP_STATUS_REQUEST_TIMEOUT ||
            status === constants.HTTP_STATUS_CONFLICT
        ) {
            return 'server_error';
        }
    }
    return classifyError(error);
}

/**
 * 429/5xx(+408/409, 연결 오류) 재시도를 결합한 DeepSeek 호출. 클라이언트는 SDK 재시도를
 * 끄므로(`maxRetries: 0`) 재시도 층은 이 `withRetry` 하나다.
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
            signal,
            classify: classifyDeepSeekError,
        }
    );
}
