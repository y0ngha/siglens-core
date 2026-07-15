import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { AnalysisResponse, TierConfig, Timeframe } from '@/domain/types';
import { TIER_CONFIG } from '@/domain/tier';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/skills/loader');

import { peekAnalysisCache } from '@/application/market/peekAnalysisCache';
import {
    buildAnalysisCacheKey,
    DEFAULT_ANALYSIS_MODEL_ID,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { hashSkillCatalog } from '@/infrastructure/hash/analysisInput';
import { loadSkillsCached } from '@/infrastructure/skills/loader';
import { EMPTY_ANALYSIS_FALLBACK_SUMMARY } from '@/domain/analysis/confidence';

const mockCreateCacheProvider = createCacheProvider as Mock;
const mockLoadSkillsCached = loadSkillsCached as Mock;

/** Empty-catalog fingerprint folded into the peek key. */
const EMPTY_CATALOG_FP = hashSkillCatalog([]);

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
        mockLoadSkillsCached.mockResolvedValue({
            skills: [],
            skillsDegraded: false,
        });
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

    it('writer와 동일한 캐시 키로 읽는다', async () => {
        mockCacheGet.mockResolvedValueOnce(cachedResult);

        await peekAnalysisCache(
            SYMBOL,
            TIMEFRAME,
            undefined,
            'gemini-2.5-flash'
        );

        expect(mockCacheGet).toHaveBeenCalledWith(
            buildAnalysisCacheKey(
                SYMBOL,
                TIMEFRAME,
                'gemini-2.5-flash',
                `free:${EMPTY_CATALOG_FP}`
            )
        );
    });

    it('reasoning=true이면 :reason=on suffix가 붙은 키로 읽는다 (member-reasoning-toggle spec)', async () => {
        mockCacheGet.mockResolvedValueOnce(cachedResult);

        await peekAnalysisCache(
            SYMBOL,
            TIMEFRAME,
            undefined,
            'gemini-2.5-flash',
            true
        );

        expect(mockCacheGet).toHaveBeenCalledWith(
            buildAnalysisCacheKey(
                SYMBOL,
                TIMEFRAME,
                'gemini-2.5-flash',
                `free:${EMPTY_CATALOG_FP}`,
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
            'gemini-2.5-flash'
        );

        expect(mockCacheGet).toHaveBeenCalledWith(
            buildAnalysisCacheKey(
                SYMBOL,
                TIMEFRAME,
                'gemini-2.5-flash',
                `free:${EMPTY_CATALOG_FP}`
            )
        );
    });

    it('modelId 미지정 시 DEFAULT_ANALYSIS_MODEL_ID 키로 읽는다', async () => {
        mockCacheGet.mockResolvedValueOnce(cachedResult);

        await peekAnalysisCache(SYMBOL, TIMEFRAME);

        expect(mockCacheGet).toHaveBeenCalledWith(
            buildAnalysisCacheKey(
                SYMBOL,
                TIMEFRAME,
                DEFAULT_ANALYSIS_MODEL_ID,
                `free:${EMPTY_CATALOG_FP}`
            )
        );
    });

    it('same sampled catalog still isolates cache keys by tier', async () => {
        await peekAnalysisCache(SYMBOL, TIMEFRAME);
        await peekAnalysisCache(
            SYMBOL,
            TIMEFRAME,
            undefined,
            undefined,
            undefined,
            'member'
        );

        const [freeKey] = mockCacheGet.mock.calls[0] as [string];
        const [memberKey] = mockCacheGet.mock.calls[1] as [string];

        expect(freeKey).not.toBe(memberKey);
        expect(memberKey).toBe(
            buildAnalysisCacheKey(
                SYMBOL,
                TIMEFRAME,
                DEFAULT_ANALYSIS_MODEL_ID,
                `member:${EMPTY_CATALOG_FP}`
            )
        );
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
        expect(mockLoadSkillsCached).not.toHaveBeenCalled();
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
});
