import { GoogleGenAI } from '@google/genai';
import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
import { AI_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import type { GeminiModelId } from '@/domain/analysis/modelSpecs';
import { extractGeminiUsage, logUsage } from '@/infrastructure/ai/usage';

/**
 * MAX_TOKENS 에러 식별 코드.
 * thinkingBudget을 줄여 재시도해야 함을 호출 측에 알린다.
 */
export const MAX_TOKENS_CODE = 'GEMINI_MAX_TOKENS';

const GEMINI_TIMEOUT_MS = 3600_000;

const clientCache = new Map<string, GoogleGenAI>();

function getClient(apiKey: string): GoogleGenAI {
    let client = clientCache.get(apiKey);
    if (!client) {
        client = new GoogleGenAI({ apiKey });
        clientCache.set(apiKey, client);
    }
    return client;
}

export interface GeminiCallOptions {
    /** 호출에 사용할 Gemini 모델. */
    model: GeminiModelId;
    /** 호출에 사용할 API key. */
    apiKey: string;
    thinking?: boolean;
    thinkingBudget?: number;
    /**
     * core가 디스패치하는 deterministic seed.
     * 지정 시 `config.seed`로 전달해 동일 입력에 대한 재현성을 높인다. 미지정 시 seed 미설정(기존 동작).
     */
    seed?: number;
    signal?: AbortSignal;
    /** 호출별 system 프롬프트. 미지정 시 AI_SYSTEM_PROMPT 사용. */
    system?: string;
    /**
     * core가 전달하는 canonical JSON Schema.
     * 지정 시 `responseJsonSchema`로 구조화 출력을 강제한다. 미지정 시 `responseMimeType`만 유지.
     */
    responseSchema?: unknown;
    /**
     * 로깅 상관관계 ID. 지정 시에만 `[Usage]` 텔레메트리 라인을 남긴다
     * (미지정 — 예: 단위 테스트 직접 호출 — 시 조용히 스킵).
     */
    jobId?: string;
}

export async function callGemini(
    prompt: string,
    options: GeminiCallOptions
): Promise<string> {
    const { model, apiKey } = options;
    // Gemini has no native multi-block prompt-caching API here — implicit
    // caching (2.5+) keys on an identical byte-for-byte prefix formed by
    // `system` (persona + folded skill digest, design C) + this `prompt`.
    const client = getClient(apiKey);
    const spec = MODEL_SPECS[model] as
        | (typeof MODEL_SPECS)[typeof model]
        | undefined;
    if (!spec) {
        throw new Error(`[Gemini] Unknown model: ${model}`);
    }
    const maxOutputTokens = spec.maxOutputTokens;
    const defaultBudget = spec.thinkingBudget;

    const controller = new AbortController();
    // .unref()로 timer가 event loop를 점유하지 않게 하여 정상 종료를 막지 않도록 한다.
    const timeoutId = setTimeout(
        () => controller.abort(),
        GEMINI_TIMEOUT_MS
    ).unref();
    // 외부 취소 신호를 타임아웃 컨트롤러에 전파 — abort 시 Gemini HTTP 요청을 즉시 중단한다.
    // propagateAbort는 finally에서 제거해 신호가 발생하지 않은 경우의 리스너 누수를 방지한다.
    const propagateAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', propagateAbort, { once: true });

    const start = Date.now();
    try {
        const response = await client.models.generateContent({
            model: spec.apiModelId,
            contents: prompt,
            config: {
                abortSignal: controller.signal,
                systemInstruction: options.system ?? AI_SYSTEM_PROMPT,
                temperature: spec.temperature,
                maxOutputTokens,
                responseMimeType: 'application/json',
                ...(options.seed !== undefined && {
                    seed: options.seed,
                }),
                ...(options.responseSchema !== undefined && {
                    responseJsonSchema: options.responseSchema,
                }),
                ...(options.thinking === true && {
                    thinkingConfig: {
                        // -1(무제한)은 output token budget을 thinking이 전부 소모하여
                        // MAX_TOKENS + 빈 텍스트 응답을 유발한다.
                        // 호출 측에서 모델별 상한을 주입한다.
                        // flash-lite: 24576 / flash, pro: 32768
                        thinkingBudget: options.thinkingBudget ?? defaultBudget,
                        includeThoughts: false,
                    },
                }),
            },
        });

        const elapsed = Date.now() - start;
        const candidate = response.candidates?.[0];
        const finishReason = candidate?.finishReason;
        const text = response.text;

        console.log(
            `[Gemini] Response time: ${elapsed}ms (model: ${model}, finishReason: ${finishReason})`
        );

        if (options.jobId !== undefined) {
            logUsage({
                jobId: options.jobId,
                model,
                ...extractGeminiUsage(response.usageMetadata),
                latencyMs: elapsed,
            });
        }

        if (finishReason === 'STOP') {
            if (text) {
                return text;
            }
            console.warn('[Gemini] Empty text response', {
                model,
                finishReason,
            });
            throw Object.assign(
                new Error(
                    `Gemini returned an empty text response (finishReason: ${finishReason})`
                ),
                { retryable: true }
            );
        }

        if (finishReason === 'SAFETY') {
            // 안전 필터 차단 — 재시도해도 동일하게 차단되므로 non-retryable로 처리한다.
            const safetyRatings = candidate?.safetyRatings ?? [];
            console.error('[Gemini] Response blocked by safety filter', {
                model,
                safetyRatings,
            });
            throw new Error(
                `Gemini blocked response due to safety filter (finishReason: SAFETY)`
            );
        }

        if (finishReason === 'MAX_TOKENS') {
            // 출력 토큰 한도 초과 — 같은 thinkingBudget으로 재시도해도 동일하게 실패한다.
            // non-retryable로 던져 호출 측에서 thinkingBudget을 줄여 재시도하도록 한다.
            console.warn('[Gemini] MAX_TOKENS: output truncated', {
                model,
                finishReason,
            });
            throw Object.assign(
                new Error(`Gemini hit output token limit (model: ${model})`),
                { code: MAX_TOKENS_CODE }
            );
        }

        // SAFETY/MAX_TOKENS 외 이유로 빈 텍스트가 반환된 경우(thinking 전용 응답 등)는
        // 일시적 문제로 보고 재시도한다.
        console.warn('[Gemini] Invalid response', {
            model,
            finishReason,
            text,
        });
        throw Object.assign(
            new Error(`Invalid Gemini response: finishReason ${finishReason}`),
            { retryable: true }
        );
    } finally {
        clearTimeout(timeoutId);
        options.signal?.removeEventListener('abort', propagateAbort);
    }
}
