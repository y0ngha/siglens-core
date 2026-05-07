import {
    DISABLED_THINKING_BUDGET,
    getProvider,
    getThinkingBudgetSequence,
    isChatGPTModel,
    isClaudeModel,
    isGeminiModel,
    MODEL_SPECS,
    THINKING_BUDGET_FALLBACK_STEPS,
    type ChatGPTModelId,
    type ClaudeModelId,
    type GeminiModelId,
} from '@/domain/analysis/modelSpecs';
import {
    type ActiveModelId,
    type ChatGPTModelSpec,
    type ClaudeReasoningModelSpec,
    type ClaudeSamplingModelSpec,
    type GeminiModelSpec,
    type ModelSpec,
    isClaudeReasoningModelSpec,
    isClaudeSamplingModelSpec,
    isReasoningModelSpec,
    isSamplingModelSpec,
} from '@/domain/types';
import { describe, expect, expectTypeOf, it } from 'vitest';

describe('MODEL_SPECS', () => {
    it('covers every active model identifier exactly once', () => {
        const expected: readonly ActiveModelId[] = [
            'claude-haiku-4-5',
            'claude-sonnet-4-6',
            'claude-opus-4-7',
            'gemini-2.5-flash',
            'gemini-2.5-flash-lite',
            'gemini-2.5-pro',
            'gemini-3-flash-preview',
            'gemini-3.1-pro-preview',
            'gpt-5-mini',
            'gpt-5.4',
            'gpt-5.5',
        ];
        expect(Object.keys(MODEL_SPECS).toSorted()).toEqual(
            [...expected].toSorted()
        );
    });

    it('uses temperature only for providers that support sampling temperature', () => {
        for (const [model, spec] of Object.entries(MODEL_SPECS)) {
            if (spec.provider === 'gemini' || model === 'claude-haiku-4-5') {
                expect('temperature' in spec, model).toBe(true);
                if ('temperature' in spec) {
                    expect(spec.temperature, model).toBe(0);
                }
            } else {
                expect('temperature' in spec, model).toBe(false);
            }
        }
    });

    it('keeps Claude max output tokens aligned with current provider caps', () => {
        expect(MODEL_SPECS['claude-haiku-4-5'].maxOutputTokens).toBe(64_000);
        expect(MODEL_SPECS['claude-sonnet-4-6'].maxOutputTokens).toBe(64_000);
        expect(MODEL_SPECS['claude-opus-4-7'].maxOutputTokens).toBe(128_000);
    });

    it('uses 65_536 max output tokens for every Gemini model', () => {
        for (const [model, spec] of Object.entries(MODEL_SPECS)) {
            if (spec.provider === 'gemini') {
                expect(spec.maxOutputTokens, model).toBe(65_536);
            }
        }
    });

    it('uses 128_000 max output tokens for every GPT model', () => {
        for (const [model, spec] of Object.entries(MODEL_SPECS)) {
            if (spec.provider === 'chatgpt') {
                expect(spec.maxOutputTokens, model).toBe(128_000);
            }
        }
    });

    it('disables thinking budget for haiku', () => {
        expect(MODEL_SPECS['claude-haiku-4-5'].thinkingBudget).toBe(0);
    });

    it('uses effort instead of thinking budget for Claude adaptive thinking and GPT reasoning models', () => {
        expect(MODEL_SPECS['claude-sonnet-4-6'].effort).toBe('high');
        expect(MODEL_SPECS['claude-opus-4-7'].effort).toBe('high');
        expect(MODEL_SPECS['gpt-5-mini'].effort).toBe('medium');
        expect(MODEL_SPECS['gpt-5.4'].effort).toBe('high');
        expect(MODEL_SPECS['gpt-5.5'].effort).toBe('high');
    });

    it('does not include temperature on GPT reasoning model specs', () => {
        expect('temperature' in MODEL_SPECS['gpt-5-mini']).toBe(false);
        expect('temperature' in MODEL_SPECS['gpt-5.4']).toBe(false);
        expect('temperature' in MODEL_SPECS['gpt-5.5']).toBe(false);
    });

    it('keeps gemini-2.5-flash-lite at the documented 24_576 thinking budget', () => {
        expect(MODEL_SPECS['gemini-2.5-flash-lite'].thinkingBudget).toBe(
            24_576
        );
    });

    it('uses 32_768 thinking budget for the remaining Gemini models', () => {
        const otherGemini = [
            'gemini-2.5-flash',
            'gemini-2.5-pro',
            'gemini-3-flash-preview',
            'gemini-3.1-pro-preview',
        ] as const;
        for (const model of otherGemini) {
            expect(MODEL_SPECS[model].thinkingBudget, model).toBe(32_768);
        }
    });
});

