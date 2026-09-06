import { describe, it, expect } from 'vitest';
import {
    extractJsonFromLlmResponse,
    formatBarDateTime,
    parseLlmPayload,
    stripLlmJsonFence,
} from '@/domain/analysis/promptFormat';

// ─────────────────────────────────────────
// IC-5: extractJsonFromLlmResponse — flexible fence stripping
// ─────────────────────────────────────────

const validJson = { status: 'bullish', score: 42 };
const validJsonString = JSON.stringify(validJson);

describe('extractJsonFromLlmResponse', () => {
    it('순수 JSON 문자열을 파싱한다', () => {
        const result = extractJsonFromLlmResponse(validJsonString);
        expect(result).toEqual(validJson);
    });

    it('```json 펜스로 감싼 JSON 을 파싱한다', () => {
        const fenced = '```json\n' + validJsonString + '\n```';
        expect(extractJsonFromLlmResponse(fenced)).toEqual(validJson);
    });

    it('``` 펜스(언어 없음)로 감싼 JSON 을 파싱한다', () => {
        const fenced = '```\n' + validJsonString + '\n```';
        expect(extractJsonFromLlmResponse(fenced)).toEqual(validJson);
    });

    it('앞에 prose 가 붙은 경우 JSON 블록을 추출한다', () => {
        const withPrefix =
            "Here's the JSON:\n```json\n" + validJsonString + '\n```';
        expect(extractJsonFromLlmResponse(withPrefix)).toEqual(validJson);
    });

    it('뒤에 prose 가 붙은 경우 JSON 블록을 추출한다', () => {
        const withSuffix =
            '```json\n' + validJsonString + '\n```\nHope this helps!';
        expect(extractJsonFromLlmResponse(withSuffix)).toEqual(validJson);
    });

    it('앞뒤에 prose 가 모두 붙은 경우 JSON 블록을 추출한다', () => {
        const withBoth =
            "Here's the JSON:\n```json\n" +
            validJsonString +
            '\n```\nHope this helps!';
        expect(extractJsonFromLlmResponse(withBoth)).toEqual(validJson);
    });

    it('펜스 없이 중간에 JSON 이 있으면 첫 { … 마지막 } 를 추출한다', () => {
        const withBraces = 'Some text ' + validJsonString + ' more text';
        expect(extractJsonFromLlmResponse(withBraces)).toEqual(validJson);
    });

    it('앞뒤 공백을 무시한다', () => {
        const padded = '  \n  ' + validJsonString + '  \n  ';
        expect(extractJsonFromLlmResponse(padded)).toEqual(validJson);
    });

    it('유효하지 않은 JSON 이면 SyntaxError 를 던진다', () => {
        expect(() => extractJsonFromLlmResponse('not json at all')).toThrow(
            SyntaxError
        );
    });

    it('펜스 안에 유효하지 않은 JSON 이면 SyntaxError 를 던진다', () => {
        expect(() =>
            extractJsonFromLlmResponse('```json\n{invalid}\n```')
        ).toThrow(SyntaxError);
    });
});

// stripLlmJsonFence is exported so infrastructure-layer salvage wrappers can
// reuse the exact stripping behaviour — assert the contract directly.
describe('stripLlmJsonFence', () => {
    it('```json 펜스 안 내용을 trim 해서 반환한다', () => {
        expect(stripLlmJsonFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    });

    it('펜스 없이 brace 가 있으면 첫 { … 마지막 } 슬라이스를 반환한다', () => {
        expect(stripLlmJsonFence('prefix {"a":1} suffix')).toBe('{"a":1}');
    });

    it('펜스도 brace 도 없으면 trim 한 raw 문자열을 반환한다', () => {
        expect(stripLlmJsonFence('  not json at all  ')).toBe(
            'not json at all'
        );
    });
});

// ─────────────────────────────────────────
// parseLlmPayload — string vs non-string coercion
// ─────────────────────────────────────────

describe('parseLlmPayload', () => {
    it('JSON 문자열이면 extractJsonFromLlmResponse 결과를 반환한다', () => {
        const raw = '{"a":1}';
        expect(parseLlmPayload(raw)).toEqual(extractJsonFromLlmResponse(raw));
    });

    it('JSON 문자열이면 파싱된 객체를 반환한다', () => {
        expect(parseLlmPayload('{"a":1}')).toEqual({ a: 1 });
    });

    it('마크다운 펜스로 감싼 JSON 문자열이면 파싱된 객체를 반환한다', () => {
        const fenced = '```json\n{"b":2}\n```';
        expect(parseLlmPayload(fenced)).toEqual({ b: 2 });
    });

    it('이미 파싱된 객체(non-string)이면 동일 참조를 그대로 반환한다', () => {
        const obj = { a: 1 };
        expect(parseLlmPayload(obj)).toBe(obj);
    });

    it('null 이면 그대로 반환한다', () => {
        expect(parseLlmPayload(null)).toBeNull();
    });

    it('숫자이면 그대로 반환한다', () => {
        expect(parseLlmPayload(42)).toBe(42);
    });
});

describe('formatBarDateTime', () => {
    it('renders `YYYY-MM-DD HH:mm` in UTC, dropping seconds', () => {
        // 초·밀리초가 있어도 분에서 잘린다 — 프롬프트의 봉 행과 같은 폭.
        const ms = Date.parse('2026-09-04T14:30:45.678Z');
        expect(formatBarDateTime(ms)).toBe('2026-09-04 14:30');
    });

    it('separates date and time with a space, not `T`', () => {
        const out = formatBarDateTime(Date.parse('2026-09-04T09:05:00Z'));
        expect(out).not.toContain('T');
        expect(out).toBe('2026-09-04 09:05');
    });

    it('stays in UTC regardless of the host timezone', () => {
        // 로컬 타임존으로 변환하면 봉 행과 문자열이 어긋나 매칭이 깨진다.
        const ms = Date.parse('2026-01-01T00:00:00Z');
        expect(formatBarDateTime(ms)).toBe('2026-01-01 00:00');
    });
});
