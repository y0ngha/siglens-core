import type { ActiveModelId, AIProvider, ModelSpec } from '@/domain/types';

/**
 * Default sampling temperature applied to every model.
 *
 * `as const` preserves the literal `0` type so that
 * `MODEL_SPECS[X].temperature` infers as `0` rather than widening to `number`.
 */
const DEFAULT_TEMPERATURE = 0 as const;

/**
 * Default top-p nucleus-sampling value applied to every model.
 *
 * `as const` preserves the literal `0.95` type so that
 * `MODEL_SPECS[X].topP` infers as `0.95` rather than widening to `number`.
 */
const DEFAULT_TOP_P = 0.95 as const;

/**
 * Per-model AI SDK call parameters keyed by {@link ActiveModelId}.
 *
 * Single source of truth for AI SDK callers (workers, server actions, UI).
 * Adding a new model is a one-row change here followed by a core publish — all
 * downstream callers pick it up automatically on upgrade.
 *
 * Notes:
 * - Claude `maxOutputTokens` follow Anthropic SDK 0.92.0 caps
 *   (haiku-3-5: 8K, sonnet-4-6 / opus-4-7: 128K).
 * - All Gemini models share `maxOutputTokens: 65_536` per existing policy.
 * - GPT-5 series use 128K max output tokens.
 * - `thinkingBudget: 0` indicates the model does not support thinking.
 */
export const MODEL_SPECS = {
    'claude-haiku-3-5': {
        provider: 'claude',
        maxOutputTokens: 8_192,
        thinkingBudget: 0,
        temperature: DEFAULT_TEMPERATURE,
        topP: DEFAULT_TOP_P,
    },
    'claude-sonnet-4-6': {
        provider: 'claude',
        maxOutputTokens: 128_000,
        thinkingBudget: 32_000,
        temperature: DEFAULT_TEMPERATURE,
        topP: DEFAULT_TOP_P,
    },
    'claude-opus-4-7': {
        provider: 'claude',
        maxOutputTokens: 128_000,
        thinkingBudget: 32_000,
        temperature: DEFAULT_TEMPERATURE,
        topP: DEFAULT_TOP_P,
    },
    'gemini-2.5-flash': {
        provider: 'gemini',
        maxOutputTokens: 65_536,
        thinkingBudget: 32_768,
        temperature: DEFAULT_TEMPERATURE,
        topP: DEFAULT_TOP_P,
    },
    'gemini-2.5-flash-lite': {
        provider: 'gemini',
        maxOutputTokens: 65_536,
        thinkingBudget: 24_576,
        temperature: DEFAULT_TEMPERATURE,
        topP: DEFAULT_TOP_P,
    },
    'gemini-2.5-pro': {
        provider: 'gemini',
        maxOutputTokens: 65_536,
        thinkingBudget: 32_768,
        temperature: DEFAULT_TEMPERATURE,
        topP: DEFAULT_TOP_P,
    },
    'gemini-3-flash-preview': {
        provider: 'gemini',
        maxOutputTokens: 65_536,
        thinkingBudget: 32_768,
        temperature: DEFAULT_TEMPERATURE,
        topP: DEFAULT_TOP_P,
    },
    'gemini-3.1-pro-preview': {
        provider: 'gemini',
        maxOutputTokens: 65_536,
        thinkingBudget: 32_768,
        temperature: DEFAULT_TEMPERATURE,
        topP: DEFAULT_TOP_P,
    },
    'gpt-5-mini': {
        provider: 'chatgpt',
        maxOutputTokens: 128_000,
        thinkingBudget: 0,
        temperature: DEFAULT_TEMPERATURE,
        topP: DEFAULT_TOP_P,
    },
    'gpt-5.4': {
        provider: 'chatgpt',
        maxOutputTokens: 128_000,
        thinkingBudget: 0,
        temperature: DEFAULT_TEMPERATURE,
        topP: DEFAULT_TOP_P,
    },
    'gpt-5.5': {
        provider: 'chatgpt',
        maxOutputTokens: 128_000,
        thinkingBudget: 0,
        temperature: DEFAULT_TEMPERATURE,
        topP: DEFAULT_TOP_P,
    },
} as const satisfies Record<ActiveModelId, ModelSpec>;

/** Standard thinking-budget fallback steps used when MAX_TOKENS retry occurs. */
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
 * 'chatgpt'`) used by `MODEL_SPECS`. Use this when you need the human-facing
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
