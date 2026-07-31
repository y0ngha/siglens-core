import type { ActiveModelId, AIProvider, ModelSpec } from '@/domain/types';

/**
 * Default sampling temperature applied to models whose provider APIs accept it.
 *
 * `as const` preserves the literal `0` type so that
 * supported `MODEL_SPECS[X].temperature` values infer as `0` rather than
 * widening to `number`.
 */
const DEFAULT_TEMPERATURE = 0 as const;

/**
 * Per-model AI SDK call parameters keyed by {@link ActiveModelId}.
 *
 * Single source of truth for AI SDK **call parameters** — workers, server
 * actions, UI 모두 여기서 직접 lookup한다.
 *
 * 다만 모델 추가는 한 줄로 끝나지 않는다. 세 곳을 함께 고쳐야 소비처에 노출된다:
 * 1. `TierModel` union (`domain/types.ts`) — 없으면 아래 `satisfies`가 컴파일 에러.
 * 2. 이 맵의 한 행 — 없으면 위 `satisfies`가 컴파일 에러.
 * 3. `TIER_CONFIG.models`의 티어 배치 (`domain/tier.ts`) — **여기만 컴파일러가
 *    잡아 주지 않는다.** 빠뜨리면 `getAllowedModels`가 돌려주지 않아 어떤 등급에서도
 *    선택할 수 없는 유령 모델이 된다 (tier.test.ts의 커버리지 단언이 감시한다).
 *
 * 그 뒤 core publish → 소비처는 버전 범프만으로 자동으로 인식한다.
 *
 * Notes:
 * - Claude haiku: thinking 미지원 (`thinkingBudget: 0`), temperature 사용.
 * - Claude sonnet/opus: adaptive thinking (`effort`), `budget_tokens`/temperature 미사용.
 * - Gemini: `thinkingBudget` 그대로 사용.
 * - GPT-5 series: `effort`로 Responses API `reasoning.effort` 지정, temperature 미지원.
 * - DeepSeek V4: `thinking` boolean 토글(reasoning on/off), non-thinking 시 temperature 사용.
 */
