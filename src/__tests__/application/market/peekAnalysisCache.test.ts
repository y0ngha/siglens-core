import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { AnalysisResponse, TierConfig, Timeframe } from '@/domain/types';
import { DEFAULT_TIER, TIER_CONFIG } from '@/domain/tier';

vi.mock('@/infrastructure/cache/redis');

import { peekAnalysisCache } from '@/application/market/peekAnalysisCache';
import {
    buildAnalysisPeekCacheKey,
    DEFAULT_ANALYSIS_MODEL_ID,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { EMPTY_ANALYSIS_FALLBACK_SUMMARY } from '@/domain/analysis/confidence';

const mockCreateCacheProvider = createCacheProvider as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheDelete = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: mockCacheDelete,
};

const SYMBOL = 'AAPL';
const TIMEFRAME: Timeframe = '1Day';
const RESTRICTED_TIER_CONFIG: TierConfig = {
    ...TIER_CONFIG,
    featureFlags: { enableTierRestrictions: true },
};

/** A well-formed cached technical analysis payload. */
const cachedResult: AnalysisResponse = {
    summary: '강세 우위 기술적 분석',
    trend: 'bullish',
    indicatorResults: [],
    riskLevel: 'low',
    keyLevels: { support: [{ price: 100, reason: '지지' }], resistance: [] },
    priceTargets: {
        bullish: { targets: [], condition: '' },
        bearish: { targets: [], condition: '' },
    },
    patternSummaries: [],
    strategyResults: [],
    candlePatterns: [],
    trendlines: [],
};

