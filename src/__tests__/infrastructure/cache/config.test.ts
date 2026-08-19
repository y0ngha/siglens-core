import {
    SECONDS_PER_DAY,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE,
} from '@/domain/constants/time';
import {
    MARKET_BRIEFING_PROMPT_TEMPLATE_VERSION,
    ANALYSIS_CACHE_TTL,
    BARS_OFFHOURS_TTL_CEILING_SECONDS,
    BARS_OPEN_TTL_SECONDS,
    buildAnalysisCacheKey,
    buildBriefingCacheKey,
    buildCongressTrendCacheKey,
    buildMacroBriefingCacheKey,
    buildFinancialsCacheKey,
    buildFundamentalCacheKey,
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
    MARKET_BRIEFING_CACHE_TTL,
    NEWS_CACHE_TTL_SECONDS,
    NEWS_PROMPT_TEMPLATE_VERSION,
    OVERALL_CACHE_TTL_SECONDS,
    PROMPT_TEMPLATE_VERSION,
    SECTOR_SIGNALS_1HOUR_TTL_MINUTES,
    SECTOR_SIGNALS_15MIN_TTL_MINUTES,
    SECTOR_SIGNALS_TTL_BY_TIMEFRAME,
} from '@/infrastructure/cache/config';
import { ISO_DATE_HOUR_PREFIX_LENGTH } from '@/domain/constants/format';
import type { PositionBucket } from '@/domain/types';
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
    it('buildAnalysisCacheKey includes model identifier and prompt-template version', () => {
        expect(buildAnalysisCacheKey('AAPL', '1Hour', 'gemini-2.5-flash')).toBe(
            `analysis:AAPL:1Hour:gemini-2.5-flash:${PROMPT_TEMPLATE_VERSION}`
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

    it('buildMacroBriefingCacheKey uses the briefing:macro: namespace with the dateHour, model, and input hash', () => {
        expect(
            buildMacroBriefingCacheKey('2026-06-16T09', 'test-model', 'abc123')
        ).toBe('briefing:macro:2026-06-16T09:test-model:abc123');
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
        const a = buildFundamentalCacheKey('AAPL', 'gemini-2.5-pro');
        expect(a).toBe(
            `${CACHE_KEY_SCHEMA_VERSION}:analysis:fundamental:AAPL:gemini-2.5-pro:${PROMPT_TEMPLATE_VERSION}`
        );
    });

    it('buildNewsCacheKey same shape with version prefix', () => {
        expect(buildNewsCacheKey('AAPL', 'gemini-2.5-pro', 'h2')).toBe(
            `${CACHE_KEY_SCHEMA_VERSION}:analysis:news:AAPL:gemini-2.5-pro:${NEWS_PROMPT_TEMPLATE_VERSION}:h2`
        );
    });

    it('buildOverallCacheKey includes timeframe and version prefix', () => {
        expect(
            buildOverallCacheKey('AAPL', '5Min', 'gemini-2.5-pro', 'h3')
        ).toBe(
            `${CACHE_KEY_SCHEMA_VERSION}:analysis:overall:AAPL:5Min:gemini-2.5-pro:h3`
        );
    });

    it('buildOverallPeekCacheKey is content-free (no input hash) with peek segment and version prefix', () => {
        expect(buildOverallPeekCacheKey('AAPL', '5Min', 'gemini-2.5-pro')).toBe(
            `${CACHE_KEY_SCHEMA_VERSION}:analysis:overall:peek:AAPL:5Min:gemini-2.5-pro`
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

describe('PROMPT_TEMPLATE_VERSION in technical & fundamental keys', () => {
    it('is a non-empty string, separate from CACHE_KEY_SCHEMA_VERSION', () => {
        expect(typeof PROMPT_TEMPLATE_VERSION).toBe('string');
        expect(PROMPT_TEMPLATE_VERSION.length).toBeGreaterThan(0);
        // Distinct invalidation axes — must not be conflated.
        expect(PROMPT_TEMPLATE_VERSION).not.toBe(CACHE_KEY_SCHEMA_VERSION);
    });

    it('technical key ends with the prompt-template version segment', () => {
        const key = buildAnalysisCacheKey('AAPL', '1Day', 'gemini-2.5-pro');
        expect(key.endsWith(`:${PROMPT_TEMPLATE_VERSION}`)).toBe(true);
    });

    it('fundamental key ends with the prompt-template version segment', () => {
        const key = buildFundamentalCacheKey('AAPL', 'gemini-2.5-pro');
        expect(key.endsWith(`:${PROMPT_TEMPLATE_VERSION}`)).toBe(true);
    });
});

describe('buildFinancialsCacheKey', () => {
    it('includes schema version, symbol, period, model, prompt version, and fingerprint', () => {
        const k = buildFinancialsCacheKey(
            'AAPL',
            'gemini-2.5-flash',
            'annual',
            'sk1'
        );
        expect(k).toContain(
            ':analysis:financials:AAPL:annual:gemini-2.5-flash:'
        );
        expect(k.endsWith(':sk1')).toBe(true);
    });
    it('omits fingerprint segment when absent', () => {
        expect(
            buildFinancialsCacheKey(
                'AAPL',
                'gemini-2.5-flash',
                'annual'
            ).endsWith(':sk1')
        ).toBe(false);
    });
    it('annual and quarter produce different keys for the same symbol and model', () => {
        const annualKey = buildFinancialsCacheKey(
            'AAPL',
            'gemini-2.5-flash',
            'annual'
        );
        const quarterKey = buildFinancialsCacheKey(
            'AAPL',
            'gemini-2.5-flash',
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
        expect(buildCongressTrendCacheKey('AAPL', 'gemini-2.5-flash')).toBe(
            `v1:analysis:congress:AAPL:gemini-2.5-flash:${CONGRESS_PROMPT_TEMPLATE_VERSION}`
        );
    });
    it('skillFingerprint 제공 시 suffix 추가', () => {
        expect(
            buildCongressTrendCacheKey('AAPL', 'gemini-2.5-flash', 'sk1')
        ).toBe(
            `v1:analysis:congress:AAPL:gemini-2.5-flash:${CONGRESS_PROMPT_TEMPLATE_VERSION}:sk1`
        );
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
                'gemini-2.5-flash',
                'abc123'
            )
        ).toBe(
            `${CACHE_KEY_SCHEMA_VERSION}:analysis:market-news:crypto:gemini-2.5-flash:${NEWS_PROMPT_TEMPLATE_VERSION}:abc123`
        );
    });

    it('reasoning=true는 :reason=on suffix를 추가하고, false/생략은 동일 키를 만든다', () => {
        // 추론 on/off는 같은 기사 집합에서도 다이제스트 서술의 깊이를 바꾼다.
        // 키가 갈리지 않으면 먼저 캐시를 채운 쪽이 TTL 동안 반대 모드
        // 호출자의 결과까지 결정한다. `false`/`undefined`가 같은 키인 것은
        // 이 옵션이 생기기 전에 쓰인 엔트리가 계속 히트하게 하기 위함이다.
        const omitted = buildMarketNewsDigestCacheKey(
            'crypto',
            'deepseek-v4-flash',
            'abc123'
        );
        const off = buildMarketNewsDigestCacheKey(
            'crypto',
            'deepseek-v4-flash',
            'abc123',
            false
        );
        const on = buildMarketNewsDigestCacheKey(
            'crypto',
            'deepseek-v4-flash',
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
        const off = buildAnalysisCacheKey('AAPL', '1Day', 'gemini-2.5-flash');
        const on = buildAnalysisCacheKey(
            'AAPL',
            '1Day',
            'gemini-2.5-flash',
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
            'gemini-2.5-flash'
        );
        expect(
            buildAnalysisCacheKey(
                'AAPL',
                '1Day',
                'gemini-2.5-flash',
                undefined,
                false
            )
        ).toBe(legacy);
        expect(
            buildAnalysisCacheKey(
                'AAPL',
                '1Day',
                'gemini-2.5-flash',
                undefined,
                undefined
            )
        ).toBe(legacy);
    });

    it('buildAnalysisCacheKey: skillFingerprint와 reasoning이 함께 있으면 reason suffix가 맨 뒤에 붙는다', () => {
        const key = buildAnalysisCacheKey(
            'AAPL',
            '1Day',
            'gemini-2.5-flash',
            'sk1',
            true
        );
        expect(key).toBe(
            `analysis:AAPL:1Day:gemini-2.5-flash:${PROMPT_TEMPLATE_VERSION}:sk1:reason=on`
        );
    });

    it('buildFundamentalCacheKey: on/off 키가 다르고, off는 기존 키와 동일하다', () => {
        const legacy = buildFundamentalCacheKey('AAPL', 'gemini-2.5-pro');
        expect(
            buildFundamentalCacheKey('AAPL', 'gemini-2.5-pro', undefined, false)
        ).toBe(legacy);
        expect(
            buildFundamentalCacheKey('AAPL', 'gemini-2.5-pro', undefined, true)
        ).toBe(`${legacy}:reason=on`);
    });

    it('buildFinancialsCacheKey: on/off 키가 다르고, off는 기존 키와 동일하다', () => {
        const legacy = buildFinancialsCacheKey(
            'AAPL',
            'gemini-2.5-flash',
            'annual'
        );
        expect(
            buildFinancialsCacheKey(
                'AAPL',
                'gemini-2.5-flash',
                'annual',
                undefined,
                false
            )
        ).toBe(legacy);
        expect(
            buildFinancialsCacheKey(
                'AAPL',
                'gemini-2.5-flash',
                'annual',
                undefined,
                true
            )
        ).toBe(`${legacy}:reason=on`);
    });

    it('buildCongressTrendCacheKey: on/off 키가 다르고, off는 기존 키와 동일하다', () => {
        const legacy = buildCongressTrendCacheKey('AAPL', 'gemini-2.5-flash');
        expect(
            buildCongressTrendCacheKey(
                'AAPL',
                'gemini-2.5-flash',
                undefined,
                false
            )
        ).toBe(legacy);
        expect(
            buildCongressTrendCacheKey(
                'AAPL',
                'gemini-2.5-flash',
                undefined,
                true
            )
        ).toBe(`${legacy}:reason=on`);
    });

    it('buildNewsCacheKey: on/off 키가 다르고, off는 기존 키와 동일하다', () => {
        const legacy = buildNewsCacheKey('AAPL', 'gemini-2.5-pro', 'h2');
        expect(buildNewsCacheKey('AAPL', 'gemini-2.5-pro', 'h2', false)).toBe(
            legacy
        );
        expect(buildNewsCacheKey('AAPL', 'gemini-2.5-pro', 'h2', true)).toBe(
            `${legacy}:reason=on`
        );
    });

    it('buildOverallCacheKey: on/off 키가 다르고, off는 기존 키와 동일하다', () => {
        const legacy = buildOverallCacheKey(
            'AAPL',
            '5Min',
            'gemini-2.5-pro',
            'h3'
        );
        expect(
            buildOverallCacheKey('AAPL', '5Min', 'gemini-2.5-pro', 'h3', false)
        ).toBe(legacy);
        expect(
            buildOverallCacheKey('AAPL', '5Min', 'gemini-2.5-pro', 'h3', true)
        ).toBe(`${legacy}:reason=on`);
    });

    it('buildOverallPeekCacheKey: on/off 키가 다르고, off는 기존 키와 동일하다', () => {
        const legacy = buildOverallPeekCacheKey(
            'AAPL',
            '5Min',
            'gemini-2.5-pro'
        );
        expect(
            buildOverallPeekCacheKey('AAPL', '5Min', 'gemini-2.5-pro', false)
        ).toBe(legacy);
        expect(
            buildOverallPeekCacheKey('AAPL', '5Min', 'gemini-2.5-pro', true)
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
            'gemini-2.5-flash'
        );
        expect(legacy).toBe(
            `analysis:AAPL:1Day:gemini-2.5-flash:${PROMPT_TEMPLATE_VERSION}`
        );
        expect(
            buildAnalysisCacheKey(
                'AAPL',
                '1Day',
                'gemini-2.5-flash',
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
            'gemini-2.5-flash'
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
                'gemini-2.5-flash',
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
            'gemini-2.5-flash',
            'sk1',
            true,
            'profit'
        );
        expect(key).toBe(
            `analysis:AAPL:1Day:gemini-2.5-flash:${PROMPT_TEMPLATE_VERSION}:sk1:reason=on:pos=profit`
        );
    });

    it('buildAnalysisCacheKey: reasoning 없이 positionBucket만 있으면 :pos=<bucket>만 붙는다', () => {
        const key = buildAnalysisCacheKey(
            'AAPL',
            '1Day',
            'gemini-2.5-flash',
            undefined,
            undefined,
            'deep-loss'
        );
        expect(key).toBe(
            `analysis:AAPL:1Day:gemini-2.5-flash:${PROMPT_TEMPLATE_VERSION}:pos=deep-loss`
        );
    });

    it('PROMPT_TEMPLATE_VERSION은 pure-Korean 규칙 + holder-consistent 재구성으로 p8로 bump된다', () => {
        // The hint's *introduction* did not bump the version (it only appended a
        // brand-new `:pos=<bucket>` namespace). p7 reframed the hint to an
        // instructive position-management perspective. p8 ships two more
        // technical-prompt byte changes: (1) the STRICT pure-Hangul (no-한자)
        // output-language rule in buildAnalysisRequest, which changes bytes for
        // EVERY request, and (2) the holder-consistent reframe of
        // formatPositionHintSection (explicit holder opener, management as the
        // primary frame). Warm entries carrying the old bytes must be
        // invalidated — hence p8.
        expect(PROMPT_TEMPLATE_VERSION).toBe('p8');
    });
});
