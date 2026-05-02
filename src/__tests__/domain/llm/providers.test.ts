import { describe, expect, it } from 'vitest';
import { getProviderForModel } from '@/domain/llm/providers';
import type { ModelId } from '@/domain/types';

describe('getProviderForModel', () => {
    describe('active models resolved via MODEL_SPECS', () => {
        it('returns google for gemini-2.5-flash', () => {
            expect(getProviderForModel('gemini-2.5-flash')).toBe('google');
        });

        it('returns anthropic for claude-haiku-3-5', () => {
            expect(getProviderForModel('claude-haiku-3-5')).toBe('anthropic');
        });

        it('returns openai for gpt-5-mini', () => {
            expect(getProviderForModel('gpt-5-mini')).toBe('openai');
        });
    });

    describe('deprecated models resolved via prefix fallback', () => {
        it('returns anthropic for deprecated claude-sonnet-4', () => {
            expect(getProviderForModel('claude-sonnet-4' as ModelId)).toBe(
                'anthropic'
            );
        });

        it('returns google for deprecated gemini-1.0-pro', () => {
            expect(getProviderForModel('gemini-1.0-pro' as ModelId)).toBe(
                'google'
            );
        });

        it('returns openai for unknown gpt-prefixed model', () => {
            expect(getProviderForModel('gpt-4-turbo' as ModelId)).toBe('openai');
        });
    });
});
