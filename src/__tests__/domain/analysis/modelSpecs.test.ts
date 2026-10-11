import {
    getProvider,
    getThinkingLevelSequence,
    isChatGPTModel,
    isClaudeModel,
    isDeepSeekModel,
    isGeminiModel,
    isReasoningToggleable,
    MODEL_SPECS,
    supportsHardOff,
    type ChatGPTModelId,
    type ClaudeModelId,
    type DeepSeekModelId,
    type GeminiModelId,
} from '@/domain/analysis/modelSpecs';
import {
    isClaudeAdaptiveModelSpec,
    isClaudeBudgetModelSpec,
    isClaudeModelSpec,
    isTemperatureModelSpec,
    resolveReasoningConfig,
    type ActiveModelId,
    type ChatGPTModelSpec,
    type ClaudeAdaptiveModelSpec,
    type ClaudeBudgetModelSpec,
    type GeminiModelSpec,
    type ModelSpec,
} from '@/domain/types';
import { describe, expect, expectTypeOf, it } from 'vitest';

/** Every model the registry is expected to hold, in access-class order. */
const ALL_MODELS: readonly ActiveModelId[] = [
    // free
    'gpt-5.6-luna',
    'gemini-3.5-flash-lite',
    'deepseek-v4.1-flash',
    'gemini-3.6-flash',
    'claude-haiku-4-5',
    // member
    'gemini-3.8-flash',
    'deepseek-v4.1-pro',
    'claude-sonnet-5',
    'gpt-5.6-terra',
    'gemini-3.1-pro-preview',
    // byok
    'gpt-5.6-sol',
    'claude-opus-4-8',
    'claude-opus-5',
    'claude-fable-5-1',
    'gpt-6-astra',
];

/**
 * Identifiers removed in the 2026-09 registry restructure, including the two
 * deprecated Claude 4 aliases whose replacement models were themselves removed.
 */
const REMOVED_MODEL_IDS: readonly string[] = [
    'claude-sonnet-4-6',
    'claude-opus-4-7',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',
    'gemini-3-flash-preview',
    'gpt-5-mini',
    'gpt-5.4',
    'gpt-5.5',
    'claude-sonnet-4',
    'claude-opus-4',
];