export const MODEL_SPECS = {
    'claude-haiku-4-5': {
        provider: 'claude',
        apiModelId: 'claude-haiku-4-5-20251001',
        maxOutputTokens: 64_000,
        thinkingBudget: 0,
        temperature: DEFAULT_TEMPERATURE,
    },
    'claude-sonnet-4-6': {
        provider: 'claude',
        apiModelId: 'claude-sonnet-4-6',
        maxOutputTokens: 64_000,
        effort: 'high',
    },
    'claude-opus-4-7': {
        provider: 'claude',
        apiModelId: 'claude-opus-4-7',
        maxOutputTokens: 128_000,
        effort: 'high',
    },
    // Claude 5 세대의 `claude-sonnet-5` / `claude-opus-5`는 그 자체가 Anthropic이
    // 문서화한 완전한 모델 id다 — 뒤에 날짜 스냅샷을 붙이면 404가 난다
    // (`claude-haiku-4-5-20251001`처럼 dated id가 존재하는 구세대와 다르다).
    // 아래 GPT-5.6 주석의 "alias 금지"는 여러 모델로 라우팅되는 alias(`gpt-5.6` →
    // sol)를 가리키며, 단일 모델을 지칭하는 이 id들은 해당하지 않는다.
    'claude-sonnet-5': {
        provider: 'claude',
        apiModelId: 'claude-sonnet-5',
        // Sonnet 5는 adaptive thinking이 기본 ON이고 thinking 토큰이 max_tokens
        // 예산을 함께 소비한다. Sonnet 4.6 기준(64K)을 그대로 쓰면 응답이 잘릴 수
        // 있어 모델 상한(128K)을 그대로 요청한다.
        maxOutputTokens: 128_000,
        effort: 'high',
    },
    'claude-opus-5': {
        provider: 'claude',
        apiModelId: 'claude-opus-5',
        maxOutputTokens: 128_000,
        effort: 'high',
    },
    'gemini-2.5-flash': {
        provider: 'gemini',
        apiModelId: 'gemini-2.5-flash',
        maxOutputTokens: 65_536,
        thinkingBudget: 8_192,
        temperature: DEFAULT_TEMPERATURE,
    },
    'gemini-2.5-flash-lite': {
        provider: 'gemini',
        apiModelId: 'gemini-2.5-flash-lite',
        maxOutputTokens: 65_536,
        thinkingBudget: 8_192,
        temperature: DEFAULT_TEMPERATURE,
    },
    'gemini-2.5-pro': {
        provider: 'gemini',
        apiModelId: 'gemini-2.5-pro',
        maxOutputTokens: 65_536,
        thinkingBudget: 32_768,
        temperature: DEFAULT_TEMPERATURE,
    },
    'gemini-3-flash-preview': {
        provider: 'gemini',
        apiModelId: 'gemini-3-flash-preview',
        maxOutputTokens: 65_536,
        thinkingBudget: 32_768,
        temperature: DEFAULT_TEMPERATURE,
    },
    'gemini-3.1-pro-preview': {
        provider: 'gemini',
        apiModelId: 'gemini-3.1-pro-preview',
        maxOutputTokens: 65_536,
        thinkingBudget: 32_768,
        temperature: DEFAULT_TEMPERATURE,
    },
    // Gemini thinking budget은 "flash냐 pro냐"가 아니라 "그 모델을 얕은 추론용으로
    // 쓰느냐 깊은 추론용으로 쓰느냐"로 나뉜다. 2.5 세대의 flash/flash-lite는 값싼
    // 보조 모델이라 8K, 3 세대 이후 flash는 Gemini의 주력 추론 라인(3.6 Flash가
    // 현행 GA 최상위 flash)이라 pro와 같은 32K를 준다.
    'gemini-3.5-flash-lite': {
        provider: 'gemini',
        apiModelId: 'gemini-3.5-flash-lite',
        maxOutputTokens: 65_536,
        // flash-lite는 고volume 저지연 라인 — 2.5 flash-lite와 동일한 8K 예산.
        thinkingBudget: 8_192,
        temperature: DEFAULT_TEMPERATURE,
    },
    'gemini-3.6-flash': {
        provider: 'gemini',
        apiModelId: 'gemini-3.6-flash',
        maxOutputTokens: 65_536,
        // 3 세대 flash 주력 라인 — gemini-3-flash-preview와 동일한 32K 예산.
        thinkingBudget: 32_768,
        temperature: DEFAULT_TEMPERATURE,
    },
    'gpt-5-mini': {
        provider: 'chatgpt',
        apiModelId: 'gpt-5-mini',
        maxOutputTokens: 65_536,
        effort: 'medium',
    },
    'gpt-5.4': {
        provider: 'chatgpt',
        apiModelId: 'gpt-5.4',
        maxOutputTokens: 128_000,
        effort: 'high',
    },
    'gpt-5.5': {
        provider: 'chatgpt',
        apiModelId: 'gpt-5.5',
        maxOutputTokens: 128_000,
        effort: 'high',
    },
    // GPT-5.6 계열은 `gpt-5.6` alias(→ sol) 대신 변형을 명시적으로 고정한다.
    // alias는 OpenAI가 라우팅 대상을 바꾸면 조용히 동작이 바뀌므로, 캐시 키와
    // 응답 특성이 모델 id에 묶여 있는 이 레포에서는 pinned id가 안전하다.
    'gpt-5.6-terra': {
        provider: 'chatgpt',
        apiModelId: 'gpt-5.6-terra',
        maxOutputTokens: 128_000,
        effort: 'high',
    },
    'gpt-5.6-sol': {
        provider: 'chatgpt',
        apiModelId: 'gpt-5.6-sol',
        maxOutputTokens: 128_000,
        effort: 'high',
    },
    'deepseek-v4-flash': {
        provider: 'deepseek',
        apiModelId: 'deepseek-v4-flash',
        // DeepSeek V4 supports up to 384K (384 * 1024) output tokens.
        maxOutputTokens: 393_216,
        thinking: false,
        temperature: DEFAULT_TEMPERATURE,
    },
    'deepseek-v4-pro': {
        provider: 'deepseek',
        apiModelId: 'deepseek-v4-pro',
        // DeepSeek V4 supports up to 384K (384 * 1024) output tokens.
        maxOutputTokens: 393_216,
        thinking: true,
        temperature: DEFAULT_TEMPERATURE,
    },
} as const satisfies Record<ActiveModelId, ModelSpec>;

/**
 * @internal
 * Standard thinking-budget fallback steps used when MAX_TOKENS retry occurs.
 */
export const THINKING_BUDGET_FALLBACK_STEPS = [8192, 4096, 2048] as const;

/** Disabled thinking budget — last step in the fallback sequence. */
export const DISABLED_THINKING_BUDGET = 0;

/**
 * Generate the MAX_TOKENS retry sequence for thinking-budget reduction.
 *
 * Sequence: `initial → initial/2 → initial/4 → THINKING_BUDGET_FALLBACK_STEPS → 0`.
 * Two halving steps preserve response quality with as large a budget as
 * possible before falling into the standard candidates. Entries that are
 * greater than or equal to the previous accepted value are skipped, so
 * duplicates and non-decreasing values never appear in the result.
 *
 * @param initial - Initial thinking budget (in tokens) to derive the sequence from.
 * @returns Strictly-decreasing sequence of thinking budgets, ending at `0`.
 */
