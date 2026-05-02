import type { TierModel } from '@/domain/types';

/**
 * Deprecated AI model identifiers retained in {@link TierModel} for
 * backward-compatibility with consumers that still reference the older labels.
 * Active SDK call configuration ({@link MODEL_SPECS}) is keyed by
 * {@link ActiveModelId} so deprecated identifiers are intentionally excluded.
 */
type DeprecatedModelId = 'claude-sonnet-4' | 'claude-opus-4';

/**
 * Active AI model identifiers — the subset of {@link TierModel} that
 * `siglens-worker` actually invokes. Deprecated aliases are filtered out.
 */
export type ActiveModelId = Exclude<TierModel, DeprecatedModelId>;

/** AI provider that hosts a model. */
export type AIProvider = 'claude' | 'gemini' | 'chatgpt';

/**
 * Per-model SDK call parameters.
 *
 * Single source of truth for everything a worker / SDK adapter needs to call
 * the model — provider routing, output limits, thinking budget, sampling
 * parameters. `siglens-worker` reads this map; new model additions add a row
 * here and the worker picks them up after the next core publish.
 */
export interface ModelSpec {
    /** Provider that hosts the model (drives SDK selection). */
    provider: AIProvider;
    /** Provider-side max output tokens cap. */
    maxOutputTokens: number;
    /**
     * Initial thinking budget. `0` means the model does not support thinking
     * (e.g. `claude-haiku-3-5`, GPT-5 series).
     */
    thinkingBudget: number;
    /** Sampling temperature. */
    temperature: number;
    /** Top-p nucleus sampling parameter. */
    topP: number;
}

/**
 * Per-model AI SDK call parameters keyed by {@link ActiveModelId}.
 *
 * Consumed by `siglens-worker` as the single source of truth for SDK
 * invocation. Adding a new model is a one-row change here followed by a core
 * publish — the worker picks it up automatically.
 *
 * Notes:
 * - Claude `maxOutputTokens` follow Anthropic SDK 0.92.0 caps
 *   (haiku-3-5: 8K, sonnet-4-6 / opus-4-7: 128K).
 * - All Gemini models share `maxOutputTokens: 65_536` per existing worker policy.
 * - GPT-5 series use 128K max output tokens.
 * - `thinkingBudget: 0` indicates the model does not support thinking.
 */
export const MODEL_SPECS = {
    'claude-haiku-3-5': {
        provider: 'claude',
        maxOutputTokens: 8_192,
        thinkingBudget: 0,
        temperature: 0,
        topP: 0.95,
    },
    'claude-sonnet-4-6': {
        provider: 'claude',
        maxOutputTokens: 128_000,
        thinkingBudget: 32_000,
        temperature: 0,
        topP: 0.95,
    },
    'claude-opus-4-7': {
        provider: 'claude',
        maxOutputTokens: 128_000,
        thinkingBudget: 32_000,
        temperature: 0,
        topP: 0.95,
    },
    'gemini-2.5-flash': {
        provider: 'gemini',
        maxOutputTokens: 65_536,
        thinkingBudget: 32_768,
        temperature: 0,
        topP: 0.95,
    },
    'gemini-2.5-flash-lite': {
        provider: 'gemini',
        maxOutputTokens: 65_536,
        thinkingBudget: 24_576,
        temperature: 0,
        topP: 0.95,
    },
    'gemini-2.5-pro': {
        provider: 'gemini',
        maxOutputTokens: 65_536,
        thinkingBudget: 32_768,
        temperature: 0,
        topP: 0.95,
    },
    'gemini-3-flash-preview': {
        provider: 'gemini',
        maxOutputTokens: 65_536,
        thinkingBudget: 32_768,
        temperature: 0,
        topP: 0.95,
    },
    'gemini-3.1-pro-preview': {
        provider: 'gemini',
        maxOutputTokens: 65_536,
        thinkingBudget: 32_768,
        temperature: 0,
        topP: 0.95,
    },
    'gpt-5-mini': {
        provider: 'chatgpt',
        maxOutputTokens: 128_000,
        thinkingBudget: 0,
        temperature: 0,
        topP: 0.95,
    },
    'gpt-5.4': {
        provider: 'chatgpt',
        maxOutputTokens: 128_000,
        thinkingBudget: 0,
        temperature: 0,
        topP: 0.95,
    },
    'gpt-5.5': {
        provider: 'chatgpt',
        maxOutputTokens: 128_000,
        thinkingBudget: 0,
        temperature: 0,
        topP: 0.95,
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
 */
export function getThinkingBudgetSequence(initial: number): readonly number[] {
    const candidates = [
        initial,
        Math.floor(initial / 2),
        Math.floor(initial / 4),
        ...THINKING_BUDGET_FALLBACK_STEPS,
        DISABLED_THINKING_BUDGET,
    ];
    return candidates.reduce<number[]>((acc, budget) => {
        if (acc.length === 0 || budget < acc[acc.length - 1]) {
            return [...acc, budget];
        }
        return acc;
    }, []);
}

/** Resolve the hosting provider for an active model identifier. */
export function getProvider(model: ActiveModelId): AIProvider {
    return MODEL_SPECS[model].provider;
}

/** Returns true when the model is hosted on Claude. */
export function isClaudeModel(model: ActiveModelId): boolean {
    return MODEL_SPECS[model].provider === 'claude';
}

/** Returns true when the model is hosted on Gemini. */
export function isGeminiModel(model: ActiveModelId): boolean {
    return MODEL_SPECS[model].provider === 'gemini';
}

/** Returns true when the model is hosted on ChatGPT (OpenAI). */
export function isChatGPTModel(model: ActiveModelId): boolean {
    return MODEL_SPECS[model].provider === 'chatgpt';
}
