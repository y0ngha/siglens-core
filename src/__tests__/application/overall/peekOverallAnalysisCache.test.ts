import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { ModelId, Timeframe } from '@/domain/types';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');

import { peekOverallAnalysisCache } from '@/application/overall/peekOverallAnalysisCache';
import { buildOverallPeekCacheKey } from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { setJobMeta } from '@/infrastructure/jobs/queue';

const mockCreateCacheProvider = createCacheProvider as Mock;
const mockSetJobMeta = setJobMeta as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheDelete = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: mockCacheDelete,
};

const SYMBOL = 'AAPL';
const COMPANY = 'Apple Inc.';
const TIMEFRAME: Timeframe = '1Day';
const MODEL: ModelId = 'gemini-2.5-flash';

/** A well-formed cached overall analysis payload (object, as stored in Redis). */
const cachedOverall = {
    headlineKo: '3축 종합 분석 결과',
    technicalBulletsKo: ['상승 추세 유지'],
    fundamentalBulletsKo: ['밸류에이션 적정'],
    newsBulletsKo: ['긍정적 뉴스 흐름'],
    optionsBulletsKo: [],
    integratedConclusionKo: '세 축 모두 긍정적',
    scenarios: [
        {
            name: 'bullish',
            triggerConditionKo: '210 돌파',
            priceRangeKo: '210-230',
        },
    ],
    riskFactorsKo: ['금리 인상 리스크'],
};

describe('peekOverallAnalysisCache 함수는', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheGet.mockResolvedValue(null);
    });

    it('캐시 HIT이면 정규화된 종합 분석 결과를 반환한다', async () => {
        mockCacheGet.mockResolvedValueOnce(cachedOverall);

        const result = await peekOverallAnalysisCache(
            SYMBOL,
            COMPANY,
            TIMEFRAME,
            MODEL
        );

        expect(result).not.toBeNull();
        expect(result?.headlineKo).toBe('3축 종합 분석 결과');
        expect(result?.scenarios).toHaveLength(1);
        expect(result?.riskFactorsKo).toEqual(['금리 인상 리스크']);
    });

    it('writer(pollOverallAnalysis)와 동일한 peek 키로 읽는다', async () => {
        mockCacheGet.mockResolvedValueOnce(cachedOverall);

        await peekOverallAnalysisCache(SYMBOL, COMPANY, TIMEFRAME, MODEL);

        expect(mockCacheGet).toHaveBeenCalledWith(
            buildOverallPeekCacheKey(SYMBOL, TIMEFRAME, MODEL)
        );
    });

    it('캐시 MISS이면 null을 반환한다', async () => {
        mockCacheGet.mockResolvedValueOnce(null);

        const result = await peekOverallAnalysisCache(
            SYMBOL,
            COMPANY,
            TIMEFRAME,
            MODEL
        );

        expect(result).toBeNull();
    });

    it('modelId 미지정 시 null을 반환한다 (읽기 시도 없음)', async () => {
        const result = await peekOverallAnalysisCache(
            SYMBOL,
            COMPANY,
            TIMEFRAME
        );

        expect(result).toBeNull();
        expect(mockCacheGet).not.toHaveBeenCalled();
    });

    it('캐시 프로바이더가 null이면 null을 반환한다 (읽기 시도 없음)', async () => {
        mockCreateCacheProvider.mockReturnValueOnce(null);

        const result = await peekOverallAnalysisCache(
            SYMBOL,
            COMPANY,
            TIMEFRAME,
            MODEL
        );

        expect(result).toBeNull();
        expect(mockCacheGet).not.toHaveBeenCalled();
    });

    it('캐시 읽기가 throw하면 null을 반환한다', async () => {
        mockCacheGet.mockRejectedValueOnce(new Error('redis down'));
        const consoleSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        const result = await peekOverallAnalysisCache(
            SYMBOL,
            COMPANY,
            TIMEFRAME,
            MODEL
        );

        consoleSpy.mockRestore();
        expect(result).toBeNull();
    });

    it('손상된 문자열 페이로드이면 null을 반환한다', async () => {
        mockCacheGet.mockResolvedValueOnce('not valid json {{{');
        const consoleSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        const result = await peekOverallAnalysisCache(
            SYMBOL,
            COMPANY,
            TIMEFRAME,
            MODEL
        );

        consoleSpy.mockRestore();
        expect(result).toBeNull();
    });

    it('빈/내용 없는 페이로드이면 null을 반환한다', async () => {
        mockCacheGet.mockResolvedValueOnce({});

        const result = await peekOverallAnalysisCache(
            SYMBOL,
            COMPANY,
            TIMEFRAME,
            MODEL
        );

        expect(result).toBeNull();
    });

    it('어떤 경로에서도 생성/enqueue 부작용이 없다 (read-only)', async () => {
        mockCacheGet.mockResolvedValueOnce(cachedOverall);
        await peekOverallAnalysisCache(SYMBOL, COMPANY, TIMEFRAME, MODEL);
        // MISS path
        mockCacheGet.mockResolvedValueOnce(null);
        await peekOverallAnalysisCache(SYMBOL, COMPANY, TIMEFRAME, MODEL);

        expect(mockSetJobMeta).not.toHaveBeenCalled();
        expect(mockCacheSet).not.toHaveBeenCalled();
        expect(mockCacheDelete).not.toHaveBeenCalled();
    });
});
