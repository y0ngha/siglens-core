import { createClientCache } from '@/infrastructure/ai/providers/clientCache';
import { loadOptionalSdk } from '@/infrastructure/ai/loadOptionalSdk';
import type { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
import { AI_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import type { GeminiModelId } from '@/domain/analysis/modelSpecs';
import type { GeminiModelSpec, GeminiThinkingLevel } from '@/domain/types';
import { resolveReasoningConfig } from '@/domain/types';
import { extractGeminiUsage, logUsage } from '@/infrastructure/ai/usage';

/**
 * MAX_TOKENS 에러 식별 코드.
 * thinkingLevel을 한 단계 낮춰 재시도해야 함을 호출 측에 알린다.
 */
export const MAX_TOKENS_CODE = 'GEMINI_MAX_TOKENS';

const GEMINI_TIMEOUT_MS = 3600_000;

/**
 * Domain thinking levels → the SDK's `ThinkingLevel` enum.
 *
 * The wire format is case-insensitive (the API echoes an unsupported level
 * back uppercased in its 400 message), but the SDK types the field as this
 * enum, so map at the boundary rather than casting.
 */
const loadGenAI = loadOptionalSdk(
    '@google/genai',
    'Gemini models',
    () => import('@google/genai')
);

let clientCache: ReturnType<typeof createClientCache<GoogleGenAI>> | undefined;

/**
 * The enum is a runtime value of the lazily loaded SDK, so the mapping is
 * resolved from the loaded module instead of a module-level constant.
 */
function toSdkThinkingLevel(
    level: GeminiThinkingLevel,
    sdk: { ThinkingLevel: typeof ThinkingLevel }
): ThinkingLevel {
    const map: Record<GeminiThinkingLevel, ThinkingLevel> = {
        minimal: sdk.ThinkingLevel.MINIMAL,
        low: sdk.ThinkingLevel.LOW,
        medium: sdk.ThinkingLevel.MEDIUM,
        high: sdk.ThinkingLevel.HIGH,
    };
    return map[level];
}

async function getClient(apiKey: string): Promise<GoogleGenAI> {
    const sdk = await loadGenAI();
    clientCache ??= createClientCache<GoogleGenAI>(
        key => new sdk.GoogleGenAI({ apiKey: key })
    );
    return clientCache.get(apiKey);
}

export interface GeminiCallOptions {
    /** 호출에 사용할 Gemini 모델. */
    model: GeminiModelId;
    /** 호출에 사용할 API key. */
    apiKey: string;
    /**
     * Thinking level override. When omitted, the model spec's own default
     * state (`reasoning.default`) is resolved and applied.
     *
     * Always sent to the API — unlike the previous `thinkingBudget` path,
     * which only attached `thinkingConfig` when thinking was explicitly on and
     * therefore let the model's natural default through on every other call.
     */
    thinkingLevel?: GeminiThinkingLevel;
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
    // 이미 취소된 signal은 'abort' 이벤트를 다시 쏘지 않으므로 아래에서 다는 리스너만으로는
    // 전파되지 않는다 — 어떤 준비 작업보다 먼저 여기서 끊는다(재시도 대상 아님: status·retryable 없음).
    options.signal?.throwIfAborted();
    const { model, apiKey } = options;
    // Gemini has no native multi-block prompt-caching API here — implicit
    // caching (2.5+) keys on an identical byte-for-byte prefix formed by
    // `system` (persona + folded skill digest, design C) + this `prompt`.
    const sdk = await loadGenAI();
    const client = await getClient(apiKey);
    // getClient는 이제 SDK 지연 로드로 await 한다 — 그 사이 도착한 abort는 아래에서 다는
    // 리스너가 보지 못하므로 로드 직후 한 번 더 확인한다.
    options.signal?.throwIfAborted();
    // Widened to the interface (not the literal row type) so
    // `resolveReasoningConfig` infers its config type from both toggle states.
    const spec = MODEL_SPECS[model] as GeminiModelSpec | undefined;
    if (!spec) {
        throw new Error(`[Gemini] Unknown model: ${model}`);
    }
    const maxOutputTokens = spec.maxOutputTokens;
    // Resolve the spec's own default when the caller expressed no preference.
    const thinkingLevel =
        options.thinkingLevel ??
        resolveReasoningConfig(spec.reasoning, undefined).level;

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
                // temperature·topP·topK는 보내지 않는다. 3.6 Flash부터 Google이
                // 고정한 기본값으로 무시되고, 이후 모델은 400으로 거부한다.
                maxOutputTokens,
                responseMimeType: 'application/json',
                ...(options.seed !== undefined && {
                    seed: options.seed,
                }),
                ...(options.responseSchema !== undefined && {
                    responseJsonSchema: options.responseSchema,
                }),
                // thinkingConfig는 **항상** 보낸다. 생략하면 모델의 자연
                // 기본값이 적용되는데, 그 값은 대체로 추론 ON이다(실측
                // 2026-09-06: `gemini-3.6-flash` 미지정 시 418 사고 토큰).
                // Free·Member 모델의 기본 OFF를 보장하려면 매 호출 명시해야 한다.
                //
                // 숫자 `thinkingBudget`은 쓰지 않는다 — 3세대 모델은 이를
                // 거부하거나(`gemini-3.1-pro-preview`, `3.5-flash-lite`,
                // `3.6-flash`가 0에 400) 에러 없이 무시한다(`3.8-flash`).
                // 조용한 무시가 특히 위험해서 level로 전환했다.
                thinkingConfig: {
                    thinkingLevel: toSdkThinkingLevel(thinkingLevel, sdk),
                    includeThoughts: false,
                },
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
            // 출력 토큰 한도 초과 — 같은 thinkingLevel로 재시도해도 동일하게 실패한다.
            // non-retryable로 던져 호출 측에서 level을 한 단계 낮춰 재시도하도록 한다.
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
