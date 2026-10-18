import {
    MARKET_EVENT_CACHE_KEY_CAP,
    MARKET_EVENT_LIMIT,
    marketEventHorizonMs,
} from '@/domain/analysis/marketEvents';
import {
    SECONDS_PER_DAY,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE,
} from '@/domain/constants/time';
import {
    ANALYSIS_CACHE_SETTLE_BUFFER_MINUTES,
    ANALYSIS_CACHE_TTL,
    analysisHistoryQuery,
    BARS_OFFHOURS_TTL_CEILING_SECONDS,
    BARS_OPEN_TTL_SECONDS,
    buildAnalysisCacheKey,
    buildAnalysisPeekCacheKey,
    buildBriefingCacheKey,
    buildCongressTrendCacheKey,
    buildFinancialsCacheKey,
    buildInvestorFlowsCacheKey,
    buildFundamentalCacheKey,
    buildMacroBriefingCacheKey,
    buildMarketNewsDigestCacheKey,
    buildNewsCacheKey,
    buildOptionsCacheKey,
    buildOverallCacheKey,
    buildOverallPeekCacheKey,
    buildSectorSignalsCacheKey,
    CACHE_EXPIRY_HOUR_KST,
    CACHE_KEY_SCHEMA_VERSION,
    computeBarsEffectiveTtl,
    computeEffectiveTtl,
    CONGRESS_PROMPT_TEMPLATE_VERSION,
    DEFAULT_ANALYSIS_MODEL_ID,
    FINANCIALS_CACHE_TTL_SECONDS,
    FUNDAMENTAL_CACHE_TTL_SECONDS,
    FUNDAMENTAL_PROMPT_TEMPLATE_VERSION,
    INVESTOR_FLOWS_CACHE_TTL_SECONDS,
    INVESTOR_FLOWS_PROMPT_TEMPLATE_VERSION,
    MACRO_BRIEFING_PROMPT_TEMPLATE_VERSION,
    MARKET_BRIEFING_CACHE_TTL,
    MARKET_BRIEFING_PROMPT_TEMPLATE_VERSION,
    narrowMarketEventsForCacheKey,
    narrowPriorAnalysesForCacheKey,
    NEWS_CACHE_TTL_SECONDS,
    NEWS_PROMPT_TEMPLATE_VERSION,
    OVERALL_CACHE_TTL_SECONDS,
    OVERALL_PROMPT_TEMPLATE_VERSION,
    priorAnalysisWindowStartMs,
    PROMPT_TEMPLATE_VERSION,
    SECTOR_SIGNALS_15MIN_TTL_MINUTES,
    SECTOR_SIGNALS_1HOUR_TTL_MINUTES,
    SECTOR_SIGNALS_TTL_BY_TIMEFRAME,
} from '@/infrastructure/cache/config';
import { ISO_DATE_HOUR_PREFIX_LENGTH } from '@/domain/constants/format';
import {
    PRIOR_ANALYSIS_LIMIT,
    PRIOR_ANALYSIS_SLACK,
} from '@/domain/analysis/priorAnalysis';
import { CRYPTO_SESSION, US_EQUITY_SESSION } from '@/domain/session';
import type { PositionBucket, PriorAnalysis } from '@/domain/types';
import { describe, expect, it } from 'vitest';
import { makeKrSession } from '../../helpers/krSession';

/** Minimal `PriorAnalysis` fixture — only `generatedAt` matters to the cache-key narrowing under test. */
function priorAnalysisAt(generatedAt: Date): PriorAnalysis {
    return {
        generatedAt,
        trend: 'bullish',
        riskLevel: 'medium',
    };
}

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

describe('computeEffectiveTtl — 세션별 만료', () => {
    const KR = makeKrSession(['2026-07-07']);

    it('세션을 생략하면 종전 KST 05:00 경계와 같다', () => {
        const now = new Date('2026-04-24T19:59:00.000Z');
        expect(computeEffectiveTtl('1Day', now)).toBe(
            computeEffectiveTtl('1Day', now, undefined)
        );
        expect(computeEffectiveTtl('1Day', now)).toBe(SECONDS_PER_MINUTE);
    });

    it('US EDT: 마감 16:00 ET + 정착 버퍼까지 (Mon 15:00 EDT → 90분)', () => {
        expect(
            computeEffectiveTtl(
                '1Day',
                new Date('2026-07-06T19:00:00Z'),
                US_EQUITY_SESSION
            )
        ).toBe(90 * SECONDS_PER_MINUTE);
    });

    it('US EST: 같은 현지 시각이면 UTC가 한 시간 늦어도 같은 길이 (Mon 15:00 EST → 90분)', () => {
        expect(
            computeEffectiveTtl(
                '1Day',
                new Date('2026-01-05T20:00:00Z'),
                US_EQUITY_SESSION
            )
        ).toBe(90 * SECONDS_PER_MINUTE);
    });

    it('US: 마감 직후 정착 버퍼 안에서는 마감 + 버퍼까지만 산다', () => {
        // Mon 16:10 EDT. 종전(KST 05:00 = 16:00 EDT 경계)이면 다음 날까지 살았다.
        expect(
            computeEffectiveTtl(
                '1Day',
                new Date('2026-07-06T20:10:00Z'),
                US_EQUITY_SESSION
            )
        ).toBe(
            (ANALYSIS_CACHE_SETTLE_BUFFER_MINUTES - 10) * SECONDS_PER_MINUTE
        );
    });

    it('US EST: 종전 KST 05:00 경계는 마감 한 시간 전(15:00 EST)에 와서 마감 전 분석이 일찍 죽었다', () => {
        // Mon 14:30 EST. 세션 생략: KST 05:00(= 15:00 EST)까지 30분. 세션 지정: 16:30 EST까지 2시간.
        const now = new Date('2026-01-05T19:30:00Z');
        expect(computeEffectiveTtl('1Day', now)).toBe(30 * SECONDS_PER_MINUTE);
        expect(computeEffectiveTtl('1Day', now, US_EQUITY_SESSION)).toBe(
            2 * SECONDS_PER_HOUR
        );
    });

    it('KR 평일: 15:30 KST 마감 + 버퍼 = 16:00 KST까지 (Mon 14:00 KST → 2시간)', () => {
        // 종전 경계(KST 05:00)라면 다음 날 새벽까지 15시간 살았다.
        const now = new Date('2026-07-06T05:00:00Z');
        expect(computeEffectiveTtl('1Day', now)).toBe(15 * SECONDS_PER_HOUR);
        expect(computeEffectiveTtl('1Day', now, KR)).toBe(2 * SECONDS_PER_HOUR);
    });

    it('KR 휴장일: 휴장일 마감은 없는 마감이라 건너뛴다 (Mon 17:00 KST, 화 휴장 → 수 16:00 KST는 24시간 초과 → 천장)', () => {
        // 2026-07-07(화) 휴장. 월 08:00Z(17:00 KST)에는 휴장이 없다면 화 07:00Z까지 23시간.
        const now = new Date('2026-07-06T08:00:00Z');
        expect(computeEffectiveTtl('1Day', now, makeKrSession())).toBe(
            23 * SECONDS_PER_HOUR
        );
        expect(computeEffectiveTtl('1Day', now, KR)).toBe(
            ANALYSIS_CACHE_TTL['1Day']
        );
    });

    it('KR 휴장일 당일에도 그날 마감을 기다리지 않는다', () => {
        // 화(휴장) 10:00 KST. 휴장을 모르면 오늘 16:00 KST까지 6시간.
        const now = new Date('2026-07-07T01:00:00Z');
        expect(computeEffectiveTtl('1Day', now, KR)).toBe(
            ANALYSIS_CACHE_TTL['1Day']
        );
    });

    it('크립토: 다음 UTC 00:00까지 (18:30Z → 5.5시간)', () => {
        expect(
            computeEffectiveTtl(
                '1Day',
                new Date('2026-07-06T18:30:00Z'),
                CRYPTO_SESSION
            )
        ).toBe(5.5 * SECONDS_PER_HOUR);
    });

    it('크립토: 종전 KST 05:00(20:00Z) 경계 이후에도 UTC 자정까지 산다 (20:30Z → 3.5시간)', () => {
        const now = new Date('2026-07-06T20:30:00Z');
        expect(computeEffectiveTtl('1Day', now)).toBe(
            24 * SECONDS_PER_HOUR - 30 * SECONDS_PER_MINUTE
        );
        expect(computeEffectiveTtl('1Day', now, CRYPTO_SESSION)).toBe(
            3.5 * SECONDS_PER_HOUR
        );
    });

    it('타임프레임 천장이 경계보다 짧으면 천장이 이긴다', () => {
        expect(
            computeEffectiveTtl(
                '5Min',
                new Date('2026-07-06T19:00:00Z'),
                US_EQUITY_SESSION
            )
        ).toBe(ANALYSIS_CACHE_TTL['5Min']);
    });

    it('거래일을 찾지 못하는 잘못된 스펙은 천장으로 폴백한다', () => {
        expect(
            computeEffectiveTtl('1Day', new Date('2026-07-06T05:00:00Z'), {
                ...makeKrSession(),
                closeMinuteFor: () => 0,
            })
        ).toBe(ANALYSIS_CACHE_TTL['1Day']);
    });
});