export function getThinkingBudgetSequence(initial: number): readonly number[] {
    const candidates = [
        initial,
        Math.floor(initial / 2),
        Math.floor(initial / 4),
        ...THINKING_BUDGET_FALLBACK_STEPS,
        DISABLED_THINKING_BUDGET,
    ];
    const result: number[] = [];
    for (const budget of candidates) {
        if (result.length === 0 || budget < result[result.length - 1]) {
            result.push(budget);
        }
    }
    return result;
}

/**
 * Resolve the hosting provider for an active model identifier.
 *
 * Returns the internal {@link AIProvider} taxonomy (`'claude' | 'gemini' |
 * 'chatgpt' | 'deepseek'`) used by `MODEL_SPECS`. Use this when you need the human-facing
 * provider family for an `ActiveModelId` that is guaranteed to exist in
 * `MODEL_SPECS` (e.g. UI labels, model selection screens).
 *
 * For the LLM key-storage / SDK provider taxonomy (`'anthropic' | 'google' |
 * 'openai'`) — including legacy/deprecated model identifiers that are not in
 * `MODEL_SPECS` — use {@link getProviderForModel} from `domain/llm/providers`
 * instead. The two functions intentionally cover different layers and accept
 * different input domains; neither is a drop-in replacement for the other.
 *
 * @param model - Active model identifier to look up.
 * @returns The {@link AIProvider} that hosts the given model.
 * @see getProviderForModel — returns {@link LlmProvider} from any {@link ModelId}.
 */
export function getProvider(model: ActiveModelId): AIProvider {
    return MODEL_SPECS[model].provider;
}

/** Active model identifiers hosted on Claude (Anthropic). */
export type ClaudeModelId = {
    [K in ActiveModelId]: (typeof MODEL_SPECS)[K]['provider'] extends 'claude'
        ? K
        : never;
}[ActiveModelId];

/** Active model identifiers hosted on Gemini (Google). */
export type GeminiModelId = {
    [K in ActiveModelId]: (typeof MODEL_SPECS)[K]['provider'] extends 'gemini'
        ? K
        : never;
}[ActiveModelId];

/** Active model identifiers hosted on ChatGPT (OpenAI). */
export type ChatGPTModelId = {
    [K in ActiveModelId]: (typeof MODEL_SPECS)[K]['provider'] extends 'chatgpt'
        ? K
        : never;
}[ActiveModelId];

/** Active model identifiers hosted on DeepSeek. */
export type DeepSeekModelId = {
    [K in ActiveModelId]: (typeof MODEL_SPECS)[K]['provider'] extends 'deepseek'
        ? K
        : never;
}[ActiveModelId];

/**
 * Type predicate that narrows the model to the Claude-hosted subset.
 *
 * @param model - Active model identifier to test.
 * @returns `true` (narrowing to {@link ClaudeModelId}) when
 *   `MODEL_SPECS[model].provider === 'claude'`.
 */
export function isClaudeModel(model: ActiveModelId): model is ClaudeModelId {
    return MODEL_SPECS[model].provider === 'claude';
}

/**
 * Type predicate that narrows the model to the Gemini-hosted subset.
 *
 * @param model - Active model identifier to test.
 * @returns `true` (narrowing to {@link GeminiModelId}) when
 *   `MODEL_SPECS[model].provider === 'gemini'`.
 */
export function isGeminiModel(model: ActiveModelId): model is GeminiModelId {
    return MODEL_SPECS[model].provider === 'gemini';
}

/**
 * Type predicate that narrows the model to the ChatGPT-hosted subset.
 *
 * @param model - Active model identifier to test.
 * @returns `true` (narrowing to {@link ChatGPTModelId}) when
 *   `MODEL_SPECS[model].provider === 'chatgpt'`.
 */
export function isChatGPTModel(model: ActiveModelId): model is ChatGPTModelId {
    return MODEL_SPECS[model].provider === 'chatgpt';
}

/**
 * Type predicate that narrows the model to the DeepSeek-hosted subset.
 *
 * @param model - Active model identifier to test.
 * @returns `true` (narrowing to {@link DeepSeekModelId}) when
 *   `MODEL_SPECS[model].provider === 'deepseek'`.
 */
export function isDeepSeekModel(
    model: ActiveModelId
): model is DeepSeekModelId {
    return MODEL_SPECS[model].provider === 'deepseek';
}
