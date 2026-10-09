import type {
    ActiveModelId,
    AIProvider,
    GeminiThinkingLevel,
    ModelSpec,
} from '@/domain/types';

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
 * 3. The access placement in `FREE_MODELS` / `MEMBER_MODELS` / `BYOK_MODELS`
 *    (`domain/tier.ts`) — **this is the one site the compiler does not catch.**
 *    Omitting it makes `getModelAccess` throw and `getAllowedModels` never
 *    return the model (the coverage assertion in `tier.test.ts` guards this).
 *
 * After that, a core publish is required; consumers pick it up on a version
 * bump.
 *
 * ## The `reasoning` field
 *
 * Every spec carries both toggle states (`off` / `on`) and which one applies
 * when the caller expresses no preference (`default`). Free- and member-tier
 * models default to `off` so server-key spend stays predictable; BYOK models
 * keep their provider default.
 *
 * Two optional flags record what a model genuinely cannot do:
 * - `hardOff: false` — `off` is only the lowest strength the model accepts;
 *   it still spends thinking tokens.
 * - `toggleable: false` — `off` and `on` are identical, so the toggle cannot
 *   change the request and consumer UIs must disable it.
 *
 * Per-provider mapping:
 * - Claude `thinkingApi: 'budget'` (haiku): numeric `budget_tokens`; `0` disables.
 * - Claude `thinkingApi: 'adaptive'` (sonnet/opus/fable): `thinking.type` plus
 *   `output_config.effort`; no sampling temperature.
 * - Gemini: `thinkingConfig.thinkingLevel` string. The numeric `thinkingBudget`
 *   is NOT used — generation-3 models either reject it or ignore it silently.
 * - ChatGPT: `reasoning.effort` on the Responses API; no temperature.
 * - DeepSeek: boolean `thinking`; temperature applies only when thinking is off.
 */
