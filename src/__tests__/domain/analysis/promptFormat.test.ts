import { describe, it, expect } from 'vitest';
import {
    differenceDecimalPlaces,
    equityListingContext,
    extractJsonFromLlmResponse,
    formatBarDateTime,
    formatLargeAmount,
    formatNullableNumber,
    formatPlainNumber,
    formatPrice,
    formatSignedPercent,
    parseLlmPayload,
    priceDecimalPlaces,
    sharedPriceDecimalPlaces,
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

describe('formatNullableNumber', () => {
    it('renders null, undefined, NaN and ±Infinity as N/A', () => {
        for (const v of [null, undefined, Number.NaN, Infinity, -Infinity]) {
            expect(formatNullableNumber(v)).toBe('N/A');
        }
    });

    it('drops the sign from a value that rounds to zero', () => {
        // `(-0.001).toFixed(2)` is "-0.00" — a direction the number does not carry.
        expect(formatNullableNumber(-0.001)).toBe('0.00');
        expect(formatNullableNumber(-0.0001, 3)).toBe('0.000');
    });

    it('keeps the sign and rounding of a non-zero value', () => {
        expect(formatNullableNumber(-1.234)).toBe('-1.23');
        expect(formatNullableNumber(3.14159, 3)).toBe('3.142');
    });
});

describe('equityListingContext', () => {
    it('keeps the U.S. framing byte-identical for USD and by default', () => {
        const us = 'This is a publicly traded U.S. equity.';
        expect(equityListingContext()).toBe(us);
        expect(equityListingContext('USD')).toBe(us);
    });

    it('frames a KRW quote as a won-quoted Korean listing', () => {
        const context = equityListingContext('KRW');
        expect(context).toContain('KRX');
        expect(context).toContain('KRW');
        expect(context).not.toContain('publicly traded U.S. equity');
    });
});

describe('priceDecimalPlaces', () => {
    it('uses cent precision at or above one unit', () => {
        expect(priceDecimalPlaces(320)).toBe(2);
        expect(priceDecimalPlaces(1)).toBe(2);
        expect(priceDecimalPlaces(77107)).toBe(2);
    });

    it('keeps four significant digits below one unit', () => {
        expect(priceDecimalPlaces(0.5)).toBe(4);
        expect(priceDecimalPlaces(0.08359)).toBe(5);
        expect(priceDecimalPlaces(0.00000507)).toBe(9);
    });

    it('caps the decimals for a near-zero price', () => {
        expect(priceDecimalPlaces(1e-20)).toBe(15);
        // A meme-coin quote the old ceiling of 10 truncated to two significant digits.
        expect(priceDecimalPlaces(0.00000001234)).toBe(11);
    });

    it('keeps five significant digits for crypto, never below cent precision', () => {
        // 5-minute XRP bars near 2.50 move in the third decimal.
        expect(priceDecimalPlaces(2.5012, 'USD', 'crypto')).toBe(4);
        expect(priceDecimalPlaces(15.2, 'USD', 'crypto')).toBe(3);
        expect(priceDecimalPlaces(0.08359, 'USD', 'crypto')).toBe(6);
        expect(priceDecimalPlaces(3000, 'USD', 'crypto')).toBe(2);
        expect(priceDecimalPlaces(77107, 'USD', 'crypto')).toBe(2);
    });

    it('renders KRW in whole won regardless of magnitude', () => {
        expect(priceDecimalPlaces(269500, 'KRW')).toBe(0);
        expect(priceDecimalPlaces(0.5, 'KRW')).toBe(0);
    });

    it('falls back to cent precision for an unusable reference', () => {
        for (const v of [null, undefined, Number.NaN, 0, -3]) {
            expect(priceDecimalPlaces(v)).toBe(2);
        }
    });
});

describe('differenceDecimalPlaces', () => {
    it('keeps three significant digits of the difference scale', () => {
        // A 1,000-won KRX stock with ATR 30: whole won would print a -0.4 histogram as 0.
        expect(differenceDecimalPlaces(30, 0)).toBe(1);
        expect(differenceDecimalPlaces(0.05, 2)).toBe(4);
    });

    it('never uses fewer decimals than the prices', () => {
        expect(differenceDecimalPlaces(5000, 0)).toBe(0);
        expect(differenceDecimalPlaces(500, 2)).toBe(2);
    });

    it('falls back to the price precision for an unusable scale', () => {
        for (const v of [null, undefined, Number.NaN, 0, -1]) {
            expect(differenceDecimalPlaces(v, 3)).toBe(3);
        }
    });
});

describe('sharedPriceDecimalPlaces', () => {
    it('takes the precision the smallest usable price needs', () => {
        // Per-level precision printed `0.9950` beside `1.01` in one list.
        expect(sharedPriceDecimalPlaces([1.01, 0.995, 1.2])).toBe(4);
        expect(sharedPriceDecimalPlaces([320, 310.5])).toBe(2);
    });

    it('ignores unusable prices and falls back to cent precision when none remain', () => {
        expect(sharedPriceDecimalPlaces([0, Number.NaN, 250])).toBe(2);
        expect(sharedPriceDecimalPlaces([])).toBe(2);
    });

    it('honours the currency and asset class', () => {
        expect(sharedPriceDecimalPlaces([269500, 0.5], 'KRW')).toBe(0);
        expect(sharedPriceDecimalPlaces([2.5, 2.6], 'USD', 'crypto')).toBe(4);
    });
});

describe('formatPrice', () => {
    it('renders each price at the precision its own magnitude calls for', () => {
        expect(formatPrice(322.084)).toBe('322.08');
        expect(formatPrice(0.08359)).toBe('0.08359');
        expect(formatPrice(269500, 'KRW')).toBe('269500');
        expect(formatPrice(null)).toBe('N/A');
    });
});

describe('formatLargeAmount', () => {
    it('scales to T / B / M with the currency', () => {
        expect(formatLargeAmount(3_000_000_000_000, 'USD')).toBe('3.0T USD');
        expect(formatLargeAmount(280_000_000_000, 'USD')).toBe('280.0B USD');
        expect(formatLargeAmount(450_000_000, 'USD')).toBe('450.0M USD');
        expect(formatLargeAmount(1_600_000_000_000_000, 'KRW')).toBe(
            '1600.0T KRW'
        );
    });

    it('keeps the sign of a negative amount', () => {
        expect(formatLargeAmount(-2_500_000_000, 'USD')).toBe('-2.5B USD');
    });

    it('renders a small amount unscaled', () => {
        expect(formatLargeAmount(12_345, 'USD')).toBe('12345 USD');
    });

    it('picks the scale after rounding', () => {
        expect(formatLargeAmount(999_950_000, 'USD')).toBe('1.0B USD');
        expect(formatLargeAmount(-999_999_700, 'USD')).toBe('-1.0B USD');
        expect(formatLargeAmount(999_949_999, 'USD')).toBe('999.9M USD');
        // Rounding at the larger scale must not swallow real precision.
        expect(formatLargeAmount(960_000_000, 'USD')).toBe('960.0M USD');
        expect(formatLargeAmount(999_999.6, 'USD')).toBe('1.0M USD');
        expect(formatLargeAmount(0, 'USD')).toBe('0 USD');
    });

    it('accepts any reporting currency and omits the label when unknown', () => {
        // TSM files in TWD; labelling its statements USD was a 30× error.
        expect(formatLargeAmount(2_900_000_000_000, 'TWD')).toBe('2.9T TWD');
        expect(formatLargeAmount(2_900_000_000_000)).toBe('2.9T');
        expect(formatLargeAmount(12_345)).toBe('12345');
    });

    it('renders a missing or non-finite amount as N/A', () => {
        expect(formatLargeAmount(null, 'USD')).toBe('N/A');
        expect(formatLargeAmount(Number.NaN, 'KRW')).toBe('N/A');
    });
});

describe('formatSignedPercent', () => {
    it('prefixes + on non-negative values and keeps the minus sign', () => {
        expect(formatSignedPercent(1.234)).toBe('+1.23%');
        expect(formatSignedPercent(-0.456)).toBe('-0.46%');
        expect(formatSignedPercent(0)).toBe('+0.00%');
    });

    it('never shows a minus sign on a change that rounds to zero', () => {
        // Composed with formatNullableNumber's sign-stripping: -0.001 must not become -0.00%.
        expect(formatSignedPercent(-0.001)).toBe('+0.00%');
    });

    it('renders a missing change as N/A without a percent sign', () => {
        expect(formatSignedPercent(Number.NaN)).toBe('N/A');
        expect(formatSignedPercent(null)).toBe('N/A');
    });
});

describe('formatPlainNumber', () => {
    it('renders clean published figures byte-identically to String()', () => {
        for (const v of [0.3, 4.415, 29723.864, 250000, -1.5]) {
            expect(formatPlainNumber(v)).toBe(String(v));
        }
    });

    it('strips binary float noise', () => {
        expect(formatPlainNumber(0.30000000000000004)).toBe('0.3');
        expect(formatPlainNumber(3.4000000000000004)).toBe('3.4');
    });

    it('keeps digits beyond the 10th significant digit on large published figures', () => {
        // The old 10-significant-digit rule rendered this '29723864120',
        // cutting off the real trailing '3.45'.
        expect(formatPlainNumber(29723864123.45)).toBe('29723864123.45');
    });

    it('renders a missing or non-finite figure as N/A', () => {
        expect(formatPlainNumber(null)).toBe('N/A');
        expect(formatPlainNumber(undefined)).toBe('N/A');
        expect(formatPlainNumber(Number.NaN)).toBe('N/A');
    });
});