describe('MODEL_SPECS', () => {
    it('covers every active model identifier exactly once', () => {
        expect(Object.keys(MODEL_SPECS).toSorted()).toEqual(
            [...ALL_MODELS].toSorted()
        );
    });

    it('holds no identifier removed in the registry restructure', () => {
        for (const removed of REMOVED_MODEL_IDS) {
            expect(Object.keys(MODEL_SPECS), removed).not.toContain(removed);
        }
    });

    it('keys every apiModelId to its own row, except where the provider names it differently', () => {
        /** Rows whose provider id genuinely differs from our registry key. */
        const RENAMED: Record<string, string> = {
            // Pre-4.6 Claude models keep a dated snapshot id; 4.6 onward the
            // dateless id IS the pinned snapshot and a date suffix 404s.
            'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
            // `deepseek-v4.1-*` is a version designation, not an API id —
            // sending it returns 400. The API accepts only these two.
            'deepseek-v4.1-flash': 'deepseek-flash',
            'deepseek-v4.1-pro': 'deepseek-v4-pro',
        };
        for (const [model, spec] of Object.entries(MODEL_SPECS)) {
            expect(spec.apiModelId, model).toBe(RENAMED[model] ?? model);
        }
    });

    it('carries temperature only on specs whose provider accepts sampling', () => {
        for (const [model, spec] of Object.entries(MODEL_SPECS)) {
            // Adaptive-thinking Claude and every GPT reasoning model reject
            // sampling parameters outright. Gemini ignores them from 3.6 Flash
            // on and announced a 400 for them on upcoming models.
            const acceptsSampling =
                spec.provider === 'deepseek' || model === 'claude-haiku-4-5';
            expect('temperature' in spec, model).toBe(acceptsSampling);
            if ('temperature' in spec) {
                expect(spec.temperature, model).toBe(0);
            }
        }
    });

    it('keeps max output tokens aligned with each provider cap', () => {
        expect(MODEL_SPECS['claude-haiku-4-5'].maxOutputTokens).toBe(64_000);

        for (const [model, spec] of Object.entries(MODEL_SPECS)) {
            if (spec.provider === 'gemini') {
                expect(spec.maxOutputTokens, model).toBe(65_536);
            } else if (spec.provider === 'chatgpt') {
                expect(spec.maxOutputTokens, model).toBe(128_000);
            } else if (spec.provider === 'deepseek') {
                // DeepSeek V4.1 supports 384K (384 * 1024) output tokens.
                expect(spec.maxOutputTokens, model).toBe(393_216);
            } else if (model !== 'claude-haiku-4-5') {
                // Adaptive-thinking Claude shares max_tokens with thinking, so
                // every one of them requests the 128K ceiling.
                expect(spec.maxOutputTokens, model).toBe(128_000);
            }
        }
    });

    it('splits Claude specs by thinking API', () => {
        // haiku is the only pre-4.6 model left, so it is the only budget spec.
        expect(MODEL_SPECS['claude-haiku-4-5'].thinkingApi).toBe('budget');
        for (const model of [
            'claude-sonnet-5',
            'claude-opus-4-8',
            'claude-opus-5',
            'claude-fable-5-1',
        ] as const) {
            expect(MODEL_SPECS[model].thinkingApi, model).toBe('adaptive');
        }
    });

    it('gives every spec both toggle states and a default', () => {
        for (const [model, spec] of Object.entries(MODEL_SPECS)) {
            expect(spec.reasoning.off, model).toBeDefined();
            expect(spec.reasoning.on, model).toBeDefined();
            expect(['off', 'on'], model).toContain(spec.reasoning.default);
        }
    });

    it('uses the provider-appropriate config shape on both toggle states', () => {
        for (const [model, rawSpec] of Object.entries(MODEL_SPECS)) {
            const spec: ModelSpec = rawSpec;
            for (const state of [spec.reasoning.off, spec.reasoning.on]) {
                switch (spec.provider) {
                    case 'gemini':
                        expect(state, model).toHaveProperty('level');
                        break;
                    case 'chatgpt':
                        expect(state, model).toHaveProperty('effort');
                        break;
                    case 'deepseek':
                        expect(state, model).toHaveProperty('thinking');
                        break;
                    case 'claude':
                        expect(
                            spec.thinkingApi === 'adaptive'
                                ? 'mode' in state
                                : 'budgetTokens' in state,
                            model
                        ).toBe(true);
                        break;
                }
            }
        }
    });
});

describe('supportsHardOff', () => {
    /**
     * Models that cannot remove reasoning entirely. Every entry is a live
     * measurement, not an inference from the model name — see the per-row
     * comments in `MODEL_SPECS`.
     */
    const PARTIAL_OFF_MODELS: readonly ActiveModelId[] = [
        'gemini-3.8-flash',
        'gemini-3.1-pro-preview',
        'claude-fable-5-1',
        'gpt-6-astra',
    ];

    it('reports false for exactly the models that cannot disable reasoning', () => {
        const actual = ALL_MODELS.filter(model => !supportsHardOff(model));
        expect(actual.toSorted()).toEqual([...PARTIAL_OFF_MODELS].toSorted());
    });

    it('reports true for every other model', () => {
        for (const model of ALL_MODELS) {
            if (PARTIAL_OFF_MODELS.includes(model)) continue;
            expect(supportsHardOff(model), model).toBe(true);
        }
    });

    it('keeps a partial-off Gemini model off the `minimal` level it rejects', () => {
        // gemini-3.8-flash / 3.1-pro-preview return 400 for `minimal`, so
        // their off state must bottom out at `low`.
        for (const model of [
            'gemini-3.8-flash',
            'gemini-3.1-pro-preview',
        ] as const) {
            expect(MODEL_SPECS[model].reasoning.off.level, model).toBe('low');
        }
    });

    it('uses `minimal` for the two Gemini models measured at zero thought tokens', () => {
        for (const model of [
            'gemini-3.5-flash-lite',
            'gemini-3.6-flash',
        ] as const) {
            expect(MODEL_SPECS[model].reasoning.off.level, model).toBe(
                'minimal'
            );
        }
    });
});