describe('cache key builders', () => {
    it('buildAnalysisCacheKey includes model identifier and prompt-template version', () => {
        expect(buildAnalysisCacheKey('AAPL', '1Hour', 'gemini-3.6-flash')).toBe(
            `analysis:AAPL:1Hour:gemini-3.6-flash:${PROMPT_TEMPLATE_VERSION}`
        );
    });

    it('buildAnalysisCacheKey uses DEFAULT_ANALYSIS_MODEL_ID when modelId is omitted', () => {
        expect(buildAnalysisCacheKey('AAPL', '1Day')).toBe(
            `analysis:AAPL:1Day:${DEFAULT_ANALYSIS_MODEL_ID}:${PROMPT_TEMPLATE_VERSION}`
        );
    });

    it('buildBriefingCacheKey includes the date-hour prefix, model, and input hash', () => {
        expect(
            buildBriefingCacheKey('2026-04-26T14', 'test-model', 'abc123')
        ).toBe(
            `briefing:market:2026-04-26T14:test-model:abc123:${MARKET_BRIEFING_PROMPT_TEMPLATE_VERSION}`
        );
    });

    it('buildBriefingCacheKey: a different input hash yields a different key', () => {
        const a = buildBriefingCacheKey('2026-04-26T14', 'model-x', 'hashA');
        const b = buildBriefingCacheKey('2026-04-26T14', 'model-x', 'hashB');
        expect(a).not.toBe(b);
    });

    it('buildBriefingCacheKey: a different model yields a different key', () => {
        const a = buildBriefingCacheKey('2026-04-26T14', 'model-x', 'hash');
        const b = buildBriefingCacheKey('2026-04-26T14', 'model-y', 'hash');
        expect(a).not.toBe(b);
    });

    it('buildMacroBriefingCacheKey uses the briefing:macro: namespace with the date bucket, model, and input hash', () => {
        expect(
            buildMacroBriefingCacheKey('2026-06-16', 'test-model', 'abc123')
        ).toBe(
            `briefing:macro:2026-06-16:test-model:abc123:${MACRO_BRIEFING_PROMPT_TEMPLATE_VERSION}`
        );
    });

    it('buildMacroBriefingCacheKey ends with the prompt-template version, so a future bump busts the cache', () => {
        const key = buildMacroBriefingCacheKey(
            '2026-06-16T09',
            'test-model',
            'abc123'
        );
        expect(key.endsWith(`:${MACRO_BRIEFING_PROMPT_TEMPLATE_VERSION}`)).toBe(
            true
        );
    });

    it('buildMacroBriefingCacheKey: different input hash yields a different key', () => {
        const a = buildMacroBriefingCacheKey(
            '2026-06-16T09',
            'model-x',
            'hashA'
        );
        const b = buildMacroBriefingCacheKey(
            '2026-06-16T09',
            'model-x',
            'hashB'
        );
        expect(a).not.toBe(b);
    });

    it('buildMacroBriefingCacheKey: different model yields a different key', () => {
        const a = buildMacroBriefingCacheKey(
            '2026-06-16T09',
            'model-x',
            'hash'
        );
        const b = buildMacroBriefingCacheKey(
            '2026-06-16T09',
            'model-y',
            'hash'
        );
        expect(a).not.toBe(b);
    });

    it('buildMacroBriefingCacheKey: namespace cannot collide with buildBriefingCacheKey for the same args', () => {
        const macro = buildMacroBriefingCacheKey(
            '2026-06-16T09',
            'model',
            'hash'
        );
        const market = buildBriefingCacheKey('2026-06-16T09', 'model', 'hash');
        expect(macro).not.toBe(market);
        expect(macro).toContain('briefing:macro:');
        expect(market).toContain('briefing:market:');
    });

    it('buildSectorSignalsCacheKey composes timeframe and bucket', () => {
        expect(
            buildSectorSignalsCacheKey('1Day', '2026-04-25', 'stocks-a')
        ).toBe('dashboard:signals:1Day:2026-04-25:stocks-a');
        expect(
            buildSectorSignalsCacheKey('1Hour', '2026-04-25T13', 'stocks-b')
        ).toBe('dashboard:signals:1Hour:2026-04-25T13:stocks-b');
        expect(
            buildSectorSignalsCacheKey('15Min', '2026-04-25T13:45', 'stocks-c')
        ).toBe('dashboard:signals:15Min:2026-04-25T13:45:stocks-c');
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
    it('returns {v}:analysis:fundamental:{symbol}:{model}:{promptVersion} format', () => {
        const a = buildFundamentalCacheKey('AAPL', 'gemini-3.1-pro-preview');
        expect(a).toBe(
            `${CACHE_KEY_SCHEMA_VERSION}:analysis:fundamental:AAPL:gemini-3.1-pro-preview:${FUNDAMENTAL_PROMPT_TEMPLATE_VERSION}`
        );
    });

    it('buildNewsCacheKey same shape with version prefix', () => {
        expect(buildNewsCacheKey('AAPL', 'gemini-3.1-pro-preview', 'h2')).toBe(
            `${CACHE_KEY_SCHEMA_VERSION}:analysis:news:AAPL:gemini-3.1-pro-preview:${NEWS_PROMPT_TEMPLATE_VERSION}:h2`
        );
    });

    it('buildOverallCacheKey includes timeframe and version prefix', () => {
        expect(
            buildOverallCacheKey('AAPL', '5Min', 'gemini-3.1-pro-preview', 'h3')
        ).toBe(
            `${CACHE_KEY_SCHEMA_VERSION}:analysis:overall:AAPL:5Min:gemini-3.1-pro-preview:${OVERALL_PROMPT_TEMPLATE_VERSION}:h3`
        );
    });

    it('buildOverallPeekCacheKey is content-free (no input hash) with peek segment and version prefix', () => {
        expect(
            buildOverallPeekCacheKey('AAPL', '5Min', 'gemini-3.1-pro-preview')
        ).toBe(
            `${CACHE_KEY_SCHEMA_VERSION}:analysis:overall:peek:AAPL:5Min:gemini-3.1-pro-preview:${OVERALL_PROMPT_TEMPLATE_VERSION}`
        );
    });

    it('buildAnalysisPeekCacheKey: peek segment + tier, no skill/history/events fingerprint', () => {
        expect(
            buildAnalysisPeekCacheKey(
                'AAPL',
                '1Day',
                'gemini-3.6-flash',
                'free'
            )
        ).toBe(
            `analysis:peek:AAPL:1Day:gemini-3.6-flash:${PROMPT_TEMPLATE_VERSION}:free`
        );
    });

    it('buildAnalysisPeekCacheKey: reasoning → positionBucket → locale 순서로 suffix가 붙는다', () => {
        const base = buildAnalysisPeekCacheKey(
            'AAPL',
            '1Day',
            'gemini-3.6-flash',
            'free'
        );
        expect(
            buildAnalysisPeekCacheKey(
                'AAPL',
                '1Day',
                'gemini-3.6-flash',
                'free',
                true,
                'profit',
                'en'
            )
        ).toBe(`${base}:reason=on:pos=profit:lang=en`);
    });

    it('buildAnalysisPeekCacheKey: locale 생략과 ko는 완전히 같은 키다', () => {
        const omitted = buildAnalysisPeekCacheKey(
            'AAPL',
            '1Day',
            'gemini-3.6-flash',
            'free'
        );
        const ko = buildAnalysisPeekCacheKey(
            'AAPL',
            '1Day',
            'gemini-3.6-flash',
            'free',
            undefined,
            undefined,
            'ko'
        );
        expect(ko).toBe(omitted);
    });

    it('buildAnalysisPeekCacheKey: en은 :lang=en suffix를 붙인다', () => {
        const base = buildAnalysisPeekCacheKey(
            'AAPL',
            '1Day',
            'gemini-3.6-flash',
            'free'
        );
        expect(
            buildAnalysisPeekCacheKey(
                'AAPL',
                '1Day',
                'gemini-3.6-flash',
                'free',
                undefined,
                undefined,
                'en'
            )
        ).toBe(`${base}:lang=en`);
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

describe('prompt-template versions in technical & fundamental keys', () => {
    it('is a non-empty string, separate from CACHE_KEY_SCHEMA_VERSION', () => {
        expect(typeof PROMPT_TEMPLATE_VERSION).toBe('string');
        expect(PROMPT_TEMPLATE_VERSION.length).toBeGreaterThan(0);
        // Distinct invalidation axes — must not be conflated.
        expect(PROMPT_TEMPLATE_VERSION).not.toBe(CACHE_KEY_SCHEMA_VERSION);
    });

    it('technical key ends with the prompt-template version segment', () => {
        const key = buildAnalysisCacheKey(
            'AAPL',
            '1Day',
            'gemini-3.1-pro-preview'
        );
        expect(key.endsWith(`:${PROMPT_TEMPLATE_VERSION}`)).toBe(true);
    });

    it('fundamental key ends with its OWN prompt-template version segment', () => {
        const key = buildFundamentalCacheKey('AAPL', 'gemini-3.1-pro-preview');
        expect(key.endsWith(`:${FUNDAMENTAL_PROMPT_TEMPLATE_VERSION}`)).toBe(
            true
        );
    });

    it('fundamental is decoupled from the technical prompt version', () => {
        // Regression guard for the coupling this split removed: while the two
        // constants shared a value, every technical prompt bump cold-started
        // the fundamental cache fleet (1-day TTL, ~13 upstream calls per miss)
        // for a change that altered zero fundamental prompt bytes. If someone
        // ever points fundamental back at PROMPT_TEMPLATE_VERSION, this fails.
        expect(FUNDAMENTAL_PROMPT_TEMPLATE_VERSION).not.toBe(
            PROMPT_TEMPLATE_VERSION
        );
        const key = buildFundamentalCacheKey('AAPL', 'gemini-3.1-pro-preview');
        expect(key).not.toContain(`:${PROMPT_TEMPLATE_VERSION}`);
    });
});

describe('buildFinancialsCacheKey', () => {
    it('includes schema version, symbol, period, model, prompt version, and fingerprint', () => {
        const k = buildFinancialsCacheKey(
            'AAPL',
            'gemini-3.6-flash',
            'annual',
            'sk1'
        );
        expect(k).toContain(
            ':analysis:financials:AAPL:annual:gemini-3.6-flash:'
        );
        expect(k.endsWith(':sk1')).toBe(true);
    });
    it('omits fingerprint segment when absent', () => {
        expect(
            buildFinancialsCacheKey(
                'AAPL',
                'gemini-3.6-flash',
                'annual'
            ).endsWith(':sk1')
        ).toBe(false);
    });
    it('annual and quarter produce different keys for the same symbol and model', () => {
        const annualKey = buildFinancialsCacheKey(
            'AAPL',
            'gemini-3.6-flash',
            'annual'
        );
        const quarterKey = buildFinancialsCacheKey(
            'AAPL',
            'gemini-3.6-flash',
            'quarter'
        );
        expect(annualKey).not.toBe(quarterKey);
        expect(annualKey).toContain(':annual:');
        expect(quarterKey).toContain(':quarter:');
    });
    it('FINANCIALS_CACHE_TTL_SECONDS equals SECONDS_PER_DAY', () => {
        expect(FINANCIALS_CACHE_TTL_SECONDS).toBe(SECONDS_PER_DAY);
    });
});

describe('buildCongressTrendCacheKey', () => {
    it('skillFingerprint 미제공 시 base key', () => {
        expect(buildCongressTrendCacheKey('AAPL', 'gemini-3.6-flash')).toBe(
            `v1:analysis:congress:AAPL:gemini-3.6-flash:${CONGRESS_PROMPT_TEMPLATE_VERSION}`
        );
    });
    it('skillFingerprint 제공 시 suffix 추가', () => {
        expect(
            buildCongressTrendCacheKey('AAPL', 'gemini-3.6-flash', 'sk1')
        ).toBe(
            `v1:analysis:congress:AAPL:gemini-3.6-flash:${CONGRESS_PROMPT_TEMPLATE_VERSION}:sk1`
        );
    });
});

describe('buildInvestorFlowsCacheKey', () => {
    const base = `v1:analysis:investorFlows:AAPL:gemini-3.6-flash:${INVESTOR_FLOWS_PROMPT_TEMPLATE_VERSION}`;

    it('is on template version p6 (Korean no-material-change reads neutral)', () => {
        expect(INVESTOR_FLOWS_PROMPT_TEMPLATE_VERSION).toBe('p6');
    });

    it('a squeeze context appends :squeeze=on last; false and omitted match the base key', () => {
        expect(
            buildInvestorFlowsCacheKey(
                'AAPL',
                'gemini-3.6-flash',
                undefined,
                undefined,
                false,
                false,
                true
            )
        ).toBe(`${base}:finra=off:regsho=off:squeeze=on`);
        expect(
            buildInvestorFlowsCacheKey(
                'AAPL',
                'gemini-3.6-flash',
                undefined,
                undefined,
                undefined,
                undefined,
                false
            )
        ).toBe(base);
    });

    it('exchange lists off appends :regsho=off after the FINRA suffix; on and omitted match', () => {
        expect(
            buildInvestorFlowsCacheKey(
                'AAPL',
                'gemini-3.6-flash',
                undefined,
                undefined,
                false,
                false
            )
        ).toBe(`${base}:finra=off:regsho=off`);
        expect(
            buildInvestorFlowsCacheKey(
                'AAPL',
                'gemini-3.6-flash',
                undefined,
                undefined,
                undefined,
                true
            )
        ).toBe(base);
    });

    it('has no skill fingerprint or input hash, so the lookup precedes the snapshot fetch', () => {
        expect(buildInvestorFlowsCacheKey('AAPL', 'gemini-3.6-flash')).toBe(
            base
        );
    });

    it('is scoped by symbol and model', () => {
        expect(buildInvestorFlowsCacheKey('MSFT', 'gemini-3.6-flash')).not.toBe(
            base
        );
        expect(buildInvestorFlowsCacheKey('AAPL', 'gpt-6-luna')).not.toBe(base);
    });

    it('reasoning on appends a suffix; off and omitted match the base key', () => {
        expect(
            buildInvestorFlowsCacheKey('AAPL', 'gemini-3.6-flash', true)
        ).toBe(`${base}:reason=on`);
        expect(
            buildInvestorFlowsCacheKey('AAPL', 'gemini-3.6-flash', false)
        ).toBe(base);
    });

    it('locale: ko matches the base key, other locales append :lang=', () => {
        expect(
            buildInvestorFlowsCacheKey(
                'AAPL',
                'gemini-3.6-flash',
                undefined,
                'ko'
            )
        ).toBe(base);
        expect(
            buildInvestorFlowsCacheKey(
                'AAPL',
                'gemini-3.6-flash',
                undefined,
                'en'
            )
        ).toBe(`${base}:lang=en`);
    });

    it('FINRA off appends :finra=off; on and omitted match the base key', () => {
        const off = buildInvestorFlowsCacheKey(
            'AAPL',
            'gemini-3.6-flash',
            undefined,
            undefined,
            false
        );
        expect(off).toBe(`${base}:finra=off`);
        expect(
            buildInvestorFlowsCacheKey(
                'AAPL',
                'gemini-3.6-flash',
                undefined,
                undefined,
                true
            )
        ).toBe(base);
    });

    it('combines every suffix in a fixed order', () => {
        expect(
            buildInvestorFlowsCacheKey(
                'AAPL',
                'gemini-3.6-flash',
                true,
                'en',
                false
            )
        ).toBe(`${base}:reason=on:lang=en:finra=off`);
    });

    it('caches for 12 hours', () => {
        expect(INVESTOR_FLOWS_CACHE_TTL_SECONDS).toBe(12 * SECONDS_PER_HOUR);
    });
});

describe('computeBarsEffectiveTtl', () => {
    it('개장 중이면 BARS_OPEN_TTL_SECONDS (Mon 10:00 ET)', () => {
        expect(
            computeBarsEffectiveTtl('1Day', new Date('2026-07-06T14:00:00Z'))
        ).toBe(BARS_OPEN_TTL_SECONDS);
    });
    it('개장 중이면 timeframe 무관 동일 (5Min, Mon 10:00 ET)', () => {
        expect(
            computeBarsEffectiveTtl('5Min', new Date('2026-07-06T14:00:00Z'))
        ).toBe(BARS_OPEN_TTL_SECONDS);
    });
    it('장외 + 다음 개장이 24h 이내면 그 시각까지 (Mon 17:00 ET → 59400s)', () => {
        expect(
            computeBarsEffectiveTtl('1Day', new Date('2026-07-06T21:00:00Z'))
        ).toBe(990 * SECONDS_PER_MINUTE);
    });
    it('장외 + 다음 개장이 24h 초과면 24h로 캡 (Sat 14:00 ET)', () => {
        expect(
            computeBarsEffectiveTtl('1Day', new Date('2026-07-04T18:00:00Z'))
        ).toBe(BARS_OFFHOURS_TTL_CEILING_SECONDS);
    });
});

describe('buildMarketNewsDigestCacheKey 함수는', () => {
    it('카테고리·모델·inputHash를 스키마 버전 prefix와 결합한다', () => {
        expect(
            buildMarketNewsDigestCacheKey(
                'crypto',
                'gemini-3.6-flash',
                'abc123'
            )
        ).toBe(
            `${CACHE_KEY_SCHEMA_VERSION}:analysis:market-news:crypto:gemini-3.6-flash:${NEWS_PROMPT_TEMPLATE_VERSION}:abc123`
        );
    });

    it('reasoning=true는 :reason=on suffix를 추가하고, false/생략은 동일 키를 만든다', () => {
        // 추론 on/off는 같은 기사 집합에서도 다이제스트 서술의 깊이를 바꾼다.
        // 키가 갈리지 않으면 먼저 캐시를 채운 쪽이 TTL 동안 반대 모드
        // 호출자의 결과까지 결정한다. `false`/`undefined`가 같은 키인 것은
        // 이 옵션이 생기기 전에 쓰인 엔트리가 계속 히트하게 하기 위함이다.
        const omitted = buildMarketNewsDigestCacheKey(
            'crypto',
            'deepseek-v4.1-flash',
            'abc123'
        );
        const off = buildMarketNewsDigestCacheKey(
            'crypto',
            'deepseek-v4.1-flash',
            'abc123',
            false
        );
        const on = buildMarketNewsDigestCacheKey(
            'crypto',
            'deepseek-v4.1-flash',
            'abc123',
            true
        );

        expect(off).toBe(omitted);
        expect(on).toBe(`${omitted}:reason=on`);
        expect(on).not.toBe(omitted);
    });
});

describe('reasoning 토글이 캐시 키에 반영될 때 (member-reasoning-toggle spec Part A)', () => {
    it('buildAnalysisCacheKey: reasoning=true는 :reason=on suffix를 추가한다', () => {
        const off = buildAnalysisCacheKey('AAPL', '1Day', 'gemini-3.6-flash');
        const on = buildAnalysisCacheKey(
            'AAPL',
            '1Day',
            'gemini-3.6-flash',
            undefined,
            true
        );
        expect(on).toBe(`${off}:reason=on`);
        expect(on).not.toBe(off);
    });

    it('buildAnalysisCacheKey: reasoning=false/undefined는 기존 키와 완전히 동일하다', () => {
        const legacy = buildAnalysisCacheKey(
            'AAPL',
            '1Day',
            'gemini-3.6-flash'
        );
        expect(
            buildAnalysisCacheKey(
                'AAPL',
                '1Day',
                'gemini-3.6-flash',
                undefined,
                false
            )
        ).toBe(legacy);
        expect(
            buildAnalysisCacheKey(
                'AAPL',
                '1Day',
                'gemini-3.6-flash',
                undefined,
                undefined
            )
        ).toBe(legacy);
    });

    it('buildAnalysisCacheKey: skillFingerprint와 reasoning이 함께 있으면 reason suffix가 맨 뒤에 붙는다', () => {
        const key = buildAnalysisCacheKey(
            'AAPL',
            '1Day',
            'gemini-3.6-flash',
            'sk1',
            true
        );
        expect(key).toBe(
            `analysis:AAPL:1Day:gemini-3.6-flash:${PROMPT_TEMPLATE_VERSION}:sk1:reason=on`
        );
    });

    it('buildFundamentalCacheKey: on/off 키가 다르고, off는 기존 키와 동일하다', () => {
        const legacy = buildFundamentalCacheKey(
            'AAPL',
            'gemini-3.1-pro-preview'
        );
        expect(
            buildFundamentalCacheKey(
                'AAPL',
                'gemini-3.1-pro-preview',
                undefined,
                false
            )
        ).toBe(legacy);
        expect(
            buildFundamentalCacheKey(
                'AAPL',
                'gemini-3.1-pro-preview',
                undefined,
                true
            )
        ).toBe(`${legacy}:reason=on`);
    });

    it('buildFinancialsCacheKey: on/off 키가 다르고, off는 기존 키와 동일하다', () => {
        const legacy = buildFinancialsCacheKey(
            'AAPL',
            'gemini-3.6-flash',
            'annual'
        );
        expect(
            buildFinancialsCacheKey(
                'AAPL',
                'gemini-3.6-flash',
                'annual',
                undefined,
                false
            )
        ).toBe(legacy);
        expect(
            buildFinancialsCacheKey(
                'AAPL',
                'gemini-3.6-flash',
                'annual',
                undefined,
                true
            )
        ).toBe(`${legacy}:reason=on`);
    });

    it('buildCongressTrendCacheKey: on/off 키가 다르고, off는 기존 키와 동일하다', () => {
        const legacy = buildCongressTrendCacheKey('AAPL', 'gemini-3.6-flash');
        expect(
            buildCongressTrendCacheKey(
                'AAPL',
                'gemini-3.6-flash',
                undefined,
                false
            )
        ).toBe(legacy);
        expect(
            buildCongressTrendCacheKey(
                'AAPL',
                'gemini-3.6-flash',
                undefined,
                true
            )
        ).toBe(`${legacy}:reason=on`);
    });

    it('buildNewsCacheKey: on/off 키가 다르고, off는 기존 키와 동일하다', () => {
        const legacy = buildNewsCacheKey(
            'AAPL',
            'gemini-3.1-pro-preview',
            'h2'
        );
        expect(
            buildNewsCacheKey('AAPL', 'gemini-3.1-pro-preview', 'h2', false)
        ).toBe(legacy);
        expect(
            buildNewsCacheKey('AAPL', 'gemini-3.1-pro-preview', 'h2', true)
        ).toBe(`${legacy}:reason=on`);
    });

    it('buildOverallCacheKey: on/off 키가 다르고, off는 기존 키와 동일하다', () => {
        const legacy = buildOverallCacheKey(
            'AAPL',
            '5Min',
            'gemini-3.1-pro-preview',
            'h3'
        );
        expect(
            buildOverallCacheKey(
                'AAPL',
                '5Min',
                'gemini-3.1-pro-preview',
                'h3',
                false
            )
        ).toBe(legacy);
        expect(
            buildOverallCacheKey(
                'AAPL',
                '5Min',
                'gemini-3.1-pro-preview',
                'h3',
                true
            )
        ).toBe(`${legacy}:reason=on`);
    });

    it('buildOverallPeekCacheKey: on/off 키가 다르고, off는 기존 키와 동일하다', () => {
        const legacy = buildOverallPeekCacheKey(
            'AAPL',
            '5Min',
            'gemini-3.1-pro-preview'
        );
        expect(
            buildOverallPeekCacheKey(
                'AAPL',
                '5Min',
                'gemini-3.1-pro-preview',
                false
            )
        ).toBe(legacy);
        expect(
            buildOverallPeekCacheKey(
                'AAPL',
                '5Min',
                'gemini-3.1-pro-preview',
                true
            )
        ).toBe(`${legacy}:reason=on`);
    });

    it('buildOptionsCacheKey: on/off 키가 다르고, off는 기존 키와 동일하다', () => {
        const legacy = buildOptionsCacheKey(
            'AAPL',
            '2026-05-22',
            'claude-haiku',
            'abc123'
        );
        expect(
            buildOptionsCacheKey(
                'AAPL',
                '2026-05-22',
                'claude-haiku',
                'abc123',
                false
            )
        ).toBe(legacy);
        expect(
            buildOptionsCacheKey(
                'AAPL',
                '2026-05-22',
                'claude-haiku',
                'abc123',
                true
            )
        ).toBe(`${legacy}:reason=on`);
    });
});

describe('positionBucket이 캐시 키에 반영될 때 (personalized-analysis-by-position-bucket spec, Subsystem C)', () => {
    it('buildAnalysisCacheKey: positionBucket 미지정 시 기존(레거시) 키와 byte-identical하다', () => {
        const legacy = buildAnalysisCacheKey(
            'AAPL',
            '1Day',
            'gemini-3.6-flash'
        );
        expect(legacy).toBe(
            `analysis:AAPL:1Day:gemini-3.6-flash:${PROMPT_TEMPLATE_VERSION}`
        );
        expect(
            buildAnalysisCacheKey(
                'AAPL',
                '1Day',
                'gemini-3.6-flash',
                undefined,
                undefined,
                undefined
            )
        ).toBe(legacy);
    });

    it('buildAnalysisCacheKey: 각 버킷마다 :pos=<bucket> suffix가 붙고 서로 구별된다', () => {
        const legacy = buildAnalysisCacheKey(
            'AAPL',
            '1Day',
            'gemini-3.6-flash'
        );
        const buckets: PositionBucket[] = [
            'deep-profit',
            'profit',
            'near-breakeven',
            'loss',
            'deep-loss',
        ];
        const keys = buckets.map(bucket =>
            buildAnalysisCacheKey(
                'AAPL',
                '1Day',
                'gemini-3.6-flash',
                undefined,
                undefined,
                bucket
            )
        );
        keys.forEach((key, i) => {
            expect(key).toBe(`${legacy}:pos=${buckets[i]}`);
        });
        // All five keys are pairwise distinct (and distinct from the legacy key).
        expect(new Set([legacy, ...keys]).size).toBe(keys.length + 1);
    });

    it('buildAnalysisCacheKey: reasoning과 positionBucket이 함께 있으면 :reason=on 다음에 :pos=<bucket>이 붙는다', () => {
        const key = buildAnalysisCacheKey(
            'AAPL',
            '1Day',
            'gemini-3.6-flash',
            'sk1',
            true,
            'profit'
        );
        expect(key).toBe(
            `analysis:AAPL:1Day:gemini-3.6-flash:${PROMPT_TEMPLATE_VERSION}:sk1:reason=on:pos=profit`
        );
    });

    it('buildAnalysisCacheKey: reasoning 없이 positionBucket만 있으면 :pos=<bucket>만 붙는다', () => {
        const key = buildAnalysisCacheKey(
            'AAPL',
            '1Day',
            'gemini-3.6-flash',
            undefined,
            undefined,
            'deep-loss'
        );
        expect(key).toBe(
            `analysis:AAPL:1Day:gemini-3.6-flash:${PROMPT_TEMPLATE_VERSION}:pos=deep-loss`
        );
    });

    it('PROMPT_TEMPLATE_VERSION은 pure-Korean 규칙 + holder-consistent 재구성으로 p8로 bump되었고, prior-analysis-context 섹션으로 p9로 다시 bump된다, 그리고 봉 타임스탬프 분 단위 통일로 p10이 된다', () => {
        // The hint's *introduction* did not bump the version (it only appended a
        // brand-new `:pos=<bucket>` namespace). p7 reframed the hint to an
        // instructive position-management perspective. p8 ships two more
        // technical-prompt byte changes: (1) the STRICT pure-Hangul (no-한자)
        // output-language rule in buildAnalysisRequest, which changes bytes for
        // EVERY request, and (2) the holder-consistent reframe of
        // formatPositionHintSection (explicit holder opener, management as the
        // primary frame). p9 adds the optional `## Prior Analyses` section
        // (`buildAnalysisPrompt`'s new `priorAnalyses` param) — bytes change
        // only for requests carrying usable history, but the constant has no
        // per-request axis to scope the bump to, so it still cold-starts the
        // fleet. Warm entries carrying the old bytes must be invalidated —
        // hence p9. p10 renders bar timestamps to the minute in both
        // `## Recent Bar Data` and `## Prior Analyses` (previously the latter
        // was sliced to date-only), so a past call now matches the bar row it
        // was made on verbatim instead of forcing the model to count
        // `N bars ago` — a count that cannot be turned back into elapsed time
        // because bar distance skips overnight and weekend gaps. Only the
        // prior-analysis section's bytes actually change (`formatBarRow`
        // already emitted this exact string), so the scope matches p9's:
        // requests carrying usable history. The bump is fleet-wide anyway
        // because the constant has no per-history-presence axis.
        // p11 은 `## Market Events` 섹션을 추가한다 — 이벤트를 실은 요청에서만
        // 바이트가 바뀌지만 상수에 per-request 축이 없어 무효화는 fleet-wide다.
        // p12 는 숫자 렌더링 감사다 — 가격 정밀도·KRX 프레이밍·세션 피벗·R:R 노이즈 바닥이
        // 모든 요청의 바이트를 바꾼다.
        // p13 은 가격을 쓸 수 없는 봉(Yahoo KRX 자리표시 행)을 버린다.
        // p14 는 ## Indicator State (computed) 섹션을 추가하고, riskReward를
        // 결정론적 손익비 줄 + 모델 산문으로 바꾼다(모든 경로에서, 보정 경로뿐 아니라).
        // p15 는 Chart Pattern Candidates(computed) 섹션·Fib/Woodie/DeMark
        // 피벗·Fib ABC 확장·MACD 사이클/Bollinger %B/Volume 배수·SMC 거리
        // 라인을 추가한다(정밀도 2번째 웨이브, spec §A1-A5).
        // p16 은 컨플루언스 신뢰도 문구를 "측정된 우위 없음"으로 바꾸고, 1Day에
        // Short-Term Washout 블록을 추가하며 entryRecommendation 규칙을 고친다.
        // p17 은 washout 진입 판정을 룰 엔진이 내리게 하고, p18 은 뉴스로 인한
        // 하락에서 그 판정을 유보한다. p20 은 차트 오버레이 후보 id를 추가한다.
        // p21 은 모델이 직접 셈하다 틀리던 비교값(MA 간 격차·배열, 대순환 단계, 갭, 되돌림 깊이, 패턴 간격 등)을 계산해 넣는다
        // (spec 2026-09-28-chart-overlays). p19 는 탐지 목록을 넓힌다(캔들 6종·차트 패턴 5종·신호 4종).
        // p22 는 기술적 분석 프롬프트에서 고정 Intent·Guidelines 블록을 유저 프롬프트 머리에서
        // 시스템 메시지(stable) 머리로 옮긴다(문구 변경 없음, 심볼 간 공통 접두사 확대).
        // p23 (UX audit 2026-10-05 §C6): Confluence Assessment에 내부 라벨 비노출 규칙을
        // 추가하고 "rule engine"/"washout"을 이름으로 인용하라던 두 지시를 고쳤다.
        // p24 (spec 2026-10-07): 차트 패턴은 엄격한 작도 자격을 얻은 것만 숫자·Candidate id와
        // 함께 싣고, 나머지 프리스크리너 hit은 "shape hint — not drawable" 한 줄로만 남긴다.
        // p25 (2026-10-08 A/B 후속): 차트 패턴 섹션이 목록을 만드는 과정을 말하지 않고
        // (모델이 "사전 스크리너"·"그리기 검증"을 사용자 문장에 옮겨 적었다), 형태만 닮은
        // 패턴은 "Unconfirmed shape resemblances" 한 줄로 묶는다.
        // p26 (2026-10-08 최종 A/B 후속): 형태 유사 줄 제거, 계산 섹션 서술의
        // 일반 규칙·상태 코드 규칙, 무효화를 넘은 종가(슬랙 없음)가 있는 패턴 제외, 라운딩 극값 위치·곡선 재고정.
        // p27 (2026-10-18): 끝난 C·꺾인 thrust의 목표와 깨진 피보 후보를 빼고, KRW 가격을 호가 단위로 찍는다.
        // p28 (2026-10-18): 넥라인 계열 패턴의 돌파 후 복귀를 `failed breakout`으로 찍는다.
        expect(PROMPT_TEMPLATE_VERSION).toBe('p28');
    });
});

describe('locale이 캐시 키에 반영될 때', () => {
    /**
     * **ko는 접미가 없어야 한다.** `reasoningKeySuffix`와 같은 규약이다 —
     * 이 기능 이전에 쌓인 한국어 캐시와, 로케일을 넘기지 않는 SSR peek이
     * 같은 키를 그대로 맞혀야 한다. 접미가 붙으면 한국어 분석 캐시가
     * 통째로 미스가 되어 전량 재생성된다.
     */
    it('ko와 생략은 완전히 같은 키다', () => {
        const omitted = buildAnalysisCacheKey(
            'AAPL',
            '1Day',
            'gemini-3.6-flash'
        );
        const ko = buildAnalysisCacheKey(
            'AAPL',
            '1Day',
            'gemini-3.6-flash',
            undefined,
            undefined,
            undefined,
            'ko'
        );
        expect(ko).toBe(omitted);
    });

    it.each(['en', 'ja', 'zh'] as const)(
        '%s는 :lang= 접미를 붙인다',
        locale => {
            const base = buildAnalysisCacheKey(
                'AAPL',
                '1Day',
                'gemini-3.6-flash'
            );
            const localized = buildAnalysisCacheKey(
                'AAPL',
                '1Day',
                'gemini-3.6-flash',
                undefined,
                undefined,
                undefined,
                locale
            );
            expect(localized).toBe(`${base}:lang=${locale}`);
        }
    );

    /** 언어가 다르면 산출물이 다르므로 캐시를 공유하면 안 된다. */
    it('로케일이 다르면 키가 서로 다르다', () => {
        const keys = (['ko', 'en', 'ja', 'zh'] as const).map(locale =>
            buildAnalysisCacheKey(
                'AAPL',
                '1Day',
                'gemini-3.6-flash',
                undefined,
                undefined,
                undefined,
                locale
            )
        );
        expect(new Set(keys).size).toBe(keys.length);
    });

    /** reasoning 접미 **뒤**에 온다 — 순서가 흔들리면 같은 조합이 두 키가 된다. */
    it('reasoning과 함께 쓰면 reason=on 뒤에 붙는다', () => {
        const both = buildAnalysisCacheKey(
            'AAPL',
            '1Day',
            'gemini-3.6-flash',
            undefined,
            true,
            undefined,
            'en'
        );
        expect(both.endsWith(':reason=on:lang=en')).toBe(true);
    });

    /**
     * options 키만 이 규약을 빠뜨렸다가 리뷰에서 잡혔다(PR #184). 형제 빌더가
     * 여덟이라 하나를 놓쳐도 tsc가 잡아주지 않는다 — 각 빌더를 직접 고정한다.
     */
    it('options 키도 로케일을 가른다', () => {
        const base = buildOptionsCacheKey('AAPL', '2026-01-16', 'm', 'h');
        const en = buildOptionsCacheKey(
            'AAPL',
            '2026-01-16',
            'm',
            'h',
            undefined,
            'en'
        );
        expect(en).toBe(`${base}:lang=en`);
    });

    /**
     * 형제 빌더가 아홉이라 하나를 놓쳐도 tsc가 잡아주지 않는다 — 실제로
     * options 키를 빠뜨렸다가 리뷰에서 잡혔다. **각각을 직접 고정한다.**
     */
    it('나머지 분석 키도 전부 로케일을 가른다', () => {
        const cases: Array<[string, string]> = [
            [
                buildFundamentalCacheKey('AAPL', 'm', 'f'),
                buildFundamentalCacheKey('AAPL', 'm', 'f', undefined, 'en'),
            ],
            [
                buildFinancialsCacheKey('AAPL', 'm', 'annual', 'f'),
                buildFinancialsCacheKey(
                    'AAPL',
                    'm',
                    'annual',
                    'f',
                    undefined,
                    'en'
                ),
            ],
            [
                buildCongressTrendCacheKey('AAPL', 'm', 'f'),
                buildCongressTrendCacheKey('AAPL', 'm', 'f', undefined, 'en'),
            ],
            [
                buildMarketNewsDigestCacheKey('crypto', 'm', 'h'),
                buildMarketNewsDigestCacheKey(
                    'crypto',
                    'm',
                    'h',
                    undefined,
                    'en'
                ),
            ],
            [
                buildNewsCacheKey('AAPL', 'm', 'h'),
                buildNewsCacheKey('AAPL', 'm', 'h', undefined, 'en'),
            ],
            [
                buildOverallCacheKey('AAPL', '1Day', 'm', 'h'),
                buildOverallCacheKey('AAPL', '1Day', 'm', 'h', undefined, 'en'),
            ],
        ];
        for (const [base, localized] of cases) {
            expect(localized).toBe(`${base}:lang=en`);
        }
    });

    it('overall peek 키도 로케일을 가른다', () => {
        const base = buildOverallPeekCacheKey('AAPL', '1Day', 'm');
        const ja = buildOverallPeekCacheKey(
            'AAPL',
            '1Day',
            'm',
            undefined,
            'ja'
        );
        expect(ja).toBe(`${base}:lang=ja`);
    });
});

describe('narrowPriorAnalysesForCacheKey (prior-analysis-context, Task 5a)', () => {
    const WINDOW_SECONDS = 300; // 5 minutes, arbitrary but representative of ANALYSIS_CACHE_TTL['5Min']
    // A bucket edge for a 300s window (00:10:00 is a multiple of 5 minutes),
    // so the anchored bucket start below equals NOW_MS itself.
    const NOW_MS = Date.parse('2026-01-01T00:10:00.000Z');
    const windowStartMs = priorAnalysisWindowStartMs(
        WINDOW_SECONDS,
        new Date(NOW_MS)
    );

    it('cutoff에 정확히 걸친 항목은 제외되고, 바로 바깥(더 과거) 항목은 포함된다', () => {
        const now = new Date(NOW_MS);
        const atCutoff = priorAnalysisAt(new Date(windowStartMs));
        const justOutside = priorAnalysisAt(new Date(windowStartMs - 1));

        const { candidates } = narrowPriorAnalysesForCacheKey(
            [atCutoff, justOutside],
            WINDOW_SECONDS,
            now
        );

        expect(candidates).toEqual([justOutside]);
    });

    it(`생존자를 PRIOR_ANALYSIS_LIMIT * PRIOR_ANALYSIS_SLACK(${PRIOR_ANALYSIS_LIMIT * PRIOR_ANALYSIS_SLACK})개로 캡핑한다`, () => {
        const now = new Date(NOW_MS);
        const cap = PRIOR_ANALYSIS_LIMIT * PRIOR_ANALYSIS_SLACK;
        const entries = Array.from({ length: cap + 5 }, (_, i) =>
            priorAnalysisAt(new Date(windowStartMs - 1000 * (i + 1)))
        );

        const { candidates } = narrowPriorAnalysesForCacheKey(
            entries,
            WINDOW_SECONDS,
            now
        );

        expect(candidates).toHaveLength(cap);
    });

    it('생존자를 newest-first로 정렬한다', () => {
        const now = new Date(NOW_MS);
        const older = priorAnalysisAt(new Date(windowStartMs - 5000));
        const newer = priorAnalysisAt(new Date(windowStartMs - 1000));

        const { candidates } = narrowPriorAnalysesForCacheKey(
            [older, newer],
            WINDOW_SECONDS,
            now
        );

        expect(candidates).toEqual([newer, older]);
    });

    it('빈 입력이면 fingerprint가 undefined다', () => {
        const { candidates, fingerprint } = narrowPriorAnalysesForCacheKey(
            [],
            WINDOW_SECONDS,
            new Date(NOW_MS)
        );

        expect(candidates).toEqual([]);
        expect(fingerprint).toBeUndefined();
    });

    it('전부 현재 윈도우 안이면(생존자 0명) fingerprint가 undefined다', () => {
        const now = new Date(NOW_MS);
        const insideWindow = priorAnalysisAt(new Date(windowStartMs + 1000));

        const { candidates, fingerprint } = narrowPriorAnalysesForCacheKey(
            [insideWindow],
            WINDOW_SECONDS,
            now
        );

        expect(candidates).toEqual([]);
        expect(fingerprint).toBeUndefined();
    });

    it('같은 윈도우 내에서 now가 이동해도(경계를 넘지 않으면) fingerprint는 그대로다', () => {
        const farPast = priorAnalysisAt(new Date(NOW_MS - 10_000_000));
        const now1 = new Date(NOW_MS);
        const now2 = new Date(NOW_MS + 1000);

        const r1 = narrowPriorAnalysesForCacheKey(
            [farPast],
            WINDOW_SECONDS,
            now1
        );
        const r2 = narrowPriorAnalysesForCacheKey(
            [farPast],
            WINDOW_SECONDS,
            now2
        );

        expect(r1.fingerprint).toBeDefined();
        expect(r2.fingerprint).toBe(r1.fingerprint);
    });

    // Anchored bucket, not a rolling `now - window`: a row inside the current
    // bucket stays excluded for the ENTIRE bucket, even past the point where a
    // rolling boundary would have aged it in — it only becomes a survivor once
    // the bucket edge itself moves past it.
    it('버킷 경계 전까지는(버킷 중간에서도) 생존자 집합이 그대로다가, 다음 버킷 경계에서만 바뀐다', () => {
        const entry = priorAnalysisAt(new Date(windowStartMs + 50 * 1000));

        // At the bucket start — entry is inside the bucket, excluded.
        const r1 = narrowPriorAnalysesForCacheKey(
            [entry],
            WINDOW_SECONDS,
            new Date(NOW_MS)
        );
        expect(r1.fingerprint).toBeUndefined();

        // Half the window later — still the SAME bucket. Under the old rolling
        // design this is exactly where the row would have aged in; the
        // anchored bucket has not moved, so the fingerprint is unchanged.
        const midBucket = new Date(NOW_MS + (WINDOW_SECONDS * 1000) / 2);
        const r2 = narrowPriorAnalysesForCacheKey(
            [entry],
            WINDOW_SECONDS,
            midBucket
        );
        expect(r2.fingerprint).toBe(r1.fingerprint);

        // The next bucket edge — the window boundary itself moves past
        // `entry.generatedAt`, so it now qualifies as a survivor.
        const nextEdge = new Date(NOW_MS + WINDOW_SECONDS * 1000);
        const r3 = narrowPriorAnalysesForCacheKey(
            [entry],
            WINDOW_SECONDS,
            nextEdge
        );
        expect(r3.fingerprint).toBeDefined();
        expect(r3.fingerprint).not.toBe(r1.fingerprint);
    });
});

describe('priorAnalysisWindowStartMs (anchored cache bucket)', () => {
    it('1Day 버킷은 now 기준 가장 최근의 UTC 20:00(KST 05:00)에서 시작한다', () => {
        const startMs = priorAnalysisWindowStartMs(
            SECONDS_PER_DAY,
            new Date('2026-09-29T21:00:00.000Z')
        );
        expect(new Date(startMs).toISOString()).toBe(
            '2026-09-29T20:00:00.000Z'
        );
    });

    it('1Day 버킷: 다음날 UTC 20:00 직전까지는 같은 버킷 시작을 유지한다', () => {
        const startMs = priorAnalysisWindowStartMs(
            SECONDS_PER_DAY,
            new Date('2026-09-30T19:59:59.999Z')
        );
        expect(new Date(startMs).toISOString()).toBe(
            '2026-09-29T20:00:00.000Z'
        );
    });

    it('15Min 버킷은 :00/:15/:30/:45에 정렬된다', () => {
        const cases: [string, string][] = [
            ['2026-09-29T13:07:00.000Z', '2026-09-29T13:00:00.000Z'],
            ['2026-09-29T13:16:00.000Z', '2026-09-29T13:15:00.000Z'],
            ['2026-09-29T13:31:00.000Z', '2026-09-29T13:30:00.000Z'],
            ['2026-09-29T13:59:00.000Z', '2026-09-29T13:45:00.000Z'],
        ];
        for (const [now, expected] of cases) {
            const startMs = priorAnalysisWindowStartMs(
                15 * SECONDS_PER_MINUTE,
                new Date(now)
            );
            expect(new Date(startMs).toISOString()).toBe(expected);
        }
    });

    it('now가 정확히 버킷 경계면 자기 자신이 버킷 시작이다', () => {
        const boundary = '2026-09-29T13:15:00.000Z';
        const startMs = priorAnalysisWindowStartMs(
            15 * SECONDS_PER_MINUTE,
            new Date(boundary)
        );
        expect(new Date(startMs).toISOString()).toBe(boundary);

        const dayBoundary = '2026-09-29T20:00:00.000Z';
        const dayStartMs = priorAnalysisWindowStartMs(
            SECONDS_PER_DAY,
            new Date(dayBoundary)
        );
        expect(new Date(dayStartMs).toISOString()).toBe(dayBoundary);
    });
});

describe('priorAnalysisWindowStartMs (session-aware day bucket)', () => {
    const startIso = (
        windowSeconds: number,
        now: string,
        session?: Parameters<typeof priorAnalysisWindowStartMs>[2]
    ) =>
        new Date(
            priorAnalysisWindowStartMs(windowSeconds, new Date(now), session)
        ).toISOString();

    it('KRX 1Day: 마감 후 저녁에는 오늘 16:00 KST(마감+버퍼)에서 시작한다', () => {
        expect(
            startIso(
                SECONDS_PER_DAY,
                '2026-09-29T10:00:00.000Z',
                makeKrSession()
            )
        ).toBe('2026-09-29T07:00:00.000Z');
    });

    it('KRX 1Day: KST 05:00을 넘어도 버킷이 그대로다 — 같은 마감 세션', () => {
        const kr = makeKrSession();
        const evening = startIso(
            SECONDS_PER_DAY,
            '2026-09-29T10:00:00.000Z',
            kr
        );
        const nextMorning = startIso(
            SECONDS_PER_DAY,
            '2026-09-29T21:30:00.000Z',
            kr
        );
        expect(nextMorning).toBe(evening);
        // 세션 없이는 KST 05:00(UTC 20:00)에서 버킷이 굴러간다 — 수정 전 동작.
        expect(startIso(SECONDS_PER_DAY, '2026-09-29T21:30:00.000Z')).toBe(
            '2026-09-29T20:00:00.000Z'
        );
    });

    it('US 1Day: 직전 마감 + 30분', () => {
        expect(
            startIso(
                SECONDS_PER_DAY,
                '2026-09-29T21:00:00.000Z',
                US_EQUITY_SESSION
            )
        ).toBe('2026-09-29T20:30:00.000Z');
    });

    it('crypto 1Day: 최근 UTC 자정', () => {
        expect(
            startIso(
                SECONDS_PER_DAY,
                '2026-09-29T21:00:00.000Z',
                CRYPTO_SESSION
            )
        ).toBe('2026-09-29T00:00:00.000Z');
    });

    it('하루보다 짧은 윈도우는 세션과 무관하게 시계 정렬 버킷을 쓴다', () => {
        expect(
            startIso(
                15 * SECONDS_PER_MINUTE,
                '2026-09-29T13:07:00.000Z',
                makeKrSession()
            )
        ).toBe('2026-09-29T13:00:00.000Z');
    });

    it('거래일이 없는 잘못된 스펙은 기존 앵커 버킷으로 폴백한다', () => {
        const never = { ...makeKrSession(), closeMinuteFor: () => 0 };
        expect(
            startIso(SECONDS_PER_DAY, '2026-09-29T21:00:00.000Z', never)
        ).toBe('2026-09-29T20:00:00.000Z');
    });

    it('narrow: 마감 후 저녁에 쓴 행은 다음 날 아침에도 키에 들어오지 않는다', () => {
        const kr = makeKrSession();
        const history = [
            priorAnalysisAt(new Date('2026-09-28T10:00:00.000Z')),
            priorAnalysisAt(new Date('2026-09-29T10:30:00.000Z')),
        ];
        const evening = narrowPriorAnalysesForCacheKey(
            history,
            SECONDS_PER_DAY,
            new Date('2026-09-29T11:00:00.000Z'),
            kr
        );
        const nextMorning = narrowPriorAnalysesForCacheKey(
            history,
            SECONDS_PER_DAY,
            new Date('2026-09-29T21:30:00.000Z'),
            kr
        );
        expect(nextMorning.fingerprint).toBe(evening.fingerprint);
        expect(nextMorning.candidates).toHaveLength(1);
    });

    it('analysisHistoryQuery는 같은 세션 경계를 generatedBeforeMs로 돌려준다', () => {
        const now = new Date('2026-09-29T21:30:00.000Z');
        const kr = makeKrSession();
        expect(
            analysisHistoryQuery('1Day', 'technical', now, kr).generatedBeforeMs
        ).toBe(Date.parse('2026-09-29T07:00:00.000Z'));
        expect(
            analysisHistoryQuery('15Min', 'overall', now, kr).generatedBeforeMs
        ).toBe(Date.parse('2026-09-29T07:00:00.000Z'));
        // 인트라데이 technical은 시계 버킷 그대로.
        expect(
            analysisHistoryQuery('15Min', 'technical', now, kr)
                .generatedBeforeMs
        ).toBe(Date.parse('2026-09-29T21:30:00.000Z'));
    });
});

describe('historyFingerprint이 캐시 키에 반영될 때 (prior-analysis-context, Task 5b)', () => {
    it('historyFingerprint 생략 시 기존 키와 byte-identical하다', () => {
        const legacy = buildAnalysisCacheKey(
            'AAPL',
            '1Day',
            'gemini-3.6-flash'
        );
        const omitted = buildAnalysisCacheKey(
            'AAPL',
            '1Day',
            'gemini-3.6-flash',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined
        );
        expect(omitted).toBe(legacy);
    });

    it('historyFingerprint은 locale suffix 뒤(맨 끝)에 붙는다', () => {
        const base = buildAnalysisCacheKey(
            'AAPL',
            '1Day',
            'gemini-3.6-flash',
            undefined,
            true,
            'profit',
            'en'
        );
        const historied = buildAnalysisCacheKey(
            'AAPL',
            '1Day',
            'gemini-3.6-flash',
            undefined,
            true,
            'profit',
            'en',
            'fp1'
        );
        expect(historied).toBe(`${base}:hist=fp1`);
    });
});

describe('analysisHistoryQuery', () => {
    const HOUR_MS = 60 * 60 * 1000;
    const DAY_MS = 24 * HOUR_MS;

    /**
     * Real market gaps the window must clear. These are measured from a
     * session's 16:00 ET close to the next session's 09:30 ET open, which is
     * what actually decides whether the prior session's closing analysis
     * survives the consumer's `WHERE` clause.
     */
    const OVERNIGHT_GAP_MS = 17.583 * HOUR_MS; // Fri→Mon excluded: plain weeknight
    const WEEKEND_GAP_MS = 65.5 * HOUR_MS; // Friday close → Monday open
    const LONG_WEEKEND_GAP_MS = 89.5 * HOUR_MS; // holiday Monday → Tuesday open

    // These assertions deliberately do NOT recompute the implementation's
    // formula from the same constants — that pins whatever the code currently
    // does, including a wrong sizing, and passes regardless. They assert
    // against independently measured market gaps instead.

    it('every intraday timeframe clears a long-weekend gap', () => {
        // The failure this guards is silent and weekly: if the window is
        // shorter than the gap, the consumer's own SQL drops the prior
        // session's analyses and `selectPriorAnalyses` never sees them, so the
        // feature renders nothing all day every Monday with no error anywhere.
        for (const tf of [
            '5Min',
            '15Min',
            '30Min',
            '1Hour',
            '4Hour',
        ] as const) {
            expect(analysisHistoryQuery(tf).sinceMs).toBeGreaterThan(
                LONG_WEEKEND_GAP_MS
            );
        }
    });

    it('5Min clears the single-overnight case its own rationale cites', () => {
        // 16:00 ET → 09:35 ET is 17h35m, not the looser 17.5h a previous
        // revision asserted; the implementation used to clear that looser
        // bound by 1ms and fail this one.
        expect(analysisHistoryQuery('5Min').sinceMs).toBeGreaterThan(
            OVERNIGHT_GAP_MS
        );
        expect(analysisHistoryQuery('5Min').sinceMs).toBeGreaterThan(
            WEEKEND_GAP_MS
        );
    });

    it('1Day covers 21 trading days — about 30 calendar days plus holidays', () => {
        expect(analysisHistoryQuery('1Day').sinceMs).toBeGreaterThan(
            32 * DAY_MS
        );
    });

    it('윈도우는 봉이 길수록 단조 증가한다', () => {
        const windows = (
            ['5Min', '15Min', '30Min', '1Hour', '4Hour', '1Day'] as const
        ).map(tf => analysisHistoryQuery(tf).sinceMs);

        for (let i = 1; i < windows.length; i++) {
            expect(windows[i]).toBeGreaterThan(windows[i - 1]);
        }
    });

    it('limit은 두 좁히기 단계가 쓰는 21건 캡과 같다', () => {
        expect(analysisHistoryQuery('1Day').limit).toBe(
            PRIOR_ANALYSIS_LIMIT * PRIOR_ANALYSIS_SLACK
        );
    });

    it('캐시 TTL 기반 사이징으로 되돌아가지 않는다 (회귀 가드)', () => {
        // The original bug: sizing from ANALYSIS_CACHE_TTL gave 5Min a
        // 1.75-hour window. Any future edit reintroducing a clock-time window
        // fails here.
        const cap = PRIOR_ANALYSIS_LIMIT * PRIOR_ANALYSIS_SLACK;
        expect(analysisHistoryQuery('5Min').sinceMs).not.toBe(
            ANALYSIS_CACHE_TTL['5Min'] * cap * 1000
        );
    });

    describe('generatedBeforeMs (anchored current cache bucket)', () => {
        it('technical 축 기본값: 1Day는 UTC 20:00, 15Min은 15분 정렬 버킷 시작이다', () => {
            expect(
                analysisHistoryQuery(
                    '1Day',
                    'technical',
                    new Date('2026-09-29T21:00:00.000Z')
                ).generatedBeforeMs
            ).toBe(Date.parse('2026-09-29T20:00:00.000Z'));
            expect(
                analysisHistoryQuery(
                    '15Min',
                    'technical',
                    new Date('2026-09-29T13:07:00.000Z')
                ).generatedBeforeMs
            ).toBe(Date.parse('2026-09-29T13:00:00.000Z'));
        });

        it('overall 축은 고정된 OVERALL_CACHE_TTL_SECONDS(1일) 윈도우의 버킷 시작을 쓴다', () => {
            expect(
                analysisHistoryQuery(
                    '15Min',
                    'overall',
                    new Date('2026-09-29T21:00:00.000Z')
                ).generatedBeforeMs
            ).toBe(Date.parse('2026-09-29T20:00:00.000Z'));
        });

        // Regression (PLTR 1Day, 2026-09-29): with `ORDER BY generated_at DESC
        // LIMIT limit` applied before the window filter, each fresh generation
        // evicted the oldest in-key row and changed the `:hist=` fingerprint,
        // so every request missed. Excluding the bucket in the query keeps the
        // fingerprint stable across new in-bucket generations.
        it('keeps the history fingerprint stable when a new in-bucket row is inserted', () => {
            const now = new Date('2026-09-29T16:00:00Z');
            const { limit, generatedBeforeMs } = analysisHistoryQuery(
                '1Day',
                'technical',
                now
            );
            const bucketAgeMs = now.getTime() - generatedBeforeMs;
            const at = (msAgo: number) => ({
                generatedAt: new Date(now.getTime() - msAgo),
            });
            // 24 rows older than the bucket start + `limit - 3` rows inside the
            // current bucket, so the old query's LIMIT still lets 3
            // out-of-bucket rows into the key — the production shape where the
            // churn started.
            const old = Array.from({ length: 24 }, (_, i) =>
                at(bucketAgeMs + (i + 1) * HOUR_MS)
            );
            const inBucket = Array.from({ length: limit - 3 }, (_, i) =>
                at((i + 1) * 60 * 1000)
            );
            const newest = at(1000);
            const query = (
                rows: { generatedAt: Date }[],
                excludeBucket: boolean
            ) =>
                rows
                    .filter(
                        r =>
                            !excludeBucket ||
                            r.generatedAt.getTime() < generatedBeforeMs
                    )
                    .toSorted(
                        (a, b) =>
                            b.generatedAt.getTime() - a.generatedAt.getTime()
                    )
                    .slice(0, limit)
                    .map(r => ({ ...r }) as never);
            const fp = (
                rows: { generatedAt: Date }[],
                excludeBucket: boolean
            ) =>
                narrowPriorAnalysesForCacheKey(
                    query(rows, excludeBucket),
                    ANALYSIS_CACHE_TTL['1Day'],
                    now
                ).fingerprint;

            const before = [...old, ...inBucket];
            const after = [...before, newest];
            // Old query shape: the new row displaces an older one → key churns.
            expect(fp(after, false)).not.toBe(fp(before, false));
            // Bucket excluded in the query: the key survives the new row.
            expect(fp(after, true)).toBe(fp(before, true));
            expect(fp(after, true)).toBeDefined();
        });
    });
});

describe('marketEvents가 캐시 키에 반영될 때', () => {
    const AT = Date.parse('2026-09-04T14:30:00Z');
    const event = (
        offsetMs: number,
        impact: 'high' | 'medium' | 'low' = 'high'
    ) => ({
        publishedAt: new Date(AT + offsetMs),
        category: 'earnings' as const,
        sentiment: 'bullish' as const,
        impact,
    });

    it('이벤트가 없으면 fingerprint가 undefined이고 키는 이 기능 도입 전과 같다', () => {
        const { candidates, fingerprint } = narrowMarketEventsForCacheKey([]);

        expect(candidates).toEqual([]);
        expect(fingerprint).toBeUndefined();
        expect(
            buildAnalysisCacheKey(
                'NVDA',
                '15Min',
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                fingerprint
            )
        ).toBe(buildAnalysisCacheKey('NVDA', '15Min'));
    });

    it('low / negligible 만 있으면 fingerprint가 생기지 않는다', () => {
        const { fingerprint } = narrowMarketEventsForCacheKey([
            event(0, 'low'),
        ]);
        expect(fingerprint).toBeUndefined();
    });

    it('이벤트가 있으면 `:evt=` 세그먼트가 붙는다', () => {
        const { fingerprint } = narrowMarketEventsForCacheKey([event(0)]);

        expect(fingerprint).toBeDefined();
        expect(
            buildAnalysisCacheKey(
                'NVDA',
                '15Min',
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                fingerprint
            )
        ).toContain(`:evt=${fingerprint}`);
    });

    it('같은 집합은 입력 순서가 달라도 같은 fingerprint를 낸다', () => {
        // 순서로 캐시가 쪼개지면 같은 화면을 보는 두 요청이 캐시를 공유하지 못한다.
        const a = narrowMarketEventsForCacheKey([
            event(0),
            event(900_000),
        ]).fingerprint;
        const b = narrowMarketEventsForCacheKey([
            event(900_000),
            event(0),
        ]).fingerprint;

        expect(a).toBe(b);
    });

    it('오래된 이벤트가 아무리 많아도 stage 1 후보는 상한에서 멈춘다', () => {
        // 상한이 없으면 consumer가 수년치를 넘길 때 fingerprint 입력이 무한정
        // 커지고, 렌더 윈도우 밖의 옛 이벤트가 바뀔 때마다 캐시가 무효화된다.
        const many = Array.from({ length: 50 }, (_, i) => event(i * 900_000));

        const { candidates } = narrowMarketEventsForCacheKey(many);

        expect(candidates).toHaveLength(MARKET_EVENT_CACHE_KEY_CAP);
        // 상한은 렌더 상한보다 넓어야 stage 2 가 고를 수 있는 집합을 덮는다.
        expect(MARKET_EVENT_CACHE_KEY_CAP).toBeGreaterThan(MARKET_EVENT_LIMIT);
    });

    it('상한 밖의 오래된 이벤트가 바뀌어도 fingerprint는 그대로다', () => {
        const recent = Array.from({ length: 25 }, (_, i) => event(i * 900_000));
        const withAncient = [...recent, event(-99 * 900_000)];

        expect(narrowMarketEventsForCacheKey(withAncient).fingerprint).toBe(
            narrowMarketEventsForCacheKey(recent).fingerprint
        );
    });

    it('상한을 넘겨도 오래된 high 이벤트가 최신 medium 들에 밀려나지 않는다', () => {
        // 두 단계가 서로 다른 기준으로 자르면 여기서 조용히 깨진다.
        // stage 1 이 최신순으로만 자르면 유일한 high 가 20개의 fresher medium
        // 뒤로 밀려 사라지고, stage 2 는 그 high 를 볼 기회조차 없다 —
        // "가격을 움직인 이벤트를 싣는다"는 이 기능의 목적이 정면으로 깨진다.
        const freshMediums = Array.from({ length: 25 }, (_, i) =>
            event(i * 900_000, 'medium')
        );
        const loneOldHigh = event(-50 * 900_000, 'high');

        const { candidates } = narrowMarketEventsForCacheKey([
            ...freshMediums,
            loneOldHigh,
        ]);

        expect(candidates).toHaveLength(MARKET_EVENT_CACHE_KEY_CAP);
        expect(candidates[0].impact).toBe('high');
        expect(candidates[0].publishedAt).toEqual(loneOldHigh.publishedAt);
    });

    it('같은 기사가 재분류되면 fingerprint가 갈린다', () => {
        // 뉴스는 나중에 다시 분류될 수 있고, 그때 `publishedAt`은 그대로인 채
        // impact/sentiment/category 만 바뀐다. 시각만 해시하면 캐시 키가 그대로라
        // 렌더된 문구가 TTL 끝까지 옛 분류를 보여 준다.
        const before = narrowMarketEventsForCacheKey([
            event(0, 'high'),
        ]).fingerprint;
        const afterImpact = narrowMarketEventsForCacheKey([
            event(0, 'medium'),
        ]).fingerprint;

        expect(afterImpact).not.toBe(before);

        const base = event(0, 'high');
        const afterSentiment = narrowMarketEventsForCacheKey([
            { ...base, sentiment: 'bearish' as const },
        ]).fingerprint;
        const afterCategory = narrowMarketEventsForCacheKey([
            { ...base, category: 'regulation' as const },
        ]).fingerprint;

        expect(afterSentiment).not.toBe(before);
        expect(afterCategory).not.toBe(before);
    });

    it('집합이 다르면 fingerprint가 갈린다', () => {
        const a = narrowMarketEventsForCacheKey([event(0)]).fingerprint;
        const b = narrowMarketEventsForCacheKey([event(900_000)]).fingerprint;

        expect(a).not.toBe(b);
    });
});

describe('marketEvents 시간 상한이 캐시 키에 반영될 때', () => {
    const SATURDAY = new Date('2026-10-03T15:00:00Z');
    const SUNDAY = new Date('2026-10-04T15:00:00Z');
    // 토·일 호출의 마지막 봉은 금요일(10-02) 스탬프, 상한은 토요일 00:00Z(배타).
    const FRIDAY_HORIZON = Date.parse('2026-10-03T00:00:00Z');
    const eventAt = (ms: number, impact: 'high' | 'medium' = 'high') => ({
        publishedAt: new Date(ms),
        category: 'earnings' as const,
        sentiment: 'bearish' as const,
        impact,
    });
    const friday = eventAt(Date.parse('2026-10-02T14:00:00Z'));
    const horizonFor = (now: Date) =>
        marketEventHorizonMs('1Day', US_EQUITY_SESSION, now);

    it('상한 뒤에 발행된 이벤트는 fingerprint를 바꾸지 않는다', () => {
        const weekend = eventAt(Date.parse('2026-10-03T14:00:00Z'));
        const horizon = horizonFor(SATURDAY);

        expect(
            narrowMarketEventsForCacheKey([friday, weekend], horizon)
                .fingerprint
        ).toBe(narrowMarketEventsForCacheKey([friday], horizon).fingerprint);
    });

    it('상한 직전 이벤트는 fingerprint를 바꾸고, 상한 시각 이벤트는 바꾸지 않는다(배타)', () => {
        const justBefore = eventAt(FRIDAY_HORIZON - 1, 'medium');
        const atHorizon = eventAt(FRIDAY_HORIZON, 'medium');
        const horizon = horizonFor(SATURDAY);
        const base = narrowMarketEventsForCacheKey([friday], horizon);

        expect(horizon).toBe(FRIDAY_HORIZON);
        expect(
            narrowMarketEventsForCacheKey([friday, justBefore], horizon)
                .fingerprint
        ).not.toBe(base.fingerprint);
        expect(
            narrowMarketEventsForCacheKey([friday, atHorizon], horizon)
                .fingerprint
        ).toBe(base.fingerprint);
    });

    it('토요일·일요일 호출은 주말 이벤트를 무시한다', () => {
        const weekendEvents = [
            eventAt(Date.parse('2026-10-03T02:00:00Z')),
            eventAt(Date.parse('2026-10-04T09:00:00Z'), 'medium'),
        ];
        for (const now of [SATURDAY, SUNDAY]) {
            const horizon = horizonFor(now);
            expect(
                narrowMarketEventsForCacheKey(
                    [friday, ...weekendEvents],
                    horizon
                ).fingerprint
            ).toBe(
                narrowMarketEventsForCacheKey([friday], horizon).fingerprint
            );
        }
    });

    it('상한 밖 이벤트만 있으면 fingerprint가 생기지 않는다', () => {
        const { candidates, fingerprint } = narrowMarketEventsForCacheKey(
            [eventAt(Date.parse('2026-10-04T09:00:00Z'))],
            horizonFor(SUNDAY)
        );

        expect(candidates).toEqual([]);
        expect(fingerprint).toBeUndefined();
    });

    it('상한은 상한 20개 컷보다 먼저 적용된다 — 상한 밖 high가 후보 자리를 차지하지 않는다', () => {
        const outside = Array.from({ length: 5 }, (_, i) =>
            eventAt(FRIDAY_HORIZON + (i + 1) * 3_600_000)
        );
        const inside = Array.from(
            { length: MARKET_EVENT_CACHE_KEY_CAP },
            (_, i) =>
                eventAt(
                    Date.parse('2026-10-02T00:00:00Z') + i * 60_000,
                    'medium'
                )
        );

        const { candidates } = narrowMarketEventsForCacheKey(
            [...outside, ...inside],
            horizonFor(SATURDAY)
        );

        expect(candidates).toHaveLength(MARKET_EVENT_CACHE_KEY_CAP);
        expect(
            candidates.every(
                entry => entry.publishedAt.getTime() < FRIDAY_HORIZON
            )
        ).toBe(true);
    });

    it('상한을 넘기지 않으면(null) 기존 fingerprint와 바이트 단위로 같다', () => {
        const later = eventAt(Date.parse('2026-10-04T09:00:00Z'));

        expect(
            narrowMarketEventsForCacheKey([friday, later], null).fingerprint
        ).toBe(narrowMarketEventsForCacheKey([friday, later]).fingerprint);
        // 상한 도입 전 구현이 낸 값을 그대로 고정한 fixture — 해시 입력 형식이 바뀌면 깨진다.
        expect(narrowMarketEventsForCacheKey([friday]).fingerprint).toBe(
            'e3c3110e6da37bfe'
        );
    });
});
