import Anthropic from '@anthropic-ai/sdk';
import type {
    ClaudeAdaptiveReasoningConfig,
    ClaudeBudgetReasoningConfig,
    ClaudeEffortLevel,
    ClaudeModelSpec,
} from '@/domain/types';
import {
    isClaudeAdaptiveModelSpec,
    isClaudeBudgetModelSpec,
    resolveReasoningConfig,
} from '@/domain/types';
import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
import { AI_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import type { ClaudeModelId } from '@/domain/analysis/modelSpecs';
import { extractClaudeUsage, logUsage } from '@/infrastructure/ai/usage';

export type { ClaudeEffortLevel };

type ClaudeTextBlock = Anthropic.Messages.TextBlock;
type ClaudeToolUseBlock = Anthropic.Messages.ToolUseBlock;

/** responseSchema 구조화 출력에 사용하는 단일 tool 이름. */
const STRUCTURED_TOOL_NAME = 'structured_analysis';

/**
 * Ephemeral prompt-cache breakpoint, placed on the (only) block of the system
 * prompt. Design C (siglens-core dispatch contract) folds the always-on skill
 * digest into `system` alongside the persona, so the system block is now
 * consistently substantial and worth caching on every ANALYZE call — the
 * user message carries only the per-call `prompt` as plain text, uncached.
 * Mirrors the pattern already proven in siglens's chat path
 * (src/entities/llm-provider/api/anthropic.ts).
 */
const EPHEMERAL_CACHE_CONTROL = { type: 'ephemeral' } as const;

/**
 * MAX_TOKENS 에러 식별 코드.
 * 출력 한도 초과는 effort 조정으로 해결 불가 — 호출 측에 즉시 전파한다.
 */
export const MAX_TOKENS_CODE = 'CLAUDE_MAX_TOKENS';

const CLAUDE_TIMEOUT_MS = 3600_000;

const clientCache = new Map<string, Anthropic>();

function getClient(apiKey: string): Anthropic {
    let client = clientCache.get(apiKey);
    if (!client) {
        client = new Anthropic({ apiKey });
        clientCache.set(apiKey, client);
    }
    return client;
}

export interface ClaudeCallOptions {
    /** 호출에 사용할 Claude 모델. */
    model: ClaudeModelId;
    /** 호출에 사용할 API key. user 키 또는 server 키. */
    apiKey: string;
    /**
     * 추론 설정 오버라이드. 미지정 시 스펙의 기본 상태(`reasoning.default`)를
     * 해석해 적용한다.
     *
     * adaptive 모델(sonnet/opus/fable)은 {@link ClaudeAdaptiveReasoningConfig},
     * budget 모델(haiku)은 {@link ClaudeBudgetReasoningConfig}를 받는다. 모델의
     * `thinkingApi`와 맞지 않는 형태를 넘기면 무시된다.
     */
    reasoning?: ClaudeAdaptiveReasoningConfig | ClaudeBudgetReasoningConfig;
    /** 외부에서 전달되는 abort signal. */
    signal?: AbortSignal;
    /** 호출별 system 프롬프트. 미지정 시 AI_SYSTEM_PROMPT 사용. */
    system?: string;
    /**
     * core가 전달하는 canonical JSON Schema.
     * 지정 시 단일 tool의 `input_schema`로 주입한다. `tool_choice`는 모델의 thinking
     * 지원 여부에 따라 갈린다:
     * - thinking 미지원 모델(haiku, spec.effort 없음): `tool_choice: {type:'tool', name}`으로
     *   FORCE — 구조화 출력을 보장하고 `extractJsonWithRepair` 폴백 의존을 제거한다.
     * - thinking 지원 모델(sonnet/opus, spec.effort 있음): `tool_choice: auto` 유지 — forced
     *   tool_choice({type:'tool'} 또는 {type:'any'})는 thinking과 함께 쓰면 Anthropic API가
     *   400을 반환하므로 강제할 수 없다 (adaptive thinking은 `auto`와만 양립한다).
     * 미지정 시 기존 prose-JSON 동작을 유지한다.
     */
    responseSchema?: unknown;
    /**
     * 로깅 상관관계 ID. 지정 시에만 `[Usage]` 텔레메트리 라인을 남긴다
     * (미지정 — 예: 단위 테스트 직접 호출 — 시 조용히 스킵).
     */
    jobId?: string;
}

export async function callClaude(
    prompt: string,
    options: ClaudeCallOptions
): Promise<string> {
    const { model, apiKey } = options;
    const spec = MODEL_SPECS[model] as ClaudeModelSpec | undefined;
    if (!spec) {
        throw new Error(`[Claude] Unknown model: ${model}`);
    }
    // responseSchema가 있으면 단일 tool을 제공해 구조화 출력을 유도한다.
    // thinking은 schema 유무와 독립적으로 유지된다 — effort 유무로만 결정된다 (아래).
    const structuredOutput = options.responseSchema !== undefined;

    // thinkingApi가 두 갈래를 가른다 — 4.6 세대 이후는 adaptive,
    // 그 이전(haiku)은 numeric budget_tokens + temperature.
    // 스펙이 두 상태를 모두 들고 있으므로, 호출자가 준 설정이 없으면 기본 상태를 해석한다.
    const adaptiveConfig = isClaudeAdaptiveModelSpec(spec)
        ? ((options.reasoning as ClaudeAdaptiveReasoningConfig | undefined) ??
          resolveReasoningConfig(spec.reasoning, undefined))
        : undefined;
    const budgetConfig = isClaudeBudgetModelSpec(spec)
        ? ((options.reasoning as ClaudeBudgetReasoningConfig | undefined) ??
          resolveReasoningConfig(spec.reasoning, undefined))
        : undefined;
    // budget 모델에서 budget_tokens가 0이면 thinking 블록 자체를 보내지 않는다.
    const budgetThinking =
        budgetConfig !== undefined && budgetConfig.budgetTokens > 0;
    // 이 요청이 실제로 thinking을 보내는지 — 스펙이 아니라 **해석된 상태**로 판정한다.
    // adaptive 모델이라도 추론 OFF면 thinking 블록을 보내지 않으므로, 아래
    // tool_choice 제약이 걸리지 않는다.
    const thinkingActive =
        adaptiveConfig !== undefined
            ? adaptiveConfig.mode === 'adaptive'
            : budgetThinking;

    // PR5a — tool_choice 강제 여부는 thinking 지원 여부로 갈린다.
    // Anthropic API 제약(empirically 확인, commit 83d01ba/e3b4d01 참고):
    // forced tool_choice({type:'tool'} 또는 {type:'any'})는 thinking(adaptive/extended)과
    // 동시에 지정하면 400을 반환한다. 이 저장소가 실제로 그 400을 겪었다 — 83d01ba는
    // forced tool_choice를 위해 thinking을 꺼야 했고, e3b4d01은 반대로 thinking을 지키기
    // 위해 tool_choice를 auto로 되돌렸다(sonnet-4-6에서 thinking 블록 + tool_use 조합을
    // 400 없이 실증).
    // 따라서:
    // - thinkingActive === true: tool_choice는 `auto` 유지 — force하면 400.
    // - thinkingActive === false: thinking을 전혀 보내지 않으므로 tool_choice를
    //   `{type:'tool', name}`으로 FORCE해 구조화 출력을 보장한다 (extractJsonWithRepair
    //   폴백 의존 제거). Gemini(responseJsonSchema)/OpenAI(strict json_schema)와 대칭.
    //
    // 스펙이 아니라 해석된 상태를 보는 이유: 추론 OFF인 adaptive 모델은 thinking을
    // 보내지 않으므로 강제해도 400이 나지 않는다. 스펙 기준으로 판정하면 그 경우
    // 이유 없이 구조화 출력 강제를 포기하게 된다.
    const forceStructuredTool = structuredOutput && !thinkingActive;

    const client = getClient(apiKey);

    const controller = new AbortController();
    // .unref()로 timer가 event loop를 점유하지 않게 하여 정상 종료를 막지 않도록 한다.
    const timeoutId = setTimeout(
        () => controller.abort(),
        CLAUDE_TIMEOUT_MS
    ).unref();
    // 외부 취소 신호를 타임아웃 컨트롤러에 전파 — abort 시 Anthropic HTTP 요청을 즉시 중단한다.
    const propagateAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', propagateAbort, { once: true });

    const systemText = options.system ?? AI_SYSTEM_PROMPT;
    // Design C: always cache the system block (persona + folded skill
    // digest) — no user-side cache block. The user message is the plain
    // `prompt` string as-is.
    const system = [
        {
            type: 'text' as const,
            text: systemText,
            cache_control: EPHEMERAL_CACHE_CONTROL,
        },
    ];
    const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: prompt },
    ];

    const start = Date.now();
    try {
        const stream = client.messages.stream(
            {
                model: spec.apiModelId,
                max_tokens: spec.maxOutputTokens,
                system,
                messages,
                // schema가 있으면 단일 tool을 제공한다. tool_choice는 forceStructuredTool
                // (thinking 미지원 모델에서만 true)로 갈린다 — 위 주석 참고.
                ...(structuredOutput && {
                    tools: [
                        {
                            name: STRUCTURED_TOOL_NAME,
                            description:
                                'Return the analysis as structured JSON.',
                            input_schema:
                                options.responseSchema as Anthropic.Tool.InputSchema,
                        },
                    ],
                    tool_choice: forceStructuredTool
                        ? {
                              type: 'tool' as const,
                              name: STRUCTURED_TOOL_NAME,
                          }
                        : { type: 'auto' as const },
                }),
                // thinking은 schema 유무와 독립적으로 thinkingApi로만 결정된다.
                ...(adaptiveConfig !== undefined
                    ? adaptiveConfig.mode === 'disabled'
                        ? {
                              // 추론 OFF — Free·Member 등급 adaptive 모델의 기본값.
                              // `effort: 'low'`로 낮추는 것과 다르다: low는 여전히
                              // 사고 토큰을 쓴다.
                              //
                              // ⚠️ Opus 5는 `disabled`를 effort `high` 이하에서만
                              // 허용한다(xhigh/max와 함께 보내면 400). 여기서는
                              // disabled일 때 output_config을 아예 보내지 않으므로
                              // 충돌하지 않는다.
                              thinking: { type: 'disabled' as const },
                          }
                        : {
                              thinking: {
                                  type: 'adaptive' as const,
                                  // 응답에 thinking 블록을 포함하지 않아 전송량을 줄인다.
                                  display: 'omitted' as const,
                              },
                              output_config: { effort: adaptiveConfig.effort },
                          }
                    : {
                          // haiku: pre-4.6 extended thinking — budget_tokens 경로.
                          // budget 0이면 thinking 블록을 생략한다.
                          ...(budgetThinking && {
                              thinking: {
                                  type: 'enabled' as const,
                                  budget_tokens: budgetConfig.budgetTokens,
                              },
                          }),
                          // Anthropic API는 temperature/top_p 동시 지정을 허용하지 않는다.
                          temperature: spec.temperature,
                      }),
            },
            { signal: controller.signal }
        );
        const message = await stream.finalMessage();

        const elapsed = Date.now() - start;
        const stopReason = message.stop_reason;

        console.log(
            `[Claude] Response time: ${elapsed}ms (model: ${model}, stop_reason: ${stopReason})`
        );

        if (options.jobId !== undefined) {
            logUsage({
                jobId: options.jobId,
                model,
                ...extractClaudeUsage(message.usage),
                latencyMs: elapsed,
            });
        }

        // structuredOutput: tool을 호출한 응답은 stop_reason === 'tool_use'.
        // tool_use 블록의 input을 JSON 문자열로 직렬화해 반환한다 (downstream 계약은 JSON string).
        if (structuredOutput) {
            const toolUseBlock = message.content.find(
                (block): block is ClaudeToolUseBlock =>
                    block.type === 'tool_use' &&
                    block.name === STRUCTURED_TOOL_NAME
            );
            // W7: input이 null/undefined면 JSON.stringify가 'null'/undefined를 만들어
            // downstream JSON 파싱을 깨뜨린다 — tool 블록이 비었으면 text 추출 폴백으로 넘긴다.
            // stop_reason이 'max_tokens'면 input이 non-null이어도 출력이 중간에 잘렸을 수
            // 있다 — partial/malformed JSON을 성공으로 반환하지 않고 아래 전용
            // max_tokens 분기(재시도 트리거)로 떨어뜨린다.
            if (
                toolUseBlock &&
                toolUseBlock.input != null &&
                stopReason !== 'max_tokens'
            ) {
                return JSON.stringify(toolUseBlock.input);
            }
            // forceStructuredTool이 아니면(`tool_choice: auto`, thinking 모델) 모델이 tool
            // 대신 text를 반환할 수 있다 — text 추출로 폴백한다(downstream의 jsonrepair가
            // prose-JSON을 복구할 수 있도록). forceStructuredTool인 경우 forced tool_choice가
            // 호출을 보장하므로 이 분기는 정상 경로에서 도달하지 않아야 하지만, 방어적으로
            // 동일한 폴백을 유지한다. tool 블록은 있지만 input이 비어 있거나 max_tokens로
            // 잘린 경우도 같다(후자는 아래 전용 분기가 재시도를 트리거한다).
            console.warn(
                '[Claude] No usable tool_use block in structured response',
                {
                    model,
                    stopReason,
                }
            );
        }

        // structuredOutput 폴백: tool_use 블록이 없을 때만 도달 — text 추출을 시도한다.
        // max_tokens/refusal 등은 아래 전용 분기에서 처리하도록 stop_reason으로 가드한다.
        if (
            stopReason === 'end_turn' ||
            (structuredOutput && stopReason === 'tool_use')
        ) {
            // thinking 활성 시 응답에 ThinkingBlock + TextBlock이 섞여 있다 — text만 추출.
            const textBlock = message.content.find(
                (block): block is ClaudeTextBlock => block.type === 'text'
            );

            if (textBlock) {
                return textBlock.text;
            }
            console.warn('[Claude] Empty text response', {
                model,
                stopReason,
            });
            throw Object.assign(
                new Error(
                    `Claude returned an empty text response (stop_reason: ${stopReason})`
                ),
                { retryable: true }
            );
        }

        if (stopReason === 'max_tokens') {
            console.warn('[Claude] MAX_TOKENS: output truncated', {
                model,
                stopReason,
            });
            throw Object.assign(
                new Error(`Claude hit output token limit (model: ${model})`),
                { code: MAX_TOKENS_CODE }
            );
        }

        if (stopReason === 'refusal') {
            console.error('[Claude] Response refused by safety policy', {
                model,
                stopReason,
            });
            throw new Error(
                `Claude refused response (stop_reason: ${stopReason})`
            );
        }

        // stop_sequence / tool_use / pause_turn / null 등은 일시적 문제일 수 있어 재시도.
        console.warn('[Claude] Invalid response', {
            model,
            stopReason,
        });
        throw Object.assign(
            new Error(`Invalid Claude response: stop_reason ${stopReason}`),
            { retryable: true }
        );
    } finally {
        clearTimeout(timeoutId);
        options.signal?.removeEventListener('abort', propagateAbort);
    }
}