describe('isReasoningToggleable', () => {
    it('reports false only for claude-haiku-4-5', () => {
        const actual = ALL_MODELS.filter(
            model => !isReasoningToggleable(model)
        );
        expect(actual).toEqual(['claude-haiku-4-5']);
    });

    it('gives a non-toggleable model identical off and on states', () => {
        // The invariant behind the disabled toggle: if these ever diverged, a
        // consumer UI would block a control that actually changes the request.
        for (const model of ALL_MODELS) {
            if (isReasoningToggleable(model)) continue;
            const spec: ModelSpec = MODEL_SPECS[model];
            expect(spec.reasoning.off, model).toEqual(spec.reasoning.on);
        }
    });

    it('gives every toggleable model states that actually differ', () => {
        for (const model of ALL_MODELS) {
            if (!isReasoningToggleable(model)) continue;
            const spec: ModelSpec = MODEL_SPECS[model];
            expect(spec.reasoning.off, model).not.toEqual(spec.reasoning.on);
        }
    });
});

describe('resolveReasoningConfig', () => {
    it('returns the off state for false and the on state for true', () => {
        const spec: GeminiModelSpec = MODEL_SPECS['gemini-3.6-flash'];
        expect(resolveReasoningConfig(spec.reasoning, false)).toEqual({
            level: 'minimal',
        });
        expect(resolveReasoningConfig(spec.reasoning, true)).toEqual({
            level: 'high',
        });
    });

    it('falls back to the spec default when the caller has no preference', () => {
        const free: GeminiModelSpec = MODEL_SPECS['gemini-3.6-flash'];
        expect(resolveReasoningConfig(free.reasoning, undefined)).toEqual(
            free.reasoning.off
        );

        const byok: ClaudeAdaptiveModelSpec = MODEL_SPECS['claude-opus-5'];
        expect(resolveReasoningConfig(byok.reasoning, undefined)).toEqual(
            byok.reasoning.on
        );
    });
});

describe('getThinkingLevelSequence', () => {
    it('descends from the initial level to the floor inclusive', () => {
        expect(getThinkingLevelSequence('high', 'minimal')).toEqual([
            'high',
            'medium',
            'low',
            'minimal',
        ]);
    });

    it('stops at a raised floor', () => {
        expect(getThinkingLevelSequence('high', 'low')).toEqual([
            'high',
            'medium',
            'low',
        ]);
    });

    it('returns a single step when the initial level is already the floor', () => {
        expect(getThinkingLevelSequence('low', 'low')).toEqual(['low']);
    });

    it('returns a single step when the initial level is below the floor', () => {
        // Defensive: a caller should never start below its own floor, but the
        // sequence must not silently climb back up if one does.
        expect(getThinkingLevelSequence('minimal', 'low')).toEqual(['minimal']);
    });

    it('never repeats a level', () => {
        const sequence = getThinkingLevelSequence('high', 'minimal');
        expect(new Set(sequence).size).toBe(sequence.length);
    });
});

describe('getProvider', () => {
    it('routes Claude models to the claude provider', () => {
        expect(getProvider('claude-haiku-4-5')).toBe('claude');
        expect(getProvider('claude-sonnet-5')).toBe('claude');
        expect(getProvider('claude-fable-5-1')).toBe('claude');
    });

    it('routes Gemini models to the gemini provider', () => {
        expect(getProvider('gemini-3.6-flash')).toBe('gemini');
        expect(getProvider('gemini-3.8-flash')).toBe('gemini');
    });

    it('routes GPT models to the chatgpt provider', () => {
        expect(getProvider('gpt-5.6-luna')).toBe('chatgpt');
        expect(getProvider('gpt-6-astra')).toBe('chatgpt');
    });

    it('routes DeepSeek models to the deepseek provider', () => {
        expect(getProvider('deepseek-v4.1-flash')).toBe('deepseek');
        expect(getProvider('deepseek-v4.1-pro')).toBe('deepseek');
    });
});

