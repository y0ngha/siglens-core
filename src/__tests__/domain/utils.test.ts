import { describe, it, expect } from 'vitest';
import {
    parseNumberOrDefault,
    parseJsonResponse,
    stripMarkdownCodeBlock,
    computeSecondsUntilCacheExpiry,
    isEtRegularSessionOpen,
    secondsUntilNextEtRegularOpen,
} from '@/domain/utils';
import {
    SECONDS_PER_DAY,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE,
} from '@/domain/constants/time';

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

describe('isEtRegularSessionOpen', () => {
    it('EDT 평일 정규장 중이면 true (Mon 10:00 ET)', () => {
        expect(isEtRegularSessionOpen(new Date('2026-07-06T14:00:00Z'))).toBe(
            true
        );
    });
    it('EST 평일 정규장 중이면 true (Mon 10:00 ET)', () => {
        expect(isEtRegularSessionOpen(new Date('2026-01-05T15:00:00Z'))).toBe(
            true
        );
    });
    it('개장 전이면 false (Mon 08:00 ET)', () => {
        expect(isEtRegularSessionOpen(new Date('2026-07-06T12:00:00Z'))).toBe(
            false
        );
    });
    it('마감 후면 false (Mon 17:00 ET)', () => {
        expect(isEtRegularSessionOpen(new Date('2026-07-06T21:00:00Z'))).toBe(
            false
        );
    });
    it('주말이면 false (Sat 14:00 ET)', () => {
        expect(isEtRegularSessionOpen(new Date('2026-07-04T18:00:00Z'))).toBe(
            false
        );
    });
    it('정확히 09:30 ET = 개장 포함 (boundary inclusive)', () => {
        // 2026-07-06T13:30:00Z = Mon 09:30 EDT
        expect(isEtRegularSessionOpen(new Date('2026-07-06T13:30:00Z'))).toBe(
            true
        );
    });
    it('정확히 16:00 ET = 마감 제외 (boundary exclusive)', () => {
        // 2026-07-06T20:00:00Z = Mon 16:00 EDT
        expect(isEtRegularSessionOpen(new Date('2026-07-06T20:00:00Z'))).toBe(
            false
        );
    });
    it('일요일이면 false (Sun 12:00 ET)', () => {
        // 2026-07-05T16:00:00Z = Sun 12:00 EDT
        expect(isEtRegularSessionOpen(new Date('2026-07-05T16:00:00Z'))).toBe(false);
    });
});

describe('secondsUntilNextEtRegularOpen', () => {
    // 09:30 ET 개장. EDT는 13:30 UTC, EST는 14:30 UTC.
    it('EDT 개장 전 → 오늘 개장까지 (Mon 08:00 ET → 90분)', () => {
        expect(
            secondsUntilNextEtRegularOpen(new Date('2026-07-06T12:00:00Z'))
        ).toBe(90 * SECONDS_PER_MINUTE);
    });
    it('현재 분의 경과 초를 빼서 정확히 개장 시각에 만료된다 (Mon 08:00:30 ET)', () => {
        // 2026-07-06T12:00:30Z = Mon 08:00:30 EDT → 90분 후 개장, 30초 보정
        expect(
            secondsUntilNextEtRegularOpen(new Date('2026-07-06T12:00:30Z'))
        ).toBe(90 * SECONDS_PER_MINUTE - 30);
    });
    it('EST 개장 전 → 오늘 개장까지 (Mon 09:00 ET → 30분)', () => {
        expect(
            secondsUntilNextEtRegularOpen(new Date('2026-01-05T14:00:00Z'))
        ).toBe(30 * SECONDS_PER_MINUTE);
    });
    it('EDT 마감 후 → 다음 평일 개장까지 (Mon 17:00 ET → 990분)', () => {
        expect(
            secondsUntilNextEtRegularOpen(new Date('2026-07-06T21:00:00Z'))
        ).toBe(990 * SECONDS_PER_MINUTE);
    });
    it('토요일 → 월요일 개장까지 (Sat 14:00 ET → 2610분)', () => {
        expect(
            secondsUntilNextEtRegularOpen(new Date('2026-07-04T18:00:00Z'))
        ).toBe(2610 * SECONDS_PER_MINUTE);
    });
    it('금요일 마감 후 → 월요일 개장까지 (Fri 17:00 ET → 3870분)', () => {
        expect(
            secondsUntilNextEtRegularOpen(new Date('2026-07-03T21:00:00Z'))
        ).toBe(3870 * SECONDS_PER_MINUTE);
    });
    it('일요일 → 월요일 개장까지 (Sun 14:00 ET → 1170분)', () => {
        // 2026-07-05T18:00:00Z = Sun 14:00 EDT
        expect(
            secondsUntilNextEtRegularOpen(new Date('2026-07-05T18:00:00Z'))
        ).toBe(1170 * SECONDS_PER_MINUTE);
    });
});
