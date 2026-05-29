import { describe, it, expect, vi } from 'vitest';
import {
    extractJsonWithRepair,
    snippetAroundPosition,
    parseSyntaxErrorPosition,
} from '@/infrastructure/ai/extractJsonWithRepair';

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

    it('position 정보가 없는 SyntaxError 는 near snippet 없이 payload length 만 포함한다', () => {
        // ':' 는 JSON-shaped 가 아니라 salvage 를 우회하고, JSON.parse 에러
        // 메시지에 position 토큰이 없어 snippet 이 생략된다. position 이 있어
        // near 가 포함되는 경로는 아래 '{a 1}' 케이스가 결정적으로 검증한다.
        let caught: SyntaxError | null = null;
        try {
            extractJsonWithRepair(':');
        } catch (e) {
            caught = e as SyntaxError;
        }
        expect(caught).toBeInstanceOf(SyntaxError);
        expect(caught?.message).toContain('payload length');
        expect(caught?.message).not.toContain('near:');
    });

    it('JSON-shape 이지만 jsonrepair 도 복구 실패하면 augmented SyntaxError + near snippet 을 throw', () => {
        // `{a 1}` looks JSON-shaped (passes the salvage gate) but jsonrepair
        // throws ("Colon expected"), exercising the inner catch + augmented
        // throw with a parsed position snippet.
        let caught: SyntaxError | null = null;
        try {
            extractJsonWithRepair('{a 1}');
        } catch (e) {
            caught = e as SyntaxError;
        }
        expect(caught).toBeInstanceOf(SyntaxError);
        const msg = caught?.message ?? '';
        expect(msg).toContain('payload length');
        // JSON.parse('{a 1}') reports a position, so the snippet must be present.
        expect(msg).toContain('near:');
    });

    it('initialError 가 Error 가 아니면 String() 으로 직렬화해 메시지에 담는다', () => {
        // JSON.parse never throws a non-Error in practice; force the defensive
        // String(initialError) branch by making it throw a raw string.
        const parseSpy = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
            throw 'raw-string-error';
        });
        let caught: SyntaxError | null = null;
        try {
            // 'xyz' is NOT JSON-shaped → salvage gate skipped → no second
            // JSON.parse call, so the single mockImplementationOnce suffices.
            extractJsonWithRepair('xyz');
        } catch (e) {
            caught = e as SyntaxError;
        }
        parseSpy.mockRestore();
        expect(caught).toBeInstanceOf(SyntaxError);
        expect(caught?.message).toContain('raw-string-error');
        expect(caught?.cause).toBe('raw-string-error');
    });
});

describe('snippetAroundPosition — boundary windows', () => {
    it('position 이 시작 부근이고 텍스트가 짧으면 양쪽 줄임표가 없다', () => {
        // start === 0 (no leading …) and end === text.length (no trailing …)
        expect(snippetAroundPosition('{a 1}', 1)).toBe('{a 1}');
    });

    it('position 양쪽으로 60자 넘게 남으면 앞뒤 줄임표(…)를 모두 붙인다', () => {
        const left = 'L'.repeat(100);
        const right = 'R'.repeat(100);
        const text = left + 'X' + right; // position 100 sits in the middle
        const snippet = snippetAroundPosition(text, 100);
        expect(snippet.startsWith('…')).toBe(true);
        expect(snippet.endsWith('…')).toBe(true);
        expect(snippet).toContain('X');
        // window is 60 chars either side of the position
        expect(snippet).toBe('…' + 'L'.repeat(60) + 'X' + 'R'.repeat(59) + '…');
    });
});

describe('parseSyntaxErrorPosition — message extraction', () => {
    it('position 토큰이 있으면 숫자를 반환한다', () => {
        expect(
            parseSyntaxErrorPosition('Unexpected token at position 42')
        ).toBe(42);
    });

    it('position 토큰이 없으면 null 을 반환한다', () => {
        expect(parseSyntaxErrorPosition('Unexpected end of JSON input')).toBe(
            null
        );
    });
});
