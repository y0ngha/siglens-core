import { describe, it, expect } from 'vitest';
import {
    IncompleteJsonResponseError,
    normalizeJsonResponse,
    responseSchemaKeys,
} from '@/infrastructure/ai/normalizeJsonResponse';

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

describe('normalizeJsonResponse — prose before the object', () => {
    it('does not take a stray brace pair in leading prose as the answer', () => {
        // First-object salvage applies only to text that starts with `{`; otherwise
        // the `{}` in the note would win and the real answer would be dropped.
        const raw = 'Note: {} is empty. {"trend":"bullish"} trailing';
        // Prose-led text keeps the pre-existing path, which may throw; what it must never
        // do is return the stray `{}`.
        let out: string | null = null;
        try {
            out = normalizeJsonResponse(raw);
        } catch {
            out = null;
        }
        expect(out).not.toBe('{}');
    });
});

describe('normalizeJsonResponse — response schema completeness', () => {
    const schema = {
        type: 'object',
        properties: {
            summary: { type: 'string' },
            actionRecommendation: { type: 'object' },
            note: { type: 'string' },
        },
        required: ['summary', 'actionRecommendation'],
    };

    it('returns a reply that carries every required key', () => {
        const raw = '{"summary":"s","actionRecommendation":{"a":1}}';

        expect(normalizeJsonResponse(raw, schema)).toBe(raw);
    });

    it('throws a SyntaxError subclass when a required key is missing', () => {
        const raw = '{"summary":"s"}';

        expect(() => normalizeJsonResponse(raw, schema)).toThrow(
            IncompleteJsonResponseError
        );
        expect(() => normalizeJsonResponse(raw, schema)).toThrow(SyntaxError);
        expect(() => normalizeJsonResponse(raw, schema)).toThrow(
            /actionRecommendation/
        );
    });

    it('rejects a jsonrepair-salvaged truncation that lost a required key', () => {
        // Cut mid-stream: jsonrepair closes the object and the later keys are gone.
        const raw = '{"summary":"s","note":"n"';

        expect(() => normalizeJsonResponse(raw, schema)).toThrow(
            IncompleteJsonResponseError
        );
    });

    it('rejects a stray closing brace that dropped a trailing required key', () => {
        const raw = '{"summary":"s"}, "actionRecommendation":{"a":1}}';

        expect(() => normalizeJsonResponse(raw, schema)).toThrow(SyntaxError);
    });

    it('rejects a kept head whose discarded tail holds an optional schema key', () => {
        const raw =
            '{"summary":"s","actionRecommendation":{"a":1}}\n"note":"n"}';

        expect(() => normalizeJsonResponse(raw, schema)).toThrow(
            /lost keys after a stray closing brace: note/
        );
    });

    it('does not mistake a schema key name inside a string value of the tail for a lost key', () => {
        const raw =
            '{"summary":"s","actionRecommendation":{"a":1}}\n{"other":"note","list":["note"]}';

        expect(normalizeJsonResponse(raw, schema)).toBe(
            '{"summary":"s","actionRecommendation":{"a":1}}'
        );
        const asValue =
            '{"summary":"s","actionRecommendation":{"a":1}}\n{"x":"\\"note\\": 1","y":"note"}';
        expect(normalizeJsonResponse(asValue, schema)).toBe(
            '{"summary":"s","actionRecommendation":{"a":1}}'
        );
    });

    it('matches a lost key with whitespace before the colon', () => {
        const raw =
            '{"summary":"s","actionRecommendation":{"a":1}}\n"note"  : "n"}';

        expect(() => normalizeJsonResponse(raw, schema)).toThrow(
            /lost keys after a stray closing brace: note/
        );
    });

    it('keeps a complete first object followed by a plain second copy', () => {
        const first = '{"summary":"s","actionRecommendation":{"a":1}}';

        expect(normalizeJsonResponse(`${first}\n${first}`, schema)).toBe(first);
    });

    it('does not check keys without a schema, or for a schema with no required list', () => {
        expect(normalizeJsonResponse('{"a":1}')).toBe('{"a":1}');
        expect(normalizeJsonResponse('{"a":1}', { type: 'object' })).toBe(
            '{"a":1}'
        );
        expect(normalizeJsonResponse('{"a":1}', 'not a schema')).toBe(
            '{"a":1}'
        );
    });

    it('skips the check for a non-object root', () => {
        expect(normalizeJsonResponse('[1,2]', schema)).toBe('[1,2]');
    });
});

describe('responseSchemaKeys', () => {
    it('reads the top-level required and property names', () => {
        expect(
            responseSchemaKeys({
                properties: { a: {}, b: {} },
                required: ['a', 7],
            })
        ).toEqual({ required: ['a'], properties: ['a', 'b'] });
    });

    it('returns empty lists for anything that is not a schema object', () => {
        expect(responseSchemaKeys(undefined)).toEqual({
            required: [],
            properties: [],
        });
    });
});
