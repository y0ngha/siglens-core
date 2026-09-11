import { describe, it, expect } from 'vitest';
import { normalizeJsonResponse } from '@/infrastructure/ai/normalizeJsonResponse';

describe('normalizeJsonResponse', () => {
    it('removes json code fence only when both start and end markers are present', () => {
        const result = normalizeJsonResponse('```json\n{ "ok": true }\n```');

        expect(result).toBe('{"ok":true}');
    });

    it('normalizes text extracted from Claude debug JSON with escaped quotes', () => {
        const claudeDebugJson =
            '{"type":"text","text":"```json\\n{\\n  \\"summary\\": \\"analysis\\",\\n  \\"trend\\": \\"bearish\\"\\n}\\n```"}';
        const textBlock = JSON.parse(claudeDebugJson) as { text: string };

        const result = normalizeJsonResponse(textBlock.text);

        expect(result).toBe('{"summary":"analysis","trend":"bearish"}');
    });

    it('normalizes plain JSON without code fence', () => {
        const result = normalizeJsonResponse('\n{ "ok": true }\n');

        expect(result).toBe('{"ok":true}');
    });

    it('salvages JSON with a trailing comma', () => {
        const result = normalizeJsonResponse('{ "summary": "analysis", }');

        expect(result).toBe('{"summary":"analysis"}');
    });

    it('salvages JSON with an unquoted key', () => {
        const result = normalizeJsonResponse('{ trend: "bearish" }');

        expect(result).toBe('{"trend":"bearish"}');
    });

    it('salvages a partial starting json fence', () => {
        const result = normalizeJsonResponse('```json\n{ "ok": true }');

        expect(result).toBe('{"ok":true}');
    });

    it('salvages a partial ending fence', () => {
        const result = normalizeJsonResponse('{ "ok": true }\n```');

        expect(result).toBe('{"ok":true}');
    });

    it('throws on truly unrecoverable input', () => {
        expect(() => normalizeJsonResponse('')).toThrow(SyntaxError);
    });
});

describe('normalizeJsonResponse — complete object followed by extra content', () => {
    it('keeps the first object when the provider streams the JSON twice', () => {
        // DeepSeek Responses API: 41 prewarm units failed with
        // "Unexpected non-whitespace character after JSON" the night it shipped.
        const raw =
            '{"summary":"a","trend":"bullish"}\n{"summary":"a","trend":"bullish"}';
        expect(normalizeJsonResponse(raw)).toBe(
            '{"summary":"a","trend":"bullish"}'
        );
    });

    it('does not turn concatenated objects into an array', () => {
        const raw = '{"a":1}{"b":2}';
        const parsed: unknown = JSON.parse(normalizeJsonResponse(raw));
        expect(Array.isArray(parsed)).toBe(false);
        expect(parsed).toEqual({ a: 1 });
    });

    it('ignores trailing prose that itself contains braces', () => {
        expect(normalizeJsonResponse('{"ok":true} note: {not json}')).toBe(
            '{"ok":true}'
        );
    });

    it('does not count braces inside string values', () => {
        const raw = '{"text":"a } tricky { \\" brace"}\n{"text":"second"}';
        expect(JSON.parse(normalizeJsonResponse(raw))).toEqual({
            text: 'a } tricky { " brace',
        });
    });

    it('still repairs a truncated object instead of returning a nested fragment', () => {
        // A truncated object never closes at depth 0, so the salvage step must not
        // pick an inner complete object; jsonrepair handles it as before.
        const raw =
            '{"summary":"x","keyLevels":{"support":[1,2]},"trend":"bull';
        expect(JSON.parse(normalizeJsonResponse(raw))).toEqual({
            summary: 'x',
            keyLevels: { support: [1, 2] },
            trend: 'bull',
        });
    });
});
