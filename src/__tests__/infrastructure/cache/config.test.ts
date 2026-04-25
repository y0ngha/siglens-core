import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    ANALYSIS_CACHE_TTL,
    buildAnalysisCacheKey,
    CACHE_EXPIRY_HOUR_KST,
    computeEffectiveTtl,
    computeSecondsUntilCacheExpiry,
    readUpstashConfig,
} from '@/infrastructure/cache/config';
import {
    SECONDS_PER_DAY,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE,
} from '@/domain/constants/time';

describe('cache config constants', () => {
    it('ANALYSIS_CACHE_TTL values', () => {
        expect(ANALYSIS_CACHE_TTL['5Min']).toBe(5 * SECONDS_PER_MINUTE);
        expect(ANALYSIS_CACHE_TTL['15Min']).toBe(15 * SECONDS_PER_MINUTE);
        expect(ANALYSIS_CACHE_TTL['30Min']).toBe(30 * SECONDS_PER_MINUTE);
        expect(ANALYSIS_CACHE_TTL['1Hour']).toBe(SECONDS_PER_HOUR);
        expect(ANALYSIS_CACHE_TTL['4Hour']).toBe(4 * SECONDS_PER_HOUR);
        expect(ANALYSIS_CACHE_TTL['1Day']).toBe(SECONDS_PER_DAY);
    });

    it('CACHE_EXPIRY_HOUR_KST', () => {
        expect(CACHE_EXPIRY_HOUR_KST).toBe(17);
    });
});

describe('readUpstashConfig', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('returns null when URL is missing', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
        expect(readUpstashConfig()).toBeNull();
    });

    it('returns null when token is missing', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
        expect(readUpstashConfig()).toBeNull();
    });

    it('returns config when both URL and token are present', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'master-token');
        vi.stubEnv('UPSTASH_REDIS_REST_READONLY_TOKEN', 'readonly-token');
        expect(readUpstashConfig()).toEqual({
            url: 'https://example.upstash.io',
            token: 'master-token',
            readonlyToken: 'readonly-token',
        });
    });

    it('returns empty readonlyToken when env var is missing', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'master-token');
        vi.stubEnv('UPSTASH_REDIS_REST_READONLY_TOKEN', '');
        expect(readUpstashConfig()?.readonlyToken).toBe('');
    });
});

describe('computeSecondsUntilCacheExpiry', () => {
    it('returns seconds remaining before KST 17:00 when before that time', () => {
        // KST 14:00 = UTC 05:00
        const now = new Date('2026-04-25T05:00:00.000Z');
        const result = computeSecondsUntilCacheExpiry(now);
        // KST 17:00 = UTC 08:00 → diff = 3 hours = 10800 seconds
        expect(result).toBe(3 * SECONDS_PER_HOUR);
    });

    it('returns seconds to next day KST 17:00 when at exactly KST 17:00', () => {
        // KST 17:00 = UTC 08:00 — rawDiffMs = 0, so next day
        const now = new Date('2026-04-25T08:00:00.000Z');
        const result = computeSecondsUntilCacheExpiry(now);
        // next day KST 17:00 = 24 hours = 86400 seconds
        expect(result).toBe(SECONDS_PER_DAY);
    });

    it('returns seconds to next day KST 17:00 when after KST 17:00', () => {
        // KST 20:00 = UTC 11:00
        const now = new Date('2026-04-25T11:00:00.000Z');
        const result = computeSecondsUntilCacheExpiry(now);
        // next KST 17:00 is in 21 hours = 75600 seconds
        expect(result).toBe(21 * SECONDS_PER_HOUR);
    });

    it('returns at least 1 when diff rounds to 0', () => {
        // KST 16:59:59.500 = UTC 07:59:59.500
        const now = new Date('2026-04-25T07:59:59.500Z');
        const result = computeSecondsUntilCacheExpiry(now);
        // Math.floor(500ms / 1000) = 0 → Math.max(1, 0) = 1
        expect(result).toBe(1);
    });

    it('handles midnight (KST 00:00 = UTC 15:00 previous day)', () => {
        // KST 00:00 = UTC 15:00 previous day
        const now = new Date('2026-04-24T15:00:00.000Z');
        const result = computeSecondsUntilCacheExpiry(now);
        // KST 17:00 is 17 hours later = 61200 seconds
        expect(result).toBe(17 * SECONDS_PER_HOUR);
    });
});

describe('computeEffectiveTtl', () => {
    it('returns TTL when TTL < seconds until expiry', () => {
        // KST 00:00 = UTC 15:00 prev day — 17 hours to expiry (61200s)
        // 5Min TTL = 300s < 61200s
        const now = new Date('2026-04-24T15:00:00.000Z');
        expect(computeEffectiveTtl('5Min', now)).toBe(
            ANALYSIS_CACHE_TTL['5Min']
        );
    });

    it('returns seconds until expiry when expiry < TTL', () => {
        // KST 16:59:00 = UTC 07:59:00 — 60 seconds to expiry
        // 1Day TTL = 86400s > 60s
        const now = new Date('2026-04-25T07:59:00.000Z');
        const result = computeEffectiveTtl('1Day', now);
        expect(result).toBe(60);
    });
});

describe('cache key builders', () => {
    it('buildAnalysisCacheKey', () => {
        expect(buildAnalysisCacheKey('AAPL', '1Hour')).toBe(
            'analysis:AAPL:1Hour'
        );
    });
});
