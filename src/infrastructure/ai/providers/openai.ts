import type { ChatGPTModelSpec, ChatGptReasoningConfig } from '@/domain/types';
import { resolveReasoningConfig } from '@/domain/types';
import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
import { AI_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import OpenAI from 'openai';
import type { ChatGPTModelId } from '@/domain/analysis/modelSpecs';
import { extractOpenAIUsage, logUsage } from '@/infrastructure/ai/usage';

const CHATGPT_TIMEOUT_MS = 3600_000;

/**
 * `status: 'failed'` 응답의 `error.code` 중 일시적(transient) 서버 측 실패로 간주해
 * 재시도해도 의미가 있는 코드 집합.
 *
 * 그 외(invalid_prompt, invalid_image* 등 schema/validation/content 실패)는 결정론적이라
 * 재시도해도 동일하게 실패하므로 non-retryable로 둔다.
 *
 * 코드 문자열은 OpenAI SDK의 `ResponseError['code']` 유니온에서 가져온다 — 타입이 좁아서
 * 직접 union을 import하지 않고 런타임 문자열 비교로 방어적으로 매칭한다.
 */
const TRANSIENT_RESPONSE_ERROR_CODES: ReadonlySet<string> = new Set([
    'server_error',
    'rate_limit_exceeded',
    'vector_store_timeout',
]);

function isTransientResponseErrorCode(
    code: string | null | undefined
): boolean {
    // OpenAI's SDK reports `error.code` as `string | null`; accept null and use
    // a loose null check so a null code is treated as non-transient (fail fast).
    return code != null && TRANSIENT_RESPONSE_ERROR_CODES.has(code);
}

const clientCache = new Map<string, OpenAI>();

function getClient(apiKey: string): OpenAI {
    let client = clientCache.get(apiKey);
    if (!client) {
        client = new OpenAI({ apiKey });
        clientCache.set(apiKey, client);
    }
    return client;
}

export interface ChatGPTCallOptions {
    /** 호출에 사용할 GPT 모델. */
    model: ChatGPTModelId;
    /** 호출에 사용할 API key. user 키 또는 server 키. */
    apiKey: string;
    /**
     * 추론 설정 오버라이드. 미지정 시 스펙의 기본 상태(`reasoning.default`)를
     * 해석해 적용한다.
     */
    reasoning?: ChatGptReasoningConfig;
    /** 외부에서 전달되는 abort signal. */
    signal?: AbortSignal;
    /** 호출별 system 프롬프트. 미지정 시 AI_SYSTEM_PROMPT 사용. */
    system?: string;
    /**
     * core가 전달하는 canonical JSON Schema (strict-호환).
     * 지정 시 strict `json_schema` 구조화 출력을 강제한다. 미지정 시 `json_object` 모드 유지.
     */
    responseSchema?: unknown;
    /**
     * 로깅 상관관계 ID. 지정 시에만 `[Usage]` 텔레메트리 라인을 남긴다
     * (미지정 — 예: 단위 테스트 직접 호출 — 시 조용히 스킵).
     */
    jobId?: string;
}

export async function callChatGPT(
    prompt: string,
    options: ChatGPTCallOptions
): Promise<string> {
    const { model, apiKey } = options;
    const client = getClient(apiKey);
    const spec = MODEL_SPECS[model] as ChatGPTModelSpec | undefined;
    if (!spec) {
        throw new Error(`[ChatGPT] Unknown model: ${model}`);
    }
    // ChatGPT's automatic prompt caching keys on an identical byte-for-byte
    // prefix formed by `instructions` (system, design C) + this `prompt`.

    // 스펙이 OFF/ON 두 상태를 모두 들고 있으므로, 호출자가 준 설정이 없으면
    // 기본 상태를 해석한다. GPT는 "추론 없음"을 effort 값(`'none'`)으로
    // 표현하므로 별도의 non-reasoning 분기가 필요 없다 — 단, 모든 모델이
    // `'none'`을 받는 건 아니다(`gpt-6-astra`는 400). 모델별 최저값은 스펙의
    // `reasoning.off`에 기록돼 있다.
    const useEffort = (
        options.reasoning ?? resolveReasoningConfig(spec.reasoning, undefined)
    ).effort;

    // 이미 취소된 signal은 'abort' 이벤트를 다시 쏘지 않으므로 아래 리스너만으로는 전파되지
    // 않는다 — 요청을 보내기 전에 여기서 끊는다(재시도 대상 아님: status·retryable 없음).
    options.signal?.throwIfAborted();
    const controller = new AbortController();
    // .unref()로 timer가 event loop를 점유하지 않게 하여 정상 종료를 막지 않도록 한다.
    const timeoutId = setTimeout(
        () => controller.abort(),
        CHATGPT_TIMEOUT_MS
    ).unref();
    const propagateAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', propagateAbort, { once: true });

    const start = Date.now();
    try {
        const response = await client.responses.create(
            {
                model: spec.apiModelId,
                instructions: options.system ?? AI_SYSTEM_PROMPT,
                input: prompt,
                max_output_tokens: spec.maxOutputTokens,
                text: {
                    format:
                        options.responseSchema !== undefined
                            ? {
                                  type: 'json_schema',
                                  name: 'analysis_response',
                                  strict: true,
                                  schema: options.responseSchema as Record<
                                      string,
                                      unknown
                                  >,
                              }
                            : { type: 'json_object' },
                },
                reasoning: { effort: useEffort },
            },
            { signal: controller.signal }
        );

        const elapsed = Date.now() - start;
        const status = response.status;

        console.log(
            `[ChatGPT] Response time: ${elapsed}ms (model: ${model}, status: ${status})`
        );

        if (options.jobId !== undefined) {
            logUsage({
                jobId: options.jobId,
                model,
                ...extractOpenAIUsage(response.usage),
                latencyMs: elapsed,
            });
        }

        if (status === 'completed') {
            const text = response.output_text;
            if (text) {
                return text;
            }
            console.warn('[ChatGPT] Empty text response', { model, status });
            throw Object.assign(
                new Error(
                    `ChatGPT returned an empty text response (status: ${status})`
                ),
                { retryable: true }
            );
        }

        if (status === 'incomplete') {
            const reason = response.incomplete_details?.reason;
            if (reason === 'max_output_tokens') {
                // max_output_tokens 초과 — 재시도해도 동일하게 실패한다.
                console.warn('[ChatGPT] MAX_TOKENS: output truncated', {
                    model,
                    status,
                });
                throw new Error(
                    `ChatGPT hit output token limit (model: ${model})`
                );
            }
            if (reason === 'content_filter') {
                console.error('[ChatGPT] Response blocked by content filter', {
                    model,
                    status,
                });
                throw new Error(
                    `ChatGPT blocked response by content filter (reason: ${reason})`
                );
            }
            // 알 수 없는 incomplete reason → 일시적 문제로 재시도
            console.warn('[ChatGPT] Incomplete response', {
                model,
                status,
                reason,
            });
            throw Object.assign(
                new Error(`ChatGPT incomplete response (reason: ${reason})`),
                { retryable: true }
            );
        }

        if (status === 'failed') {
            console.error('[ChatGPT] Response failed', {
                model,
                status,
                error: response.error,
            });
            // status: 'failed'을 무조건 재시도하면 schema/validation/content 실패처럼
            // 결정론적인(non-transient) 실패도 5×backoff로 재시도되어 비용만 태운다.
            // → error.code를 보고 일시적 서버 측 실패만 retryable로 분류한다.
            // (claude/gemini의 non-retryable 분류 패턴과 동일하게 plain Error로 throw.)
            const errorCode = response.error?.code;
            const message = `ChatGPT response failed (model: ${model}, code: ${errorCode ?? 'unknown'})`;
            if (isTransientResponseErrorCode(errorCode)) {
                throw Object.assign(new Error(message), { retryable: true });
            }
            // schema/validation/content 등 결정론적 실패 → 재시도 금지(plain Error).
            throw new Error(message);
        }

        // in_progress / queued / cancelled 등은 일시적 문제일 수 있어 재시도.
        console.warn('[ChatGPT] Unexpected response status', { model, status });
        throw Object.assign(
            new Error(`Unexpected ChatGPT response status: ${status}`),
            { retryable: true }
        );
    } finally {
        clearTimeout(timeoutId);
        options.signal?.removeEventListener('abort', propagateAbort);
    }
}