describe('getProvider', () => {
    it('routes Claude models to the claude provider', () => {
        expect(getProvider('claude-haiku-4-5')).toBe('claude');
        expect(getProvider('claude-sonnet-4-6')).toBe('claude');
        expect(getProvider('claude-opus-4-7')).toBe('claude');
    });

    it('routes Gemini models to the gemini provider', () => {
        expect(getProvider('gemini-2.5-flash')).toBe('gemini');
        expect(getProvider('gemini-3.1-pro-preview')).toBe('gemini');
    });

    it('routes GPT models to the chatgpt provider', () => {
        expect(getProvider('gpt-5-mini')).toBe('chatgpt');
        expect(getProvider('gpt-5.5')).toBe('chatgpt');
    });
});

describe('provider type guards', () => {
    it('isClaudeModel matches only Claude entries', () => {
        expect(isClaudeModel('claude-opus-4-7')).toBe(true);
        expect(isClaudeModel('gemini-2.5-flash')).toBe(false);
        expect(isClaudeModel('gpt-5-mini')).toBe(false);
    });

    it('isGeminiModel matches only Gemini entries', () => {
        expect(isGeminiModel('gemini-2.5-pro')).toBe(true);
        expect(isGeminiModel('claude-haiku-4-5')).toBe(false);
        expect(isGeminiModel('gpt-5.4')).toBe(false);
    });

    it('isChatGPTModel matches only GPT entries', () => {
        expect(isChatGPTModel('gpt-5.5')).toBe(true);
        expect(isChatGPTModel('claude-sonnet-4-6')).toBe(false);
        expect(isChatGPTModel('gemini-3-flash-preview')).toBe(false);
    });

    it('isClaudeModel narrows ActiveModelId to ClaudeModelId at the type level', () => {
        const model = 'claude-opus-4-7' as ActiveModelId;
        if (isClaudeModel(model)) {
            // Compile-time assertion: narrowed identifier assigns to the
            // Claude-only subset without a cast.
            const narrowed: ClaudeModelId = model;
            expect(MODEL_SPECS[narrowed].provider).toBe('claude');
        } else {
            throw new Error('expected claude-opus-4-7 to narrow to Claude');
        }
    });

    it('isGeminiModel narrows ActiveModelId to GeminiModelId at the type level', () => {
        const model = 'gemini-2.5-pro' as ActiveModelId;
        if (isGeminiModel(model)) {
            const narrowed: GeminiModelId = model;
            expect(MODEL_SPECS[narrowed].provider).toBe('gemini');
        } else {
            throw new Error('expected gemini-2.5-pro to narrow to Gemini');
        }
    });

    it('isChatGPTModel narrows ActiveModelId to ChatGPTModelId at the type level', () => {
        const model = 'gpt-5.5' as ActiveModelId;
        if (isChatGPTModel(model)) {
            const narrowed: ChatGPTModelId = model;
            expect(MODEL_SPECS[narrowed].provider).toBe('chatgpt');
        } else {
            throw new Error('expected gpt-5.5 to narrow to ChatGPT');
        }
    });
});

