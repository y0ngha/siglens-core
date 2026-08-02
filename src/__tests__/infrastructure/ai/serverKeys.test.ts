import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveServerApiKey } from '@/infrastructure/ai/serverKeys';

describe('resolveServerApiKey', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('provider별 env를 읽는다', () => {
        vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant');
        expect(resolveServerApiKey('anthropic')).toBe('sk-ant');
    });

    it('키가 없으면 호출 시점에 env 이름을 담아 던진다', () => {
        vi.stubEnv('GEMINI_API_KEY', '');
        expect(() => resolveServerApiKey('google')).toThrowError(
            /GEMINI_API_KEY/
        );
    });

    it('reads GEMINI_API_KEY for google provider', () => {
        vi.stubEnv('GEMINI_API_KEY', 'ai-gemini-test');
        expect(resolveServerApiKey('google')).toBe('ai-gemini-test');
    });

    it('reads OPENAI_API_KEY for openai provider', () => {
        vi.stubEnv('OPENAI_API_KEY', 'sk-openai-test');
        expect(resolveServerApiKey('openai')).toBe('sk-openai-test');
    });

    it('throws with OPENAI_API_KEY in message when openai key is missing', () => {
        vi.stubEnv('OPENAI_API_KEY', '');
        expect(() => resolveServerApiKey('openai')).toThrowError(
            /OPENAI_API_KEY/
        );
    });

    it('reads DEEPSEEK_API_KEY for deepseek provider', () => {
        vi.stubEnv('DEEPSEEK_API_KEY', 'sk-deepseek-test');
        expect(resolveServerApiKey('deepseek')).toBe('sk-deepseek-test');
    });

    it('throws with DEEPSEEK_API_KEY in message when deepseek key is missing', () => {
        vi.stubEnv('DEEPSEEK_API_KEY', '');
        expect(() => resolveServerApiKey('deepseek')).toThrowError(
            /DEEPSEEK_API_KEY/
        );
    });

    it('throws with ANTHROPIC_API_KEY in message when anthropic key is missing', () => {
        vi.stubEnv('ANTHROPIC_API_KEY', '');
        expect(() => resolveServerApiKey('anthropic')).toThrowError(
            /ANTHROPIC_API_KEY/
        );
    });
});
