import { describe, expect, it } from 'vitest';
import { getProviderForModel } from '@/domain/llm/providers';
import type { ModelId } from '@/domain/types';

describe('getProviderForModel', () => {
    it('returns google for gemini-2.5-flash', () => {
        expect(getProviderForModel('gemini-2.5-flash')).toBe('google');
    });

    it('returns google for gemini-2.5-flash-lite', () => {
        expect(getProviderForModel('gemini-2.5-flash-lite')).toBe('google');
    });

    it('returns google for gemini-2.5-pro', () => {
        expect(getProviderForModel('gemini-2.5-pro')).toBe('google');
    });

    it('returns google for gemini-3-flash-preview', () => {
        expect(getProviderForModel('gemini-3-flash-preview')).toBe('google');
    });

    it('returns google for gemini-3.1-pro-preview', () => {
        expect(getProviderForModel('gemini-3.1-pro-preview')).toBe('google');
    });

    it('returns anthropic for claude-haiku-3-5', () => {
        expect(getProviderForModel('claude-haiku-3-5')).toBe('anthropic');
    });

    it('returns anthropic for claude-sonnet-4-6', () => {
        expect(getProviderForModel('claude-sonnet-4-6')).toBe('anthropic');
    });

    it('returns anthropic for claude-opus-4-7', () => {
        expect(getProviderForModel('claude-opus-4-7')).toBe('anthropic');
    });

    it('returns openai for gpt-5-mini', () => {
        expect(getProviderForModel('gpt-5-mini')).toBe('openai');
    });

    it('returns openai for gpt-5.4', () => {
        expect(getProviderForModel('gpt-5.4')).toBe('openai');
    });

    it('returns openai for gpt-5.5', () => {
        expect(getProviderForModel('gpt-5.5')).toBe('openai');
    });

    it('returns anthropic for deprecated claude-sonnet-4 via prefix fallback', () => {
        expect(getProviderForModel('claude-sonnet-4' as ModelId)).toBe(
            'anthropic'
        );
    });

    it('returns anthropic for deprecated claude-opus-4 via prefix fallback', () => {
        expect(getProviderForModel('claude-opus-4' as ModelId)).toBe(
            'anthropic'
        );
    });

    it('returns openai for unknown gpt-prefixed model via prefix fallback', () => {
        expect(getProviderForModel('gpt-4-turbo' as ModelId)).toBe('openai');
    });
});
