import { describe, it, expect } from 'vitest';
import { AI_SYSTEM_PROMPT, parseJsonResponse } from '@/infrastructure/ai/utils';

describe('AI_SYSTEM_PROMPT', () => {
    it('is a non-empty string', () => {
        expect(typeof AI_SYSTEM_PROMPT).toBe('string');
        expect(AI_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    });

    it('instructs Korean output', () => {
        expect(AI_SYSTEM_PROMPT).toContain('Korean');
    });

    it('instructs JSON-only output', () => {
        expect(AI_SYSTEM_PROMPT).toContain('SINGLE valid JSON object');
    });

    it('contains Deterministic principle', () => {
        expect(AI_SYSTEM_PROMPT).toContain('Deterministic');
    });
});

describe('parseJsonResponse', () => {
    it('parses plain JSON string', () => {
        const result = parseJsonResponse('{"n":1}', 'test');
        expect(result).toEqual({ n: 1 });
    });

    it('parses JSON inside markdown code block', () => {
        const result = parseJsonResponse('```json\n{"n":1}\n```', 'test');
        expect(result).toEqual({ n: 1 });
    });

    it('throws on invalid JSON', () => {
        expect(() =>
            parseJsonResponse('not valid json', 'gemini')
        ).toThrowError('Failed to parse gemini response as JSON');
    });

    it('thrown error has cause', () => {
        expect.assertions(1);
        try {
            parseJsonResponse('bad json', 'gemini');
        } catch (err) {
            expect((err as { cause: unknown }).cause).toBeInstanceOf(
                SyntaxError
            );
        }
    });
});
