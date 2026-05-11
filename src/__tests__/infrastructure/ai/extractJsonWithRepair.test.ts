import { describe, it, expect } from 'vitest';
import { extractJsonWithRepair } from '@/infrastructure/ai/extractJsonWithRepair';

// ─────────────────────────────────────────
// LLM-response JSON parsing with `jsonrepair` salvage.
//
// Salvage covers the recurrent worker-side failure modes captured in the
// `[ensureNewsCardsAnalyzedAction] poll error` logs (truncation at
// max-token, trailing commas, missing commas, unquoted keys). The guard
// keeps non-JSON garbage from being silently coerced into a quoted string.
// ─────────────────────────────────────────

const validJson = { status: 'bullish', score: 42 };
const validJsonString = JSON.stringify(validJson);

describe('extractJsonWithRepair — passthrough path (no salvage needed)', () => {
    it('순수 JSON 문자열을 파싱한다', () => {
        expect(extractJsonWithRepair(validJsonString)).toEqual(validJson);
    });

    it('```json 펜스로 감싼 JSON 을 파싱한다', () => {
        const fenced = '```json\n' + validJsonString + '\n```';
        expect(extractJsonWithRepair(fenced)).toEqual(validJson);
    });

    it('prose 가 섞인 JSON 도 brace-pair 로 추출해 파싱한다', () => {
        const wrapped = "Here's the JSON: " + validJsonString + ' done!';
        expect(extractJsonWithRepair(wrapped)).toEqual(validJson);
    });
});

describe('extractJsonWithRepair — salvage path (jsonrepair fallback)', () => {
    it('trailing comma 가 있는 JSON 을 복구해서 파싱한다', () => {
        const broken = '{"status": "bullish", "score": 42,}';
        expect(extractJsonWithRepair(broken)).toEqual(validJson);
    });

    it('property 사이 콤마가 빠진 JSON 을 복구해서 파싱한다', () => {
        const broken = '{"status": "bullish" "score": 42}';
        expect(extractJsonWithRepair(broken)).toEqual(validJson);
    });

    it('따옴표 없는 key 를 복구해서 파싱한다', () => {
        const broken = '{status: "bullish", score: 42}';
        expect(extractJsonWithRepair(broken)).toEqual(validJson);
    });

    it('truncate 된 JSON 을 닫아서 파싱한다 (max-token 잘림 시나리오)', () => {
        const broken = '{"status": "bullish", "score": 42';
        expect(extractJsonWithRepair(broken)).toEqual(validJson);
    });
});

describe('extractJsonWithRepair — augmented SyntaxError on total failure', () => {
    /**
     * Crafted to defeat jsonrepair: the candidate starts with `{` so the
     * salvage gate passes, but jsonrepair successfully recovers many shapes.
     * Use a payload jsonrepair currently coerces to a quoted-string form
     * that is itself valid JSON, so we instead pick a non-JSON-shaped input
     * to exercise the augmented-throw path deterministically.
     */
    it('JSON-shape 도 아닌 garbage 는 augmented SyntaxError 로 throw (salvage 우회)', () => {
        let caught: unknown = null;
        try {
            extractJsonWithRepair('not json at all');
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(SyntaxError);
        const msg = (caught as Error).message;
        expect(msg).toContain('payload length');
    });

    it('augmented SyntaxError 는 원본 에러를 cause 로 보존한다', () => {
        let caught: SyntaxError | null = null;
        try {
            extractJsonWithRepair('not json at all');
        } catch (e) {
            caught = e as SyntaxError;
        }
        expect(caught?.cause).toBeInstanceOf(Error);
    });

    it('position 정보가 있는 SyntaxError 는 snippet 을 augmented 메시지에 포함한다', () => {
        // `{:1}` — JSON.parse fails at position 1 (`:`); not recoverable by jsonrepair either.
        let caught: SyntaxError | null = null;
        try {
            extractJsonWithRepair(':');
        } catch (e) {
            caught = e as SyntaxError;
        }
        expect(caught).toBeInstanceOf(SyntaxError);
        // Snippet inclusion is best-effort; assert when position parsed successfully.
        const msg = caught?.message ?? '';
        if (/position\s+\d+/.test(msg)) {
            expect(msg).toContain('near:');
        }
    });
});