export const MODEL_SPECS = {
    // ---------------------------------------------------------------- free
    'gpt-5.6-luna': {
        provider: 'chatgpt',
        apiModelId: 'gpt-5.6-luna',
        maxOutputTokens: 128_000,
        reasoning: {
            off: { effort: 'none' },
            on: { effort: 'high' },
            default: 'off',
        },
    },
    'gemini-3.5-flash-lite': {
        provider: 'gemini',
        apiModelId: 'gemini-3.5-flash-lite',
        maxOutputTokens: 65_536,
        temperature: DEFAULT_TEMPERATURE,
        reasoning: {
            // Measured 2026-09-06: `minimal` yields thoughtsTokenCount === 0
            // even on a prompt that demands multi-step reasoning.
            off: { level: 'minimal' },
            on: { level: 'high' },
            default: 'off',
        },
    },
    'deepseek-v4.1-flash': {
        provider: 'deepseek',
        // ⚠️ Key and apiModelId differ on purpose. `deepseek-v4.1-*` is a
        // version designation, NOT an API id — calling it returns 400
        // ("The supported API model names are deepseek-flash,
        // deepseek-v4-pro"). The API accepts exactly two ids, and
        // `deepseek-flash` is the canonical one for this line; the legacy
        // `deepseek-v4-flash` alias still resolves here but is documented as
        // retired, so we pin the canonical id. Verified live 2026-09-10.
        apiModelId: 'deepseek-flash',
        // DeepSeek V4.1 supports up to 384K (384 * 1024) output tokens.
        maxOutputTokens: 393_216,
        temperature: DEFAULT_TEMPERATURE,
        reasoning: {
            off: { thinking: false },
            on: { thinking: true },
            default: 'off',
        },
    },
    'gemini-3.6-flash': {
        provider: 'gemini',
        apiModelId: 'gemini-3.6-flash',
        maxOutputTokens: 65_536,
        temperature: DEFAULT_TEMPERATURE,
        reasoning: {
            // Measured 2026-09-06: `minimal` yields thoughtsTokenCount === 0
            // (omitting the config entirely yields 418).
            off: { level: 'minimal' },
            on: { level: 'high' },
            default: 'off',
        },
    },
    'claude-haiku-4-5': {
        provider: 'claude',
        thinkingApi: 'budget',
        // Older Claude models keep dated snapshot ids; the 4.6 generation
        // onward uses the dateless id as its own pinned snapshot.
        apiModelId: 'claude-haiku-4-5-20251001',
        maxOutputTokens: 64_000,
        temperature: DEFAULT_TEMPERATURE,
        reasoning: {
            // haiku is the lowest-latency free model and is deliberately kept
            // thinking-free. Enabling it would need a `budget_tokens >= 1024`
            // path plus verification that extended thinking tolerates
            // `temperature: 0` — for no product gain, since a user who wants
            // reasoning should pick a stronger model. `toggleable: false`
            // tells consumer UIs to disable the control rather than let a user
            // flip a switch that changes nothing.
            off: { budgetTokens: 0 },
            on: { budgetTokens: 0 },
            default: 'off',
            toggleable: false,
        },
    },

    // -------------------------------------------------------------- member
    'gemini-3.7-flash': {
        provider: 'gemini',
        apiModelId: 'gemini-3.7-flash',
        maxOutputTokens: 65_536,
        temperature: DEFAULT_TEMPERATURE,
        reasoning: {
            // Measured 2026-09-06: rejects `minimal` with a 400 and SILENTLY
            // IGNORES `thinkingBudget: 0` (176 thought tokens on a hard
            // prompt). `low` is the floor and still thinks (~158).
            off: { level: 'low' },
            on: { level: 'high' },
            default: 'off',
            hardOff: false,
        },
    },
    'gemini-3.8-flash': {
        provider: 'gemini',
        apiModelId: 'gemini-3.8-flash',
        maxOutputTokens: 65_536,
        temperature: DEFAULT_TEMPERATURE,
        reasoning: {
            // Measured 2026-09-06: same as 3.7-flash — `minimal` 400s and
            // `thinkingBudget: 0` is ignored (200 thoughts). Floor `low` (~178).
            off: { level: 'low' },
            on: { level: 'high' },
            default: 'off',
            hardOff: false,
        },
    },
    'deepseek-v4.1-pro': {
        provider: 'deepseek',
        // ⚠️ Key and apiModelId differ — see the flash row. `deepseek-v4-pro`
        // is the only id the API accepts for this line.
        //
        // ⏳ EXPIRES 2026-09-14: from 12:00 Beijing time that day, DeepSeek
        // routes every `deepseek-v4-pro` request to V4.1 Flash at Flash
        // pricing "until V4.1 Pro is released". From then until that release
        // this row is the same underlying model as `deepseek-v4.1-flash`, so
        // its `reasoning.on` (`thinking: true`) no longer buys a stronger
        // model — only a thinking-enabled Flash. Revisit the member-tier
        // placement when V4.1 Pro ships.
        apiModelId: 'deepseek-v4-pro',
        // DeepSeek V4.1 supports up to 384K (384 * 1024) output tokens.
        maxOutputTokens: 393_216,
        temperature: DEFAULT_TEMPERATURE,
        reasoning: {
            off: { thinking: false },
            on: { thinking: true },
            default: 'off',
        },
    },
    'claude-sonnet-5': {
        provider: 'claude',
        thinkingApi: 'adaptive',
        // The Claude 5 generation's ids are themselves the complete model id
        // Anthropic documents — appending a dated snapshot suffix 404s.
        apiModelId: 'claude-sonnet-5',
        // Sonnet 5 has adaptive thinking on by default, and thinking tokens
        // share the max_tokens budget, so we request the model ceiling.
        maxOutputTokens: 128_000,
        reasoning: {
            off: { mode: 'disabled' },
            on: { mode: 'adaptive', effort: 'high' },
            default: 'off',
        },
    },
    'gpt-5.6-terra': {
        provider: 'chatgpt',
        // The GPT-5.6 family pins explicit variant ids instead of the
        // `gpt-5.6` alias (which routes to sol), because a provider can
        // silently repoint an alias, and this repo binds analysis cache keys
        // and response characteristics to the model id.
        apiModelId: 'gpt-5.6-terra',
        maxOutputTokens: 128_000,
        reasoning: {
            off: { effort: 'none' },
            on: { effort: 'high' },
            default: 'off',
        },
    },
    'gemini-3.1-pro-preview': {
        provider: 'gemini',
        apiModelId: 'gemini-3.1-pro-preview',
        maxOutputTokens: 65_536,
        temperature: DEFAULT_TEMPERATURE,
        reasoning: {
            // Measured 2026-09-06: rejects both `thinkingBudget: 0`
            // ("This model only works in thinking mode") and `minimal`.
            // `low` is the floor and still spends ~400 thought tokens.
            off: { level: 'low' },
            on: { level: 'high' },
            default: 'off',
            hardOff: false,
        },
    },

    // ---------------------------------------------------------------- byok
    'gpt-5.6-sol': {
        provider: 'chatgpt',
        apiModelId: 'gpt-5.6-sol',
        maxOutputTokens: 128_000,
        reasoning: {
            off: { effort: 'none' },
            on: { effort: 'high' },
            default: 'on',
        },
    },
    'claude-opus-4-8': {
        provider: 'claude',
        thinkingApi: 'adaptive',
        apiModelId: 'claude-opus-4-8',
        maxOutputTokens: 128_000,
        reasoning: {
            off: { mode: 'disabled' },
            on: { mode: 'adaptive', effort: 'high' },
            default: 'on',
        },
    },
    'claude-opus-5': {
        provider: 'claude',
        thinkingApi: 'adaptive',
        apiModelId: 'claude-opus-5',
        maxOutputTokens: 128_000,
        reasoning: {
            // Opus 5 accepts `thinking: {type:'disabled'}` only while effort is
            // `high` or lower; pairing it with `xhigh`/`max` returns a 400.
            // Revisit this row if `on.effort` is ever raised past `high`.
            off: { mode: 'disabled' },
            on: { mode: 'adaptive', effort: 'high' },
            default: 'on',
        },
    },
    'claude-fable-5-1': {
        provider: 'claude',
        thinkingApi: 'adaptive',
        apiModelId: 'claude-fable-5-1',
        maxOutputTokens: 128_000,
        reasoning: {
            // Fable thinks unconditionally: both `{type:'disabled'}` and
            // `{type:'enabled', budget_tokens}` return 400. The lowest reachable
            // strength is adaptive thinking at `low` effort.
            off: { mode: 'adaptive', effort: 'low' },
            on: { mode: 'adaptive', effort: 'high' },
            default: 'on',
            hardOff: false,
        },
    },
    'gpt-6-astra': {
        provider: 'chatgpt',
        apiModelId: 'gpt-6-astra',
        maxOutputTokens: 128_000,
        reasoning: {
            // Unlike the 5.6 family, astra returns 400 for `effort: 'none'`.
            off: { effort: 'low' },
            on: { effort: 'high' },
            default: 'on',
            hardOff: false,
        },
    },
} as const satisfies Record<ActiveModelId, ModelSpec>;

