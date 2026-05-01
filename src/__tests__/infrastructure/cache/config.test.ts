import {
    SECONDS_PER_DAY,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE,
    SECONDS_PER_YEAR,
} from '@/domain/constants/time';
import {
    ANALYSIS_CACHE_TTL,
    ASSET_INFO_CACHE_TTL_WITH_KOREAN,
    ASSET_INFO_CACHE_TTL_WITHOUT_KOREAN,
    ASSET_INFO_HOURS_WITHOUT_KOREAN,
    buildAnalysisCacheKey,
    buildAssetInfoCacheKey,
    buildBriefingCacheKey,
    buildSectorSignalsCacheKey,
    buildTickerSearchCacheKey,
    CACHE_EXPIRY_HOUR_KST,
    computeEffectiveTtl,
    KOREAN_NAMES_CACHE_TTL,
    KOREAN_TICKERS_CACHE_KEY,
    MARKET_BRIEFING_CACHE_TTL,
    SECTOR_SIGNALS_1HOUR_TTL_MINUTES,
    SECTOR_SIGNALS_15MIN_TTL_MINUTES,
    SECTOR_SIGNALS_TTL_BY_TIMEFRAME,
    TICKER_SEARCH_CACHE_TTL,
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
        expect(CACHE_EXPIRY_HOUR_KST).toBe(17);
    });

    it('MARKET_BRIEFING_CACHE_TTL', () => {
        expect(MARKET_BRIEFING_CACHE_TTL).toBe(SECONDS_PER_HOUR);
    });

    it('ISO_DATE_HOUR_PREFIX_LENGTH', () => {
        expect(ISO_DATE_HOUR_PREFIX_LENGTH).toBe(13);
    });

    it('TICKER_SEARCH_CACHE_TTL', () => {
        expect(TICKER_SEARCH_CACHE_TTL).toBe(SECONDS_PER_DAY);
    });

    it('KOREAN_NAMES_CACHE_TTL', () => {
        expect(KOREAN_NAMES_CACHE_TTL).toBe(SECONDS_PER_YEAR);
    });

    it('ASSET_INFO_CACHE_TTL_WITH_KOREAN', () => {
        expect(ASSET_INFO_CACHE_TTL_WITH_KOREAN).toBe(SECONDS_PER_YEAR);
    });

    it('ASSET_INFO_CACHE_TTL_WITHOUT_KOREAN', () => {
        expect(ASSET_INFO_CACHE_TTL_WITHOUT_KOREAN).toBe(
            ASSET_INFO_HOURS_WITHOUT_KOREAN * SECONDS_PER_HOUR
        );
    });

    it('KOREAN_TICKERS_CACHE_KEY', () => {
        expect(KOREAN_TICKERS_CACHE_KEY).toBe('korean:tickers');
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
    it('buildAnalysisCacheKey includes model identifier', () => {
        expect(buildAnalysisCacheKey('AAPL', '1Hour', 'gemini-2.5-flash')).toBe(
            'analysis:AAPL:1Hour:gemini-2.5-flash'
        );
    });

    it('buildAnalysisCacheKey isolates results by model', () => {
        const keyA = buildAnalysisCacheKey('AAPL', '1Hour', 'model-a');
        const keyB = buildAnalysisCacheKey('AAPL', '1Hour', 'model-b');
        expect(keyA).not.toBe(keyB);
    });

    it('buildBriefingCacheKey', () => {
        expect(buildBriefingCacheKey('1Hour')).toBe('briefing:market:1Hour');
    });

    it('buildTickerSearchCacheKey lowercases the query', () => {
        expect(buildTickerSearchCacheKey('AAPL')).toBe('ticker:search:aapl');
        expect(buildTickerSearchCacheKey('애플')).toBe('ticker:search:애플');
    });

    it('buildAssetInfoCacheKey uppercases the symbol', () => {
        expect(buildAssetInfoCacheKey('aapl')).toBe('asset-info:AAPL');
        expect(buildAssetInfoCacheKey('AAPL')).toBe('asset-info:AAPL');
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