describe('peekAnalysisCache 함수는', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheGet.mockResolvedValue(null);
    });

    it('캐시 HIT이면 free-safe 분석 결과를 반환한다', async () => {
        mockCacheGet.mockResolvedValueOnce(cachedResult);

        const result = await peekAnalysisCache(SYMBOL, TIMEFRAME);

        expect(result).not.toBeNull();
        expect(result?.result.summary).toBe('강세 우위 기술적 분석');
        expect(result?.result.trend).toBe('bullish');
        expect(result?.result.keyLevels).toBeNull();
        expect(result?.lockedInfoDepth).toContain('partial_detail');
    });

    it('writer가 쓰는 peek pointer 키(buildAnalysisPeekCacheKey)로 읽는다', async () => {
        mockCacheGet.mockResolvedValueOnce(cachedResult);

        await peekAnalysisCache(
            SYMBOL,
            TIMEFRAME,
            undefined,
            'gemini-3.6-flash'
        );

        expect(mockCacheGet).toHaveBeenCalledWith(
            buildAnalysisPeekCacheKey(
                SYMBOL,
                TIMEFRAME,
                'gemini-3.6-flash',
                DEFAULT_TIER
            )
        );
    });

    it('reasoning=true이면 :reason=on suffix가 붙은 키로 읽는다', async () => {
        mockCacheGet.mockResolvedValueOnce(cachedResult);

        await peekAnalysisCache(
            SYMBOL,
            TIMEFRAME,
            undefined,
            'gemini-3.6-flash',
            true
        );

        expect(mockCacheGet).toHaveBeenCalledWith(
            buildAnalysisPeekCacheKey(
                SYMBOL,
                TIMEFRAME,
                'gemini-3.6-flash',
                DEFAULT_TIER,
                true
            )
        );
    });

    it('reasoning 미지정 시 기존 키(reasoning-off)와 동일한 키로 읽는다', async () => {
        mockCacheGet.mockResolvedValueOnce(cachedResult);

        await peekAnalysisCache(
            SYMBOL,
            TIMEFRAME,
            undefined,
            'gemini-3.6-flash'
        );

        expect(mockCacheGet).toHaveBeenCalledWith(
            buildAnalysisPeekCacheKey(
                SYMBOL,
                TIMEFRAME,
                'gemini-3.6-flash',
                DEFAULT_TIER
            )
        );
    });

    it('positionBucket이 있으면 :pos=<bucket> suffix가 붙은 키로 읽는다', async () => {
        mockCacheGet.mockResolvedValueOnce(cachedResult);

        await peekAnalysisCache(
            SYMBOL,
            TIMEFRAME,
            undefined,
            'gemini-3.6-flash',
            undefined,
            DEFAULT_TIER,
            TIER_CONFIG,
            'profit'
        );

        expect(mockCacheGet).toHaveBeenCalledWith(
            buildAnalysisPeekCacheKey(
                SYMBOL,
                TIMEFRAME,
                'gemini-3.6-flash',
                DEFAULT_TIER,
                undefined,
                'profit'
            )
        );
    });

    it('positionBucket 미지정 시 기존(레거시) 키와 동일하다', async () => {
        mockCacheGet.mockResolvedValueOnce(cachedResult);

        await peekAnalysisCache(
            SYMBOL,
            TIMEFRAME,
            undefined,
            'gemini-3.6-flash'
        );

        expect(mockCacheGet).toHaveBeenCalledWith(
            buildAnalysisPeekCacheKey(
                SYMBOL,
                TIMEFRAME,
                'gemini-3.6-flash',
                DEFAULT_TIER
            )
        );
    });

    it('reasoning과 positionBucket이 함께 있으면 writer(runAnalysis)와 동일한 순서로 합성된 키로 읽는다', async () => {
        mockCacheGet.mockResolvedValueOnce(cachedResult);

        await peekAnalysisCache(
            SYMBOL,
            TIMEFRAME,
            undefined,
            'gemini-3.6-flash',
            true,
            DEFAULT_TIER,
            TIER_CONFIG,
            'deep-loss'
        );

        expect(mockCacheGet).toHaveBeenCalledWith(
            buildAnalysisPeekCacheKey(
                SYMBOL,
                TIMEFRAME,
                'gemini-3.6-flash',
                DEFAULT_TIER,
                true,
                'deep-loss'
            )
        );
    });

    it('locale=en이면 :lang=en pointer 키로 읽는다', async () => {
        mockCacheGet.mockResolvedValueOnce(cachedResult);

        await peekAnalysisCache(
            SYMBOL,
            TIMEFRAME,
            undefined,
            'gemini-3.6-flash',
            undefined,
            DEFAULT_TIER,
            TIER_CONFIG,
            undefined,
            'en'
        );

        expect(mockCacheGet).toHaveBeenCalledWith(
            buildAnalysisPeekCacheKey(
                SYMBOL,
                TIMEFRAME,
                'gemini-3.6-flash',
                DEFAULT_TIER,
                undefined,
                undefined,
                'en'
            )
        );
    });

    it('locale 미지정 시 ko pointer 키(레거시와 byte-identical)로 읽는다', async () => {
        mockCacheGet.mockResolvedValueOnce(cachedResult);

        await peekAnalysisCache(
            SYMBOL,
            TIMEFRAME,
            undefined,
            'gemini-3.6-flash'
        );

        expect(mockCacheGet).toHaveBeenCalledWith(
            buildAnalysisPeekCacheKey(
                SYMBOL,
                TIMEFRAME,
                'gemini-3.6-flash',
                DEFAULT_TIER,
                undefined,
                undefined,
                'ko'
            )
        );
    });

    it('modelId 미지정 시 DEFAULT_ANALYSIS_MODEL_ID 키로 읽는다', async () => {
        mockCacheGet.mockResolvedValueOnce(cachedResult);

        await peekAnalysisCache(SYMBOL, TIMEFRAME);

        expect(mockCacheGet).toHaveBeenCalledWith(
            buildAnalysisPeekCacheKey(
                SYMBOL,
                TIMEFRAME,
                DEFAULT_ANALYSIS_MODEL_ID,
                DEFAULT_TIER
            )
        );
    });

    it('tier가 다르면 pointer 키도 서로 다르다', async () => {
        await peekAnalysisCache(SYMBOL, TIMEFRAME);
        await peekAnalysisCache(
            SYMBOL,
            TIMEFRAME,
            undefined,
            undefined,
            undefined,
            'member'
        );

        const [freeKey] = mockCacheGet.mock.calls.find(
            call =>
                call[0] ===
                buildAnalysisPeekCacheKey(
                    SYMBOL,
                    TIMEFRAME,
                    DEFAULT_ANALYSIS_MODEL_ID,
                    'free'
                )
        ) as [string];
        const [memberKey] = mockCacheGet.mock.calls.find(
            call =>
                call[0] ===
                buildAnalysisPeekCacheKey(
                    SYMBOL,
                    TIMEFRAME,
                    DEFAULT_ANALYSIS_MODEL_ID,
                    'member'
                )
        ) as [string];

        expect(freeKey).not.toBe(memberKey);
    });

    it('returns null without reading cache when the tier disallows the timeframe', async () => {
        const result = await peekAnalysisCache(
            SYMBOL,
            '5Min',
            undefined,
            undefined,
            undefined,
            'free',
            RESTRICTED_TIER_CONFIG
        );

        expect(result).toBeNull();
        expect(mockCacheGet).not.toHaveBeenCalled();
    });

    it('캐시 MISS이면 null을 반환한다', async () => {
        mockCacheGet.mockResolvedValueOnce(null);

        const result = await peekAnalysisCache(SYMBOL, TIMEFRAME);

        expect(result).toBeNull();
    });

    it('캐시 프로바이더가 null이면 null을 반환한다 (읽기 시도 없음)', async () => {
        mockCreateCacheProvider.mockReturnValueOnce(null);

        const result = await peekAnalysisCache(SYMBOL, TIMEFRAME);

        expect(result).toBeNull();
        expect(mockCacheGet).not.toHaveBeenCalled();
    });

    it('캐시 읽기가 throw하면 null을 반환한다', async () => {
        mockCacheGet.mockRejectedValueOnce(new Error('redis down'));
        const consoleSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        const result = await peekAnalysisCache(SYMBOL, TIMEFRAME);

        consoleSpy.mockRestore();
        expect(result).toBeNull();
    });

    it('손상된 문자열 페이로드이면 null을 반환한다', async () => {
        mockCacheGet.mockResolvedValueOnce('not valid json {{{');
        const consoleSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        const result = await peekAnalysisCache(SYMBOL, TIMEFRAME);

        consoleSpy.mockRestore();
        expect(result).toBeNull();
    });

    it('fallback shape(빈 분석)으로 정규화되면 null을 반환한다', async () => {
        // A poisoned/empty object normalizes to the fallback summary with all
        // arrays empty — treat as a cache miss, not an empty body.
        mockCacheGet.mockResolvedValueOnce({ summary: '', trend: 'invalid' });

        const result = await peekAnalysisCache(SYMBOL, TIMEFRAME);

        expect(result).toBeNull();
    });

    it('명시적 fallback summary 문자열도 null로 처리한다', async () => {
        mockCacheGet.mockResolvedValueOnce({
            summary: EMPTY_ANALYSIS_FALLBACK_SUMMARY,
            indicatorResults: [],
            patternSummaries: [],
            strategyResults: [],
            candlePatterns: [],
            trendlines: [],
            keyLevels: { support: [], resistance: [] },
            priceTargets: {},
        });

        const result = await peekAnalysisCache(SYMBOL, TIMEFRAME);

        expect(result).toBeNull();
    });

    it('어떤 경로에서도 생성/enqueue 부작용이 없다 (read-only)', async () => {
        mockCacheGet.mockResolvedValueOnce(cachedResult);

        await peekAnalysisCache(SYMBOL, TIMEFRAME);
        // MISS path
        mockCacheGet.mockResolvedValueOnce(null);
        await peekAnalysisCache(SYMBOL, TIMEFRAME);

        expect(mockCacheSet).not.toHaveBeenCalled();
        expect(mockCacheDelete).not.toHaveBeenCalled();
    });

    describe('cacheOptions.cache 주입', () => {
        const injectedGet = vi.fn();
        const injectedCache = {
            get: injectedGet,
            set: vi.fn(),
            delete: vi.fn(),
        };

        beforeEach(() => {
            injectedGet.mockReset();
        });

        it('주입한 캐시에서 peek 키로 읽고 env 캐시는 만들지 않는다', async () => {
            injectedGet.mockResolvedValueOnce(cachedResult);

            const result = await peekAnalysisCache(
                SYMBOL,
                TIMEFRAME,
                undefined,
                'gemini-3.6-flash',
                undefined,
                DEFAULT_TIER,
                TIER_CONFIG,
                undefined,
                undefined,
                { cache: injectedCache }
            );

            expect(result?.result.summary).toBe('강세 우위 기술적 분석');
            expect(injectedGet).toHaveBeenCalledWith(
                buildAnalysisPeekCacheKey(
                    SYMBOL,
                    TIMEFRAME,
                    'gemini-3.6-flash',
                    DEFAULT_TIER,
                    undefined,
                    undefined,
                    undefined
                )
            );
            expect(mockCreateCacheProvider).not.toHaveBeenCalled();
            expect(mockCacheGet).not.toHaveBeenCalled();
        });

        it('cache: null 이면 env 캐시로 폴백하지 않고 null을 반환한다', async () => {
            const result = await peekAnalysisCache(
                SYMBOL,
                TIMEFRAME,
                undefined,
                undefined,
                undefined,
                DEFAULT_TIER,
                TIER_CONFIG,
                undefined,
                undefined,
                { cache: null }
            );

            expect(result).toBeNull();
            expect(mockCreateCacheProvider).not.toHaveBeenCalled();
            expect(mockCacheGet).not.toHaveBeenCalled();
        });
    });
});