describe('provider type guards', () => {
    it('partitions every model into exactly one provider', () => {
        for (const model of ALL_MODELS) {
            const matches = [
                isClaudeModel(model),
                isGeminiModel(model),
                isChatGPTModel(model),
                isDeepSeekModel(model),
            ].filter(Boolean);
            expect(matches.length, model).toBe(1);
        }
    });

    it('isClaudeModel narrows ActiveModelId to ClaudeModelId at the type level', () => {
        const model = 'claude-opus-5' as ActiveModelId;
        if (isClaudeModel(model)) {
            expectTypeOf(model).toEqualTypeOf<ClaudeModelId>();
        }
    });

    it('isGeminiModel narrows ActiveModelId to GeminiModelId at the type level', () => {
        const model = 'gemini-3.6-flash' as ActiveModelId;
        if (isGeminiModel(model)) {
            expectTypeOf(model).toEqualTypeOf<GeminiModelId>();
        }
    });

    it('isChatGPTModel narrows ActiveModelId to ChatGPTModelId at the type level', () => {
        const model = 'gpt-5.6-sol' as ActiveModelId;
        if (isChatGPTModel(model)) {
            expectTypeOf(model).toEqualTypeOf<ChatGPTModelId>();
        }
    });

    it('isDeepSeekModel narrows ActiveModelId to DeepSeekModelId at the type level', () => {
        const model = 'deepseek-v4.1-pro' as ActiveModelId;
        if (isDeepSeekModel(model)) {
            expectTypeOf(model).toEqualTypeOf<DeepSeekModelId>();
        }
    });
});

describe('spec type guards', () => {
    it('isClaudeModelSpec matches every Claude spec regardless of thinking API', () => {
        for (const model of ALL_MODELS) {
            const spec: ModelSpec = MODEL_SPECS[model];
            expect(isClaudeModelSpec(spec), model).toBe(
                spec.provider === 'claude'
            );
        }
    });

    it('isClaudeAdaptiveModelSpec excludes the budget-based haiku spec', () => {
        const haiku: ModelSpec = MODEL_SPECS['claude-haiku-4-5'];
        const sonnet: ModelSpec = MODEL_SPECS['claude-sonnet-5'];
        expect(isClaudeAdaptiveModelSpec(haiku)).toBe(false);
        expect(isClaudeAdaptiveModelSpec(sonnet)).toBe(true);
    });

    it('isClaudeBudgetModelSpec matches only the haiku spec', () => {
        for (const model of ALL_MODELS) {
            const spec: ModelSpec = MODEL_SPECS[model];
            expect(isClaudeBudgetModelSpec(spec), model).toBe(
                model === 'claude-haiku-4-5'
            );
        }
    });

    it('isTemperatureModelSpec matches exactly the specs that carry a temperature', () => {
        for (const model of ALL_MODELS) {
            const spec: ModelSpec = MODEL_SPECS[model];
            expect(isTemperatureModelSpec(spec), model).toBe(
                'temperature' in spec
            );
        }
    });

    it('narrows to the adaptive Claude spec and exposes its reasoning modes', () => {
        const spec: ModelSpec = MODEL_SPECS['claude-opus-5'];
        if (isClaudeAdaptiveModelSpec(spec)) {
            expectTypeOf(spec).toEqualTypeOf<ClaudeAdaptiveModelSpec>();
            expect(spec.reasoning.on).toEqual({
                mode: 'adaptive',
                effort: 'high',
            });
        }
    });

    it('narrows to the budget Claude spec and exposes its budget tokens', () => {
        const spec: ModelSpec = MODEL_SPECS['claude-haiku-4-5'];
        if (isClaudeBudgetModelSpec(spec)) {
            expectTypeOf(spec).toEqualTypeOf<ClaudeBudgetModelSpec>();
            expect(spec.reasoning.off.budgetTokens).toBe(0);
        }
    });

    it('narrows a ChatGPT spec through its provider discriminant', () => {
        const spec: ModelSpec = MODEL_SPECS['gpt-5.6-terra'];
        if (spec.provider === 'chatgpt') {
            expectTypeOf(spec).toEqualTypeOf<ChatGPTModelSpec>();
            expect(spec.reasoning.off).toEqual({ effort: 'none' });
        }
    });
});
