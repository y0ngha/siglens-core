import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
import { AI_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import type { DeepSeekModelSpec } from '@/domain/types';
import OpenAI from 'openai';
import type { DeepSeekModelId } from '@/domain/analysis/modelSpecs';
import { extractDeepSeekUsage, logUsage } from '@/infrastructure/ai/usage';
import type { DeepSeekUsageLike } from '@/infrastructure/ai/usage';

// 1h — matches the sibling adapters' analysis timeout
// (CHATGPT_TIMEOUT_MS / GEMINI_TIMEOUT_MS / CLAUDE_TIMEOUT_MS all = 3600_000).
const DEEPSEEK_TIMEOUT_MS = 3600_000;
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

/**
 * DeepSeek-specific top-level body field. Non-standard for the `openai` SDK's
 * `ChatCompletionCreateParams` types — DeepSeek toggles reasoning via this
 * field instead of OpenAI's `reasoning.effort`. Declared as an intersection
 * type on the request params (not a broad `as any` cast) so the rest of the
 * request keeps normal SDK type-checking.
 */
interface DeepSeekThinkingConfig {
    type: 'enabled' | 'disabled';
    /** Only meaningful when `type: 'enabled'`. We only ever request 'high'. */
    reasoning_effort?: 'high';
}

// STREAMING is mandatory: DeepSeek terminates long non-streaming
// chat.completions connections at ~50-60s (empirically confirmed — a 64.7KB
// analysis prompt producing long structured JSON fails with `terminated`,
// while the identical request with stream:true completes cleanly). Mirrors
// claude.ts, which also streams (messages.stream()). We build on the SDK's
// streaming params type so `stream: true` is part of the contract.
type DeepSeekChatCompletionCreateParams =
    OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming & {
        thinking: DeepSeekThinkingConfig;
    };

const clientCache = new Map<string, OpenAI>();

function getClient(apiKey: string): OpenAI {
    let client = clientCache.get(apiKey);
    if (!client) {
        client = new OpenAI({ apiKey, baseURL: DEEPSEEK_BASE_URL });
        clientCache.set(apiKey, client);
    }
    return client;
}

export interface DeepSeekCallOptions {
    /** 호출에 사용할 DeepSeek 모델. */
    model: DeepSeekModelId;
    /** 호출에 사용할 API key. user 키 또는 server 키. */
    apiKey: string;
    /**
     * Reasoning toggle override (spec §A.2). 미지정 시 `spec.thinking`을 그대로
     * 사용한다(기존 동작, backward-compatible). 지정 시 spec을 오버라이드한다 —
     * deepseek은 ON(true)에서도 오버라이드 대상이다(다른 provider와 달리 spec.thinking:false
     * 모델도 reasoning:true로 강제 활성화해야 하기 때문).
     */
    thinking?: boolean;
    /** 외부에서 전달되는 abort signal. */
    signal?: AbortSignal;
    /** 호출별 system 프롬프트. 미지정 시 AI_SYSTEM_PROMPT 사용. */
    system?: string;
    /**
     * core가 전달하는 canonical JSON Schema.
     * DeepSeek은 OpenAI의 strict `json_schema` 모드를 지원하지 않으므로 이 필드는
     * 출력을 제약하는 데 사용되지 않는다 — 분석 프롬프트가 이미 출력 형식을 설명한다.
     * ChatGPT/Gemini/Claude 어댑터와의 호출 시그니처 대칭을 위해서만 받는다.
     */
    responseSchema?: unknown;
    /**
     * 로깅 상관관계 ID. 지정 시에만 `[Usage]` 텔레메트리 라인을 남긴다
     * (미지정 — 예: 단위 테스트 직접 호출 — 시 조용히 스킵).
     */
    jobId?: string;
}

export async function callDeepSeek(
    prompt: string,
    options: DeepSeekCallOptions
): Promise<string> {
    const { model, apiKey } = options;
    const client = getClient(apiKey);
    const spec = MODEL_SPECS[model] as DeepSeekModelSpec | undefined;
    if (!spec) {
        throw new Error(`[DeepSeek] Unknown model: ${model}`);
    }

    const controller = new AbortController();
    // .unref()로 timer가 event loop를 점유하지 않게 하여 정상 종료를 막지 않도록 한다.
    const timeoutId = setTimeout(
        () => controller.abort(),
        DEEPSEEK_TIMEOUT_MS
    ).unref();
    const propagateAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', propagateAbort, { once: true });

    // Mirrors claude.ts/chatgpt.ts/gemini.ts: falls back to AI_SYSTEM_PROMPT
    // when no per-call system prompt is supplied, so a system message is
    // always present.
    const systemText = options.system ?? AI_SYSTEM_PROMPT;
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system' as const, content: systemText },
        { role: 'user' as const, content: prompt },
    ];

    // reasoning toggle override (spec §A.2): options.thinking, when provided,
    // overrides spec.thinking — undefined falls back to the model spec
    // (existing/backward-compatible behavior).
    const useThinking = options.thinking ?? spec.thinking;

    const params: DeepSeekChatCompletionCreateParams = {
        model: spec.apiModelId,
        messages,
        max_tokens: spec.maxOutputTokens,
        response_format: { type: 'json_object' },
        thinking: useThinking
            ? { type: 'enabled', reasoning_effort: 'high' }
            : { type: 'disabled' },
        // thinking mode ignores temperature — only applied in non-thinking mode.
        ...(!useThinking && { temperature: spec.temperature }),
        stream: true,
        // Deliver a final usage-only chunk so telemetry keeps working under streaming.
        stream_options: { include_usage: true },
    };

    const start = Date.now();
    try {
        const stream = await client.chat.completions.create(params, {
            signal: controller.signal,
        });

        // Aggregate the streamed deltas into the full response. Streaming is
        // required (see the type comment) — the connection stays alive as tokens
        // flow, avoiding DeepSeek's ~50-60s non-streaming termination.
        let text = '';
        let finishReason: string | null | undefined;
        let usage: DeepSeekUsageLike | undefined;
        for await (const chunk of stream) {
            const choice = chunk.choices?.[0];
            if (choice?.delta?.content) {
                text += choice.delta.content;
            }
            if (choice?.finish_reason) {
                finishReason = choice.finish_reason;
            }
            // The final chunk (choices empty) carries usage when include_usage is set.
            if (chunk.usage) {
                usage = chunk.usage as DeepSeekUsageLike;
            }
        }

        const elapsed = Date.now() - start;

        console.log(
            `[DeepSeek] Response time: ${elapsed}ms (model: ${model}, finish_reason: ${finishReason})`
        );

        if (options.jobId !== undefined) {
            logUsage({
                jobId: options.jobId,
                model,
                ...extractDeepSeekUsage(usage),
                latencyMs: elapsed,
            });
        }

        if (finishReason === 'stop') {
            if (text) {
                return text;
            }
            // Documented DeepSeek quirk: json_object mode occasionally returns
            // empty content — retryable, the retry wrapper handles it.
            console.warn('[DeepSeek] Empty text response', {
                model,
                finishReason,
            });
            throw Object.assign(
                new Error(
                    `DeepSeek returned an empty text response (finish_reason: ${finishReason})`
                ),
                { retryable: true }
            );
        }

        if (finishReason === 'length') {
            // max_tokens 초과 — 재시도해도 동일하게 실패한다.
            console.warn('[DeepSeek] MAX_TOKENS: output truncated', {
                model,
                finishReason,
            });
            throw new Error(
                `DeepSeek hit output token limit (model: ${model})`
            );
        }

        if (finishReason === 'content_filter') {
            console.error('[DeepSeek] Response blocked by content filter', {
                model,
                finishReason,
            });
            throw new Error(
                `DeepSeek blocked response by content filter (finish_reason: ${finishReason})`
            );
        }

        // tool_calls/function_call/null/기타 예상치 못한 사유는 일시적 문제로 보고 재시도.
        console.warn('[DeepSeek] Unexpected finish_reason', {
            model,
            finishReason,
        });
        throw Object.assign(
            new Error(`Unexpected DeepSeek finish_reason: ${finishReason}`),
            { retryable: true }
        );
    } finally {
        clearTimeout(timeoutId);
        options.signal?.removeEventListener('abort', propagateAbort);
    }
}
