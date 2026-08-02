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
