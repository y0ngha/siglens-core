import { describe, it, expect, vi } from 'vitest';
import {
    AI_SYSTEM_PROMPT,
    parseJsonResponse,
    parseNumberEnv,
    stripMarkdownCodeBlock,
} from '@/infrastructure/ai/utils';

describe('AI_SYSTEM_PROMPT', () => {
    it('is a non-empty string', () => {
        expect(typeof AI_SYSTEM_PROMPT).toBe('string');
        expect(AI_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    });
});

describe('re-exports from domain/utils', () => {
    it('parseNumberEnv is re-exported', () => {
        expect(parseNumberEnv('42', 0)).toBe(42);
    });

    it('stripMarkdownCodeBlock is re-exported', () => {
        expect(stripMarkdownCodeBlock('```json\n{}\n```')).toBe('{}');
    });
});

describe('parseJsonResponse', () => {
    it('parses plain JSON string', () => {
        const result = parseJsonResponse<{ n: number }>('{"n":1}', 'test');
        expect(result).toEqual({ n: 1 });
    });

    it('parses JSON inside markdown code block', () => {
        const result = parseJsonResponse<{ n: number }>(
            '```json\n{"n":1}\n```',
            'test'
        );
        expect(result).toEqual({ n: 1 });
    });

    it('throws and logs error on invalid JSON', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => parseJsonResponse('not valid json', 'gemini')).toThrowError(
            'Failed to parse gemini response as JSON'
        );
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('thrown error has cause', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            parseJsonResponse('bad json', 'gemini');
        } catch (err) {
            expect((err as { cause: unknown }).cause).toBeInstanceOf(SyntaxError);
        }
    });
});