describe('getThinkingBudgetSequence', () => {
    it('returns full descending sequence with two halving steps for high initial value', () => {
        // 32000 → 16000 → 8000 → fallback steps (8192 skipped, >= previous) → 4096 → 2048 → 0
        expect(getThinkingBudgetSequence(32000)).toEqual([
            32000,
            16000,
            8000,
            4096,
            2048,
            DISABLED_THINKING_BUDGET,
        ]);
    });

    it('halves twice before falling into the fallback steps for the Gemini default budget', () => {
        // 24576 → 12288 → 6144 → fallback steps (8192 skipped, 4096 added) → 2048 → 0
        expect(getThinkingBudgetSequence(24576)).toEqual([
            24576,
            12288,
            6144,
            4096,
            2048,
            DISABLED_THINKING_BUDGET,
        ]);
    });

    it('deduplicates halving values that match standard candidates', () => {
        // 8192 → 4096 (dup with halving) → 2048 → 0
        expect(getThinkingBudgetSequence(8192)).toEqual([
            THINKING_BUDGET_FALLBACK_STEPS[0],
            THINKING_BUDGET_FALLBACK_STEPS[1],
            THINKING_BUDGET_FALLBACK_STEPS[2],
            DISABLED_THINKING_BUDGET,
        ]);
    });

    it('excludes candidates greater than or equal to the previous step', () => {
        // 4096 → 2048 → 1024 → fallback steps (all skipped) → 0
        expect(getThinkingBudgetSequence(4096)).toEqual([
            4096,
            2048,
            1024,
            DISABLED_THINKING_BUDGET,
        ]);
    });

    it('returns only zero when initial is zero', () => {
        expect(getThinkingBudgetSequence(0)).toEqual([
            DISABLED_THINKING_BUDGET,
        ]);
    });

    it('includes both halvings when both fall between standard candidates', () => {
        // 18000 → 9000 → 4500 → fallback (8192 skipped, 4096 added, 2048 added) → 0
        expect(getThinkingBudgetSequence(18000)).toEqual([
            18000,
            9000,
            4500,
            4096,
            2048,
            DISABLED_THINKING_BUDGET,
        ]);
    });

    it('skips halving when it equals a standard candidate', () => {
        // 16384 → 8192 (dup) → 4096 (dup) → fallback (only 2048 added) → 0
        expect(getThinkingBudgetSequence(16384)).toEqual([
            16384,
            THINKING_BUDGET_FALLBACK_STEPS[0],
            THINKING_BUDGET_FALLBACK_STEPS[1],
            THINKING_BUDGET_FALLBACK_STEPS[2],
            DISABLED_THINKING_BUDGET,
        ]);
    });

    it('exposes the standard fallback steps tuple unchanged', () => {
        expect(THINKING_BUDGET_FALLBACK_STEPS).toEqual([8192, 4096, 2048]);
    });
});

// ---------------------------------------------------------------------------
// ModelSpec type guards
// ---------------------------------------------------------------------------

describe('isReasoningModelSpec', () => {
    it('returns true for Claude reasoning models', () => {
        expect(isReasoningModelSpec(MODEL_SPECS['claude-sonnet-4-6'])).toBe(
            true
        );
        expect(isReasoningModelSpec(MODEL_SPECS['claude-opus-4-7'])).toBe(true);
    });

    it('returns true for ChatGPT reasoning models', () => {
        expect(isReasoningModelSpec(MODEL_SPECS['gpt-5-mini'])).toBe(true);
        expect(isReasoningModelSpec(MODEL_SPECS['gpt-5.4'])).toBe(true);
        expect(isReasoningModelSpec(MODEL_SPECS['gpt-5.5'])).toBe(true);
    });

    it('returns false for Claude sampling model', () => {
        expect(isReasoningModelSpec(MODEL_SPECS['claude-haiku-4-5'])).toBe(
            false
        );
    });

    it('returns false for Gemini models', () => {
        expect(isReasoningModelSpec(MODEL_SPECS['gemini-2.5-flash'])).toBe(
            false
        );
        expect(isReasoningModelSpec(MODEL_SPECS['gemini-2.5-pro'])).toBe(false);
    });

    it('narrows the type to ClaudeReasoningModelSpec | ChatGPTModelSpec and exposes effort as EffortLevel', () => {
        const spec: ModelSpec = MODEL_SPECS['claude-opus-4-7'];
        if (isReasoningModelSpec(spec)) {
            // After narrowing, spec is assignable to the reasoning union.
            const _narrowed: ClaudeReasoningModelSpec | ChatGPTModelSpec = spec;
            void _narrowed;
            // effort must be EffortLevel — not undefined
            expectTypeOf(spec.effort).toEqualTypeOf<
                'low' | 'medium' | 'high'
            >();
        }
    });
});

