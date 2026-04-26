import {
    SECONDS_PER_DAY,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE,
} from '@/domain/constants/time';
import {
    ANALYSIS_CACHE_TTL,
    buildAnalysisCacheKey,
    buildBriefingCacheKey,
    CACHE_EXPIRY_HOUR_KST,
    computeEffectiveTtl,
    ISO_DATE_HOUR_PREFIX_LENGTH,
    MARKET_BRIEFING_CACHE_TTL,
} from '@/infrastructure/cache/config';
import { describe, expect, it } from 'vitest';

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

    it('MARKET_BRIEFING_CACHE_TTL', () => {
        expect(MARKET_BRIEFING_CACHE_TTL).toBe(SECONDS_PER_HOUR);
    });

    it('ISO_DATE_HOUR_PREFIX_LENGTH', () => {
        expect(ISO_DATE_HOUR_PREFIX_LENGTH).toBe(13);
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
        // KST 16:59:00 = UTC 07:59:00 — 60 seconds to KST 17:00 expiry
        // 1Day TTL = 86400s > 60s → expiry wins
        const SECONDS_TO_EXPIRY = SECONDS_PER_MINUTE; // 1 minute = 60s
        const now = new Date('2026-04-25T07:59:00.000Z');
        const result = computeEffectiveTtl('1Day', now);
        expect(result).toBe(SECONDS_TO_EXPIRY);
    });
});

describe('cache key builders', () => {
    it('buildAnalysisCacheKey', () => {
        expect(buildAnalysisCacheKey('AAPL', '1Hour')).toBe(
            'analysis:AAPL:1Hour'
        );
    });

    it('buildBriefingCacheKey', () => {
        expect(buildBriefingCacheKey('1Hour')).toBe('briefing:market:1Hour');
    });
});
