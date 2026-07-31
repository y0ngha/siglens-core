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
 * actions, and the UI all look this up directly.
 *
 * Adding a model is not a one-line change. Three sites must change together
 * for the model to actually reach consumers:
 * 1. The `TierModel` union (`domain/types.ts`) — omitting it makes the
 *    `satisfies` clause below fail to compile.
 * 2. A row in this map — omitting it also fails the `satisfies` clause above.
 * 3. The tier placement in `TIER_CONFIG.models` (`domain/tier.ts`) — **this is
 *    the one site the compiler does not catch.** Omitting it produces a
 *    model that `getAllowedModels` never returns, so no tier can select it
 *    (the coverage assertion in `tier.test.ts` guards this).
 *
 * After that, a core publish is required; consumers pick it up on a version
 * bump.
 *
 * Notes:
 * - Claude haiku: no thinking support (`thinkingBudget: 0`), uses temperature.
 * - Claude sonnet/opus: adaptive thinking via `effort`; no `budget_tokens`/temperature.
 * - Gemini: uses `thinkingBudget` as-is.
 * - GPT-5 series: maps `effort` to the Responses API `reasoning.effort`; does not accept temperature.
 * - DeepSeek V4: toggles reasoning with a boolean `thinking`; uses temperature only when non-thinking.
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
    // The Claude 5 generation's `claude-sonnet-5` / `claude-opus-5` ids are
    // themselves the complete model id Anthropic documents — appending a
    // dated snapshot suffix 404s (unlike older models such as
    // `claude-haiku-4-5-20251001`, which do have dated ids). The "no alias"
    // rule in the GPT-5.6 comment below targets routing aliases that resolve
    // to one of several models (`gpt-5.6` → sol); these ids are not that.
    'claude-sonnet-5': {
        provider: 'claude',
        apiModelId: 'claude-sonnet-5',
        // Sonnet 5 has adaptive thinking on by default, and thinking tokens
        // share the max_tokens budget. Reusing Sonnet 4.6's baseline (64K)
        // risks truncation, so we request the model ceiling (128K) instead.
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
    // Gemini thinking budgets split by how a model is used, not by
    // flash-vs-pro. The 2.5-generation flash/flash-lite models are cheap
    // helper models, so they get 8K; generation-3+ flash is Gemini's primary
    // reasoning line (3.6 Flash is the current GA top flash), so it gets the
    // same 32K as pro.
    'gemini-3.5-flash-lite': {
        provider: 'gemini',
        apiModelId: 'gemini-3.5-flash-lite',
        maxOutputTokens: 65_536,
        // flash-lite is the high-volume, low-latency line — same 8K budget as 2.5 flash-lite.
        thinkingBudget: 8_192,
        temperature: DEFAULT_TEMPERATURE,
    },
    'gemini-3.6-flash': {
        provider: 'gemini',
        apiModelId: 'gemini-3.6-flash',
        maxOutputTokens: 65_536,
        // Generation-3 primary flash line — same 32K budget as gemini-3-flash-preview.
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
    // The GPT-5.6 family pins explicit variant ids instead of the `gpt-5.6`
    // alias (which routes to sol), because a provider can silently repoint
    // an alias, and this repo binds analysis cache keys and response
    // characteristics to the model id.
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