describe('isSamplingModelSpec', () => {
    it('returns true for Claude haiku (sampling)', () => {
        expect(isSamplingModelSpec(MODEL_SPECS['claude-haiku-4-5'])).toBe(true);
    });

    it('returns true for all Gemini models', () => {
        expect(isSamplingModelSpec(MODEL_SPECS['gemini-2.5-flash'])).toBe(true);
        expect(isSamplingModelSpec(MODEL_SPECS['gemini-2.5-flash-lite'])).toBe(
            true
        );
        expect(isSamplingModelSpec(MODEL_SPECS['gemini-2.5-pro'])).toBe(true);
    });

    it('returns false for Claude reasoning models', () => {
        expect(isSamplingModelSpec(MODEL_SPECS['claude-sonnet-4-6'])).toBe(
            false
        );
        expect(isSamplingModelSpec(MODEL_SPECS['claude-opus-4-7'])).toBe(false);
    });

    it('returns false for ChatGPT models', () => {
        expect(isSamplingModelSpec(MODEL_SPECS['gpt-5.5'])).toBe(false);
    });

    it('narrows the type to ClaudeSamplingModelSpec | GeminiModelSpec and exposes temperature as number', () => {
        const spec: ModelSpec = MODEL_SPECS['claude-haiku-4-5'];
        if (isSamplingModelSpec(spec)) {
            // After narrowing, spec is assignable to the sampling union.
            const _narrowed: ClaudeSamplingModelSpec | GeminiModelSpec = spec;
            void _narrowed;
            // temperature must be a number — not undefined
            expectTypeOf(spec.temperature).toEqualTypeOf<number>();
            // thinkingBudget is 0 (ClaudeSamplingModelSpec) | number (GeminiModelSpec)
            // — both extend number, neither is undefined.
            // Use assignability check rather than toEqualTypeOf because the
            // narrowed union resolves to `0 | number`, which is structurally
            // equivalent to `number` but not literally identical.
            const _budget: number = spec.thinkingBudget;
            void _budget;
        }
    });

    it('narrows Gemini spec correctly: thinkingBudget is number, temperature is number', () => {
        const spec: ModelSpec = MODEL_SPECS['gemini-2.5-flash'];
        if (isSamplingModelSpec(spec)) {
            expectTypeOf(spec.temperature).toEqualTypeOf<number>();
            const _budget: number = spec.thinkingBudget;
            void _budget;
        }
    });
});

describe('isClaudeReasoningModelSpec', () => {
    it('returns true only for Claude adaptive-thinking models', () => {
        expect(
            isClaudeReasoningModelSpec(MODEL_SPECS['claude-sonnet-4-6'])
        ).toBe(true);
        expect(isClaudeReasoningModelSpec(MODEL_SPECS['claude-opus-4-7'])).toBe(
            true
        );
    });

    it('returns false for Claude sampling model', () => {
        expect(
            isClaudeReasoningModelSpec(MODEL_SPECS['claude-haiku-4-5'])
        ).toBe(false);
    });

    it('returns false for ChatGPT models even though they have effort', () => {
        expect(isClaudeReasoningModelSpec(MODEL_SPECS['gpt-5.5'])).toBe(false);
    });

    it('returns false for Gemini models', () => {
        expect(isClaudeReasoningModelSpec(MODEL_SPECS['gemini-2.5-pro'])).toBe(
            false
        );
    });

    it('narrows the type to ClaudeReasoningModelSpec exactly', () => {
        const spec: ModelSpec = MODEL_SPECS['claude-opus-4-7'];
        if (isClaudeReasoningModelSpec(spec)) {
            const _narrowed: ClaudeReasoningModelSpec = spec;
            void _narrowed;
            expectTypeOf(spec.effort).toEqualTypeOf<
                'low' | 'medium' | 'high'
            >();
            expectTypeOf(spec.provider).toEqualTypeOf<'claude'>();
        }
    });
});

describe('isClaudeSamplingModelSpec', () => {
    it('returns true for claude-haiku-4-5', () => {
        expect(isClaudeSamplingModelSpec(MODEL_SPECS['claude-haiku-4-5'])).toBe(
            true
        );
    });

    it('returns false for Claude adaptive-thinking models', () => {
        expect(
            isClaudeSamplingModelSpec(MODEL_SPECS['claude-sonnet-4-6'])
        ).toBe(false);
        expect(isClaudeSamplingModelSpec(MODEL_SPECS['claude-opus-4-7'])).toBe(
            false
        );
    });

    it('returns false for Gemini models', () => {
        expect(isClaudeSamplingModelSpec(MODEL_SPECS['gemini-2.5-flash'])).toBe(
            false
        );
    });

    it('returns false for ChatGPT models', () => {
        expect(isClaudeSamplingModelSpec(MODEL_SPECS['gpt-5-mini'])).toBe(
            false
        );
    });

    it('narrows the type to ClaudeSamplingModelSpec exactly', () => {
        const spec: ModelSpec = MODEL_SPECS['claude-haiku-4-5'];
        if (isClaudeSamplingModelSpec(spec)) {
            const _narrowed: ClaudeSamplingModelSpec = spec;
            void _narrowed;
            expectTypeOf(spec.temperature).toEqualTypeOf<number>();
            expectTypeOf(spec.thinkingBudget).toEqualTypeOf<0>();
            expectTypeOf(spec.provider).toEqualTypeOf<'claude'>();
        }
    });
});
