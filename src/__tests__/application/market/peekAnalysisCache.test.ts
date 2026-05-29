import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { AnalysisResponse, Timeframe } from '@/domain/types';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/application/market/barsApi');

import { peekAnalysisCache } from '@/application/market/peekAnalysisCache';
import {
    buildAnalysisCacheKey,
    DEFAULT_ANALYSIS_MODEL_ID,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';
import { EMPTY_ANALYSIS_FALLBACK_SUMMARY } from '@/domain/analysis/confidence';

const mockCreateCacheProvider = createCacheProvider as Mock;
const mockSetJobMeta = setJobMeta as Mock;
const mockFetchBarsWithIndicators = fetchBarsWithIndicators as Mock;

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

/** A well-formed cached technical analysis payload. */
const cachedResult: AnalysisResponse = {
    summary: '강세 우위 기술적 분석',
    trend: 'bullish',
    indicatorResults: [],
    riskLevel: 'low',
    keyLevels: { support: [{ price: 100, label: '지지' }], resistance: [] },
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

    it('캐시 HIT이면 정규화된 분석 결과를 반환한다', async () => {
        mockCacheGet.mockResolvedValueOnce(cachedResult);

        const result = await peekAnalysisCache(SYMBOL, TIMEFRAME);

        expect(result).not.toBeNull();
        expect(result?.summary).toBe('강세 우위 기술적 분석');
        expect(result?.trend).toBe('bullish');
        expect(result?.keyLevels.support).toHaveLength(1);
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
            buildAnalysisCacheKey(SYMBOL, TIMEFRAME, 'gemini-2.5-flash')
        );
    });

    it('modelId 미지정 시 DEFAULT_ANALYSIS_MODEL_ID 키로 읽는다', async () => {
        mockCacheGet.mockResolvedValueOnce(cachedResult);

        await peekAnalysisCache(SYMBOL, TIMEFRAME);

        expect(mockCacheGet).toHaveBeenCalledWith(
            buildAnalysisCacheKey(SYMBOL, TIMEFRAME, DEFAULT_ANALYSIS_MODEL_ID)
        );
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

        expect(mockSetJobMeta).not.toHaveBeenCalled();
        expect(mockFetchBarsWithIndicators).not.toHaveBeenCalled();
        expect(mockCacheSet).not.toHaveBeenCalled();
        expect(mockCacheDelete).not.toHaveBeenCalled();
    });
});