/**
 * Gemini thinking levels ordered weakest to strongest.
 *
 * @internal
 */
const THINKING_LEVEL_ORDER: readonly GeminiThinkingLevel[] = [
    'minimal',
    'low',
    'medium',
    'high',
];

/**
 * Generate the MAX_TOKENS retry sequence for Gemini thinking-level reduction.
 *
 * When a Gemini call finishes with `MAX_TOKENS` the thinking budget consumed
 * the output allowance, so the retry steps thinking down one level at a time.
 * The sequence starts at `initial` and descends to `floor` inclusive.
 *
 * `floor` exists because the weakest level is per-model: `gemini-3.7-flash`,
 * `gemini-3.8-flash`, and `gemini-3.1-pro-preview` reject `'minimal'` with a
 * 400, so their floor is `'low'`. Pass `MODEL_SPECS[model].reasoning.off.level`
 * — the spec already records each model's floor.
 *
 * @param initial - Level to start from.
 * @param floor - Weakest level the model accepts.
 * @returns Strictly-descending levels from `initial` down to `floor`. Returns
 *   `[initial]` when `initial` is already at or below `floor`.
 */
export function getThinkingLevelSequence(
    initial: GeminiThinkingLevel,
    floor: GeminiThinkingLevel
): readonly GeminiThinkingLevel[] {
    const initialIndex = THINKING_LEVEL_ORDER.indexOf(initial);
    const floorIndex = THINKING_LEVEL_ORDER.indexOf(floor);
    if (initialIndex <= floorIndex) {
        return [initial];
    }
    return THINKING_LEVEL_ORDER.slice(floorIndex, initialIndex + 1).reverse();
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
 * 'openai'`) — including legacy model identifiers that are not in
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

/**
 * Reports whether the reasoning toggle changes anything for this model.
 *
 * Consumer UIs must disable the toggle when this returns `false` — the
 * model's `off` and `on` configurations are identical, so flipping the control
 * cannot alter the request. Leaving such a toggle live tells the user
 * something happened when nothing did.
 *
 * @param model - Active model identifier to test.
 * @returns `false` only for models whose spec sets `toggleable: false`.
 */
export function isReasoningToggleable(model: ActiveModelId): boolean {
    // Widen to `ModelSpec` before reading: `as const satisfies` keeps the
    // literal shape of each row, so a field only some rows declare is absent
    // from the inferred union.
    const spec: ModelSpec = MODEL_SPECS[model];
    return spec.reasoning.toggleable ?? true;
}

/**
 * Reports whether turning reasoning off actually removes it for this model.
 *
 * Successor to the removed `supportsDisabledThinking`. That helper asked
 * "does a literal `thinkingBudget: 0` avoid a 400?", which measured the wrong
 * thing: `gemini-3.7-flash` and `gemini-3.8-flash` accept the zero without
 * error and then think anyway, so they passed a check they should have failed.
 * This helper reads the spec's measured `hardOff` instead, and covers every
 * provider rather than Gemini alone.
 *
 * @param model - Active model identifier to test.
 * @returns `false` when the model still spends thinking tokens with reasoning off.
 */
export function supportsHardOff(model: ActiveModelId): boolean {
    // See the widening note in `isReasoningToggleable`.
    const spec: ModelSpec = MODEL_SPECS[model];
    return spec.reasoning.hardOff ?? true;
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
