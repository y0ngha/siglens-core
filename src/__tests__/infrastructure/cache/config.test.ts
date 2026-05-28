import {
    SECONDS_PER_DAY,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE,
} from '@/domain/constants/time';
import {
    ANALYSIS_CACHE_TTL,
    BARS_OFFHOURS_TTL_CEILING_SECONDS,
    BARS_OPEN_TTL_SECONDS,
    buildAnalysisCacheKey,
    buildBriefingCacheKey,
    buildFundamentalCacheKey,
    buildNewsCacheKey,
    buildOverallCacheKey,
    buildSectorSignalsCacheKey,
    CACHE_EXPIRY_HOUR_KST,
    CACHE_KEY_SCHEMA_VERSION,
    computeBarsEffectiveTtl,
    computeEffectiveTtl,
    DEFAULT_ANALYSIS_MODEL_ID,
    FUNDAMENTAL_CACHE_TTL_SECONDS,
    MARKET_BRIEFING_CACHE_TTL,
    NEWS_CACHE_TTL_SECONDS,
    OVERALL_CACHE_TTL_SECONDS,
    SECTOR_SIGNALS_1HOUR_TTL_MINUTES,
    SECTOR_SIGNALS_15MIN_TTL_MINUTES,
    SECTOR_SIGNALS_TTL_BY_TIMEFRAME,
} from '@/infrastructure/cache/config';
import { ISO_DATE_HOUR_PREFIX_LENGTH } from '@/domain/constants/format';
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
        expect(CACHE_EXPIRY_HOUR_KST).toBe(5);
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
        // KST 04:00 = UTC 19:00 prev day — 1 hour to KST 05:00 expiry (3600s)
        // 5Min TTL = 300s < 3600s → TTL wins
        const now = new Date('2026-04-24T19:00:00.000Z');
        expect(computeEffectiveTtl('5Min', now)).toBe(
            ANALYSIS_CACHE_TTL['5Min']
        );
    });

    it('returns seconds until expiry when expiry < TTL', () => {
        // KST 04:59:00 = UTC 19:59:00 prev day — 60 seconds to KST 05:00 expiry
        // 1Day TTL = 86400s > 60s → expiry wins
        const SECONDS_TO_EXPIRY = SECONDS_PER_MINUTE; // 1 minute = 60s
        const now = new Date('2026-04-24T19:59:00.000Z');
        const result = computeEffectiveTtl('1Day', now);
        expect(result).toBe(SECONDS_TO_EXPIRY);
    });
});

describe('cache key builders', () => {
    it('buildAnalysisCacheKey includes model identifier', () => {
        expect(buildAnalysisCacheKey('AAPL', '1Hour', 'gemini-2.5-flash')).toBe(
            'analysis:AAPL:1Hour:gemini-2.5-flash'
        );
    });

    it('buildAnalysisCacheKey uses DEFAULT_ANALYSIS_MODEL_ID when modelId is omitted', () => {
        expect(buildAnalysisCacheKey('AAPL', '1Day')).toBe(
            `analysis:AAPL:1Day:${DEFAULT_ANALYSIS_MODEL_ID}`
        );
    });

    it('buildBriefingCacheKey', () => {
        expect(buildBriefingCacheKey('1Hour')).toBe('briefing:market:1Hour');
    });

    it('buildSectorSignalsCacheKey composes timeframe and bucket', () => {
        expect(buildSectorSignalsCacheKey('1Day', '2026-04-25')).toBe(
            'dashboard:signals:1Day:2026-04-25'
        );
        expect(buildSectorSignalsCacheKey('1Hour', '2026-04-25T13')).toBe(
            'dashboard:signals:1Hour:2026-04-25T13'
        );
        expect(buildSectorSignalsCacheKey('15Min', '2026-04-25T13:45')).toBe(
            'dashboard:signals:15Min:2026-04-25T13:45'
        );
    });

    it('SECTOR_SIGNALS_TTL_BY_TIMEFRAME has all dashboard timeframes', () => {
        expect(SECTOR_SIGNALS_TTL_BY_TIMEFRAME['1Day']).toBe(SECONDS_PER_HOUR);
        expect(SECTOR_SIGNALS_TTL_BY_TIMEFRAME['1Hour']).toBe(
            SECTOR_SIGNALS_1HOUR_TTL_MINUTES * SECONDS_PER_MINUTE
        );
        expect(SECTOR_SIGNALS_TTL_BY_TIMEFRAME['15Min']).toBe(
            SECTOR_SIGNALS_15MIN_TTL_MINUTES * SECONDS_PER_MINUTE
        );
    });
});

describe('new analysis cache keys', () => {
    it('returns {v}:analysis:fundamental:{symbol}:{model} format', () => {
        const a = buildFundamentalCacheKey('AAPL', 'gemini-2.5-pro');
        expect(a).toBe(
            `${CACHE_KEY_SCHEMA_VERSION}:analysis:fundamental:AAPL:gemini-2.5-pro`
        );
    });

    it('buildNewsCacheKey same shape with version prefix', () => {
        expect(buildNewsCacheKey('AAPL', 'gemini-2.5-pro', 'h2')).toBe(
            `${CACHE_KEY_SCHEMA_VERSION}:analysis:news:AAPL:gemini-2.5-pro:h2`
        );
    });

    it('buildOverallCacheKey includes timeframe and version prefix', () => {
        expect(
            buildOverallCacheKey('AAPL', '5Min', 'gemini-2.5-pro', 'h3')
        ).toBe(
            `${CACHE_KEY_SCHEMA_VERSION}:analysis:overall:AAPL:5Min:gemini-2.5-pro:h3`
        );
    });

    it('CACHE_KEY_SCHEMA_VERSION is a non-empty string used as a global invalidation lever', () => {
        expect(typeof CACHE_KEY_SCHEMA_VERSION).toBe('string');
        expect(CACHE_KEY_SCHEMA_VERSION.length).toBeGreaterThan(0);
    });

    it('TTL constants match SECONDS_PER_DAY', () => {
        expect(FUNDAMENTAL_CACHE_TTL_SECONDS).toBe(SECONDS_PER_DAY);
        expect(NEWS_CACHE_TTL_SECONDS).toBe(SECONDS_PER_DAY);
        expect(OVERALL_CACHE_TTL_SECONDS).toBe(SECONDS_PER_DAY);
    });
});

describe('computeBarsEffectiveTtl', () => {
    it('개장 중이면 BARS_OPEN_TTL_SECONDS (Mon 10:00 ET)', () => {
        expect(computeBarsEffectiveTtl('1Day', new Date('2026-07-06T14:00:00Z')))
            .toBe(BARS_OPEN_TTL_SECONDS);
    });
    it('개장 중이면 timeframe 무관 동일 (5Min, Mon 10:00 ET)', () => {
        expect(computeBarsEffectiveTtl('5Min', new Date('2026-07-06T14:00:00Z')))
            .toBe(BARS_OPEN_TTL_SECONDS);
    });
    it('장외 + 다음 개장이 24h 이내면 그 시각까지 (Mon 17:00 ET → 59400s)', () => {
        expect(computeBarsEffectiveTtl('1Day', new Date('2026-07-06T21:00:00Z')))
            .toBe(990 * SECONDS_PER_MINUTE);
    });
    it('장외 + 다음 개장이 24h 초과면 24h로 캡 (Sat 14:00 ET)', () => {
        expect(computeBarsEffectiveTtl('1Day', new Date('2026-07-04T18:00:00Z')))
            .toBe(BARS_OFFHOURS_TTL_CEILING_SECONDS);
    });
});
