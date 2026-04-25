import { describe, it, expect } from 'vitest';
import {
    parseNumberOrDefault,
    parseJsonResponse,
    stripMarkdownCodeBlock,
    computeSecondsUntilCacheExpiry,
} from '@/domain/utils';
import { SECONDS_PER_DAY, SECONDS_PER_HOUR } from '@/domain/constants/time';

const TEST_EXPIRY_HOUR_KST = 17;

describe('parseNumberOrDefault', () => {
    it('returns defaultValue when raw is undefined', () => {
        expect(parseNumberOrDefault(undefined, 42)).toBe(42);
    });

    it('returns defaultValue when raw is empty string', () => {
        expect(parseNumberOrDefault('', 42)).toBe(42);
    });

    it('parses valid float', () => {
        expect(parseNumberOrDefault('3.14', 0)).toBe(3.14);
    });

    it('parses valid integer', () => {
        expect(parseNumberOrDefault('100', 0)).toBe(100);
    });

    it('returns defaultValue for non-numeric string', () => {
        expect(parseNumberOrDefault('not-a-number', 99)).toBe(99);
    });

    it('returns defaultValue for NaN string', () => {
        expect(parseNumberOrDefault('NaN', 5)).toBe(5);
    });

    it('returns defaultValue for Infinity', () => {
        expect(parseNumberOrDefault('Infinity', 5)).toBe(5);
    });
});

describe('stripMarkdownCodeBlock', () => {
    it('strips ```json code block', () => {
        const input = '```json\n{"key": "value"}\n```';
        expect(stripMarkdownCodeBlock(input)).toBe('{"key": "value"}');
    });

    it('strips plain ``` code block', () => {
        const input = '```\n{"key": "value"}\n```';
        expect(stripMarkdownCodeBlock(input)).toBe('{"key": "value"}');
    });

    it('returns trimmed text as-is when no code block', () => {
        const input = '  {"key": "value"}  ';
        expect(stripMarkdownCodeBlock(input)).toBe('{"key": "value"}');
    });

    it('trims the extracted content', () => {
        const input = '```json\n  {"key": "value"}  \n```';
        expect(stripMarkdownCodeBlock(input)).toBe('{"key": "value"}');
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
            // parseJsonResponse는 { cause: error } 옵션과 함께 Error를 던지므로 cause 필드가 런타임에 항상 존재
            expect((err as { cause: unknown }).cause).toBeInstanceOf(
                SyntaxError
            );
        }
    });
});

describe('computeSecondsUntilCacheExpiry', () => {
    it('returns seconds remaining before expiry when before that time', () => {
        // KST 14:00 = UTC 05:00
        const now = new Date('2026-04-25T05:00:00.000Z');
        const result = computeSecondsUntilCacheExpiry(
            now,
            TEST_EXPIRY_HOUR_KST
        );
        // KST 17:00 = UTC 08:00 → diff = 3 hours = 10800 seconds
        expect(result).toBe(3 * SECONDS_PER_HOUR);
    });

    it('returns seconds to next day when at exactly expiry time', () => {
        // KST 17:00 = UTC 08:00 — rawDiffMs = 0, so next day
        const now = new Date('2026-04-25T08:00:00.000Z');
        const result = computeSecondsUntilCacheExpiry(
            now,
            TEST_EXPIRY_HOUR_KST
        );
        // next day KST 17:00 = 24 hours = 86400 seconds
        expect(result).toBe(SECONDS_PER_DAY);
    });

    it('returns seconds to next day when after expiry time', () => {
        // KST 20:00 = UTC 11:00
        const now = new Date('2026-04-25T11:00:00.000Z');
        const result = computeSecondsUntilCacheExpiry(
            now,
            TEST_EXPIRY_HOUR_KST
        );
        // next KST 17:00 is in 21 hours = 75600 seconds
        expect(result).toBe(21 * SECONDS_PER_HOUR);
    });

    it('returns at least 1 when diff rounds to 0', () => {
        // KST 16:59:59.500 = UTC 07:59:59.500
        const now = new Date('2026-04-25T07:59:59.500Z');
        const result = computeSecondsUntilCacheExpiry(
            now,
            TEST_EXPIRY_HOUR_KST
        );
        // Math.floor(500ms / 1000) = 0 → Math.max(1, 0) = 1
        expect(result).toBe(1);
    });

    it('handles midnight (KST 00:00 = UTC 15:00 previous day)', () => {
        // KST 00:00 = UTC 15:00 previous day
        const now = new Date('2026-04-24T15:00:00.000Z');
        const result = computeSecondsUntilCacheExpiry(
            now,
            TEST_EXPIRY_HOUR_KST
        );
        // KST 17:00 is 17 hours later = 61200 seconds
        expect(result).toBe(17 * SECONDS_PER_HOUR);
    });
});
