import { describe, it, expect } from 'vitest';
import {
    DISABLED_THINKING_BUDGET,
    MODEL_SPECS,
    THINKING_BUDGET_FALLBACK_STEPS,
    getProvider,
    getThinkingBudgetSequence,
    isChatGPTModel,
    isClaudeModel,
    isGeminiModel,
} from '@/domain/analysis/modelSpecs';
import type { ActiveModelId } from '@/domain/analysis/modelSpecs';

describe('MODEL_SPECS', () => {
    it('covers every active model identifier exactly once', () => {
        const expected: readonly ActiveModelId[] = [
            'claude-haiku-3-5',
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

    it('uses temperature 0 and top-p 0.95 for every model', () => {
        for (const spec of Object.values(MODEL_SPECS)) {
            expect(spec.temperature).toBe(0);
            expect(spec.topP).toBe(0.95);
        }
    });

    it('keeps Claude max output tokens aligned with the SDK 0.92 caps', () => {
        expect(MODEL_SPECS['claude-haiku-3-5'].maxOutputTokens).toBe(8_192);
        expect(MODEL_SPECS['claude-sonnet-4-6'].maxOutputTokens).toBe(128_000);
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

    it('disables thinking budget for haiku and the GPT-5 series', () => {
        expect(MODEL_SPECS['claude-haiku-3-5'].thinkingBudget).toBe(0);
        expect(MODEL_SPECS['gpt-5-mini'].thinkingBudget).toBe(0);
        expect(MODEL_SPECS['gpt-5.4'].thinkingBudget).toBe(0);
        expect(MODEL_SPECS['gpt-5.5'].thinkingBudget).toBe(0);
    });

    it('keeps gemini-2.5-flash-lite at the documented 24_576 thinking budget', () => {
        expect(MODEL_SPECS['gemini-2.5-flash-lite'].thinkingBudget).toBe(
            24_576
        );
    });

    it('uses 32_768 thinking budget for the remaining Gemini models', () => {
        const otherGemini: readonly ActiveModelId[] = [
            'gemini-2.5-flash',
            'gemini-2.5-pro',
            'gemini-3-flash-preview',
            'gemini-3.1-pro-preview',
        ];
        for (const model of otherGemini) {
            expect(MODEL_SPECS[model].thinkingBudget, model).toBe(32_768);
        }
    });
});

describe('getProvider', () => {
    it('routes Claude models to the claude provider', () => {
        expect(getProvider('claude-haiku-3-5')).toBe('claude');
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
        expect(isGeminiModel('claude-haiku-3-5')).toBe(false);
        expect(isGeminiModel('gpt-5.4')).toBe(false);
    });

    it('isChatGPTModel matches only GPT entries', () => {
        expect(isChatGPTModel('gpt-5.5')).toBe(true);
        expect(isChatGPTModel('claude-sonnet-4-6')).toBe(false);
        expect(isChatGPTModel('gemini-3-flash-preview')).toBe(false);
    });
});

describe('getThinkingBudgetSequence', () => {
    it('returns full descending sequence with two halving steps for high initial value', () => {
        // 32000 → 16000 → 8000 → fallback steps (8192 deduped) → 4096 → 2048 → 0
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
