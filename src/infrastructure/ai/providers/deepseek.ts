import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
import { AI_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import type {
    DeepSeekModelSpec,
    DeepSeekReasoningConfig,
} from '@/domain/types';
import { resolveReasoningConfig } from '@/domain/types';
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
     * 추론 설정 오버라이드. 미지정 시 스펙의 기본 상태(`reasoning.default`)를
     * 해석해 적용한다.
     */
    reasoning?: DeepSeekReasoningConfig;
    /** 외부에서 전달되는 abort signal. */
    signal?: AbortSignal;
    /** 호출별 system 프롬프트. 미지정 시 AI_SYSTEM_PROMPT 사용. */
    system?: string;
    /**
     * core가 전달하는 canonical JSON Schema. **주어지면 출력을 실제로 강제한다.**
     *
     * `/chat/completions`는 `response_format: json_schema`를 거부하지만
     * (`400 This response_format type is unavailable now` — V4 모델 ID로도 동일),
     * **Responses API(`POST /responses`)는 `text.format`으로 지원한다.** 그래서
     * 스키마가 있으면 그쪽으로 라우팅한다 ({@link callDeepSeekResponses}).
     *
     * 강제하지 않던 시절의 실측 피해: 30k 토큰짜리 기술 분석 프롬프트에서
     * `indicatorResults[].signals`와 `patternSummaries`가 **824건 전부 빈 배열**로
     * 돌아왔다. 같은 프롬프트를 gemini는 143건 100% 채웠고, DeepSeek도 3줄짜리
     * 짧은 프롬프트에서는 정상 생성한다 — 모델 능력이 아니라 긴 프롬프트에서
     * 지시를 놓치는 문제이고, 스키마 강제가 그것을 막는다. 같은 프롬프트로 실측:
     * `json_object` 신호 0 / `json_schema` 신호 9~17.
     */
    responseSchema?: unknown;
    /**
     * 로깅 상관관계 ID. 지정 시에만 `[Usage]` 텔레메트리 라인을 남긴다
     * (미지정 — 예: 단위 테스트 직접 호출 — 시 조용히 스킵).
     */
    jobId?: string;
}

/**
 * Responses API 스트리밍 이벤트에서 **본문만** 골라낸다.
 *
 * `output`에는 reasoning 블록이 먼저 오고 그 안의 델타도 `text` 필드를 갖는다.
 * 둘을 합치면 사고 과정이 JSON 앞에 붙어 파싱이 깨진다 — `response.output_text.delta`
 * 하나만 본다.
 */
const OUTPUT_TEXT_DELTA = 'response.output_text.delta';

/** thinking 토글을 Responses API의 `reasoning.effort`로 옮긴다. */
function reasoningEffort(useThinking: boolean): 'high' | 'none' {
    return useThinking ? 'high' : 'none';
}

/**
 * Responses API(`POST /responses`) 경로 — `responseSchema`가 있을 때만 쓴다.
 *
 * `/chat/completions`와 갈라놓은 이유는 스키마 강제가 거기서만 되기 때문이다
 * ({@link DeepSeekCallOptions.responseSchema} 참고). 스키마가 없는 호출은
 * 종전 경로를 그대로 타므로 이 변경의 영향 범위는 스키마 호출로 한정된다.
 *
 * 스트리밍을 쓰는 것은 `/chat/completions`와 같은 이유다 — 실측 155초짜리 호출이
 * 스트리밍으로 완주했다. 비스트리밍도 124초까지는 성공했지만, 종전 어댑터가
 * ~50-60초 종료를 겪은 전례가 있어 안전한 쪽을 고른다.
 */
async function callDeepSeekResponses(
    prompt: string,
    options: DeepSeekCallOptions,
    spec: DeepSeekModelSpec,
    useThinking: boolean,
    signal: AbortSignal
): Promise<{ text: string; usage: DeepSeekUsageLike | undefined }> {
    const client = getClient(options.apiKey);
    const stream = (await (
        client as unknown as {
            responses: {
                create: (
                    body: unknown,
                    opts: unknown
                ) => Promise<AsyncIterable<unknown>>;
            };
        }
    ).responses.create(
        {
            model: spec.apiModelId,
            input: prompt,
            instructions: options.system ?? AI_SYSTEM_PROMPT,
            max_output_tokens: spec.maxOutputTokens,
            text: {
                format: {
                    type: 'json_schema',
                    name: 'analysis_response',
                    schema: options.responseSchema,
                },
            },
            reasoning: { effort: reasoningEffort(useThinking) },
            stream: true,
        },
        { signal }
    )) as AsyncIterable<{
        type?: string;
        delta?: unknown;
        response?: { usage?: unknown };
    }>;

    let text = '';
    let usage: DeepSeekUsageLike | undefined;
    for await (const event of stream) {
        if (
            event.type === OUTPUT_TEXT_DELTA &&
            typeof event.delta === 'string'
        ) {
            text += event.delta;
        }
        if (event.response?.usage) {
            usage = normalizeResponsesUsage(event.response.usage);
        }
    }
    return { text, usage };
}

/**
 * Responses API의 usage를 chat/completions 모양으로 옮긴다.
 *
 * 두 엔드포인트가 같은 값을 다른 이름으로 낸다 — `input_tokens`/`output_tokens` vs
 * `prompt_tokens`/`completion_tokens`. {@link extractDeepSeekUsage}는 후자만 읽으므로
 * 옮기지 않으면 **텔레메트리가 조용히 0으로 찍힌다** (호출은 정상이라 오류도 안 난다).
 * 정규화를 여기서 하면 usage 추출기는 손대지 않아도 된다.
 */
function normalizeResponsesUsage(raw: unknown): DeepSeekUsageLike | undefined {
    if (raw === null || typeof raw !== 'object') return undefined;
    const u = raw as {
        input_tokens?: number;
        output_tokens?: number;
        input_tokens_details?: { cached_tokens?: number };
        prompt_tokens?: number;
        completion_tokens?: number;
    };
    // 이미 chat 모양이면 그대로 둔다 — DeepSeek이 두 모양을 섞어 보내도 안전하다.
    if (u.prompt_tokens !== undefined || u.completion_tokens !== undefined) {
        return raw as DeepSeekUsageLike;
    }
    return {
        prompt_tokens: u.input_tokens ?? 0,
        completion_tokens: u.output_tokens ?? 0,
        prompt_tokens_details: u.input_tokens_details,
    } as DeepSeekUsageLike;
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

    // 스펙이 OFF/ON 두 상태를 모두 들고 있으므로, 호출자가 준 설정이 없으면
    // 기본 상태를 해석한다.
    const useThinking = (
        options.reasoning ?? resolveReasoningConfig(spec.reasoning, undefined)
    ).thinking;

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
        let text = '';
        let finishReason: string | null | undefined;
        let usage: DeepSeekUsageLike | undefined;

        if (options.responseSchema !== undefined) {
            // 스키마가 있으면 Responses API — 거기서만 강제가 된다.
            const result = await callDeepSeekResponses(
                prompt,
                options,
                spec,
                useThinking,
                controller.signal
            );
            text = result.text;
            usage = result.usage;
            // Responses API에는 `finish_reason`이 없다. 본문이 비면 아래 공통 처리가
            // 재시도 가능 오류로 올리도록 'stop'으로 맞춘다.
            finishReason = 'stop';
        } else {
            const stream = await client.chat.completions.create(params, {
                signal: controller.signal,
            });

            // Aggregate the streamed deltas into the full response. Streaming is
            // required (see the type comment) — the connection stays alive as tokens
            // flow, avoiding DeepSeek's ~50-60s non-streaming termination.
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
