import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/domain/analysis/normalizeMarketBriefing');

import { peekBriefingCache } from '@/application/market/peekBriefingCache';
import {
    MARKET_BRIEFING_PROMPT_TEMPLATE_VERSION,
    BRIEFING_MODEL_ID,
    buildBriefingCacheKey,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { normalizeMarketBriefing } from '@/domain/analysis/normalizeMarketBriefing';
import type { MarketBriefingResponse, MarketSummaryData } from '@/domain/types';
import { ISO_DATE_HOUR_PREFIX_LENGTH } from '@/domain/constants/format';

const mockCreateCacheProvider = createCacheProvider as Mock;
const mockNormalizeMarketBriefing = normalizeMarketBriefing as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheDelete = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: mockCacheDelete,
};

const mockData: MarketSummaryData = {
    indices: [],
    sectors: [],
};

const mockBriefing: MarketBriefingResponse = {
    summary: '시장 요약',
    dominantThemes: [],
    sectorAnalysis: {
        leadingSectors: [],
        laggingSectors: [],
        performanceDescription: '',
    },
    volatilityAnalysis: { description: '' },
    riskSentiment: 'neutral',
};

const mockCachedData = {
    briefing: { raw: 'payload' },
    generatedAt: '2026-06-04T10:00:00.000Z',
};

const CTX = {
    marketLabel: '미국 증시',
    volatility: { label: 'VIX', level: 18.3 },
} as const;

describe('peekBriefingCache 함수는', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheGet.mockResolvedValue(null);
        mockNormalizeMarketBriefing.mockReturnValue(mockBriefing);
    });

    it('(Happy) 캐시 HIT이면 normalizeMarketBriefing 결과를 반환한다', async () => {
        mockCacheGet.mockResolvedValueOnce(mockCachedData);

        const result = await peekBriefingCache(mockData, CTX);

        expect(result).toBe(mockBriefing);
        expect(mockNormalizeMarketBriefing).toHaveBeenCalledWith(
            mockCachedData.briefing
        );
    });

    it('writer와 동일한 캐시 키로 읽는다 (dateHour + model + inputHash)', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-04T10:30:00.000Z'));
        try {
            mockCacheGet.mockResolvedValueOnce(mockCachedData);

            await peekBriefingCache(mockData, CTX);

            const calledKey = mockCacheGet.mock.calls[0][0] as string;
            const dateHour = new Date()
                .toISOString()
                .slice(0, ISO_DATE_HOUR_PREFIX_LENGTH);
            // key format: briefing:market:<dateHour>:<model>:<inputHash(16 hex)>:<promptVersion>
            expect(calledKey).toMatch(
                new RegExp(
                    `^briefing:market:${dateHour}:${BRIEFING_MODEL_ID.replace(/\./g, '\\.')}:[0-9a-f]{16}:${MARKET_BRIEFING_PROMPT_TEMPLATE_VERSION}$`
                )
            );
        } finally {
            vi.useRealTimers();
        }
    });

    it('modelId 미지정 시 BRIEFING_MODEL_ID 키로 읽는다', async () => {
        mockCacheGet.mockResolvedValueOnce(mockCachedData);

        await peekBriefingCache(mockData, CTX);

        const calledKey = mockCacheGet.mock.calls[0][0] as string;
        expect(calledKey).toContain(BRIEFING_MODEL_ID);
    });

    it('커스텀 modelId 지정 시 해당 모델 키로 읽는다', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-04T10:30:00.000Z'));
        try {
            mockCacheGet.mockResolvedValueOnce(mockCachedData);
            const customModel = 'gemini-3.1-pro-preview';

            await peekBriefingCache(mockData, CTX, customModel);

            const calledKey = mockCacheGet.mock.calls[0][0] as string;
            const dateHour = new Date()
                .toISOString()
                .slice(0, ISO_DATE_HOUR_PREFIX_LENGTH);
            expect(calledKey).toContain(
                buildBriefingCacheKey(dateHour, customModel, '')
                    .replace(/:$/, '')
                    .split(':')
                    .slice(0, 4)
                    .join(':')
            );
            expect(calledKey).toContain(customModel);
        } finally {
            vi.useRealTimers();
        }
    });

    it('(Worst) 캐시 MISS이면 null을 반환한다', async () => {
        mockCacheGet.mockResolvedValueOnce(null);

        const result = await peekBriefingCache(mockData, CTX);

        expect(result).toBeNull();
        expect(mockNormalizeMarketBriefing).not.toHaveBeenCalled();
    });

    it('(Worst) 캐시 프로바이더가 null이면 null을 반환하고 get을 호출하지 않는다', async () => {
        mockCreateCacheProvider.mockReturnValueOnce(null);

        const result = await peekBriefingCache(mockData, CTX);

        expect(result).toBeNull();
        expect(mockCacheGet).not.toHaveBeenCalled();
    });

    it('(Worst) get이 reject하면 null을 반환한다 (degraded)', async () => {
        mockCacheGet.mockRejectedValueOnce(new Error('redis down'));
        const consoleSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        const result = await peekBriefingCache(mockData, CTX);

        consoleSpy.mockRestore();
        expect(result).toBeNull();
    });

    it('(Worst) get reject 시 오류를 로깅한다', async () => {
        const redisError = new Error('redis down');
        mockCacheGet.mockRejectedValueOnce(redisError);
        const consoleSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        await peekBriefingCache(mockData, CTX);

        expect(consoleSpy).toHaveBeenCalledWith(
            '[Peek] Briefing cache read failed:',
            redisError
        );
        consoleSpy.mockRestore();
    });

    it('(Worst) normalizeMarketBriefing이 throw하면 null을 반환한다', async () => {
        mockCacheGet.mockResolvedValueOnce(mockCachedData);
        mockNormalizeMarketBriefing.mockImplementationOnce(() => {
            throw new Error('parse error');
        });
        const consoleSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        const result = await peekBriefingCache(mockData, CTX);

        consoleSpy.mockRestore();
        expect(result).toBeNull();
    });

    it('(Worst) normalizeMarketBriefing throw 시 오류를 로깅한다', async () => {
        mockCacheGet.mockResolvedValueOnce(mockCachedData);
        const parseError = new Error('parse error');
        mockNormalizeMarketBriefing.mockImplementationOnce(() => {
            throw parseError;
        });
        const consoleSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        await peekBriefingCache(mockData, CTX);

        expect(consoleSpy).toHaveBeenCalledWith(
            '[Peek] Briefing cache payload invalid:',
            parseError
        );
        consoleSpy.mockRestore();
    });

    it('(Worst/G1) null 데이터 전달 시 null을 반환하고 캐시 프로바이더를 호출하지 않는다', async () => {
        const result = await peekBriefingCache(
            null as unknown as typeof mockData,
            CTX
        );

        expect(result).toBeNull();
        expect(mockCacheGet).not.toHaveBeenCalled();
        expect(mockNormalizeMarketBriefing).not.toHaveBeenCalled();
    });

    it('(Worst/G1) indices/sectors 없는 객체 전달 시 null을 반환하고 캐시 프로바이더를 호출하지 않는다', async () => {
        const result = await peekBriefingCache({} as typeof mockData, CTX);

        expect(result).toBeNull();
        expect(mockCacheGet).not.toHaveBeenCalled();
        expect(mockNormalizeMarketBriefing).not.toHaveBeenCalled();
    });

    it('(Worst/G1) indices는 배열이지만 sectors가 없는 경우 null을 반환하고 캐시 프로바이더를 호출하지 않는다', async () => {
        const result = await peekBriefingCache(
            {
                indices: [],
                sectors: undefined,
            } as unknown as typeof mockData,
            CTX
        );

        expect(result).toBeNull();
        expect(mockCreateCacheProvider).not.toHaveBeenCalled();
        expect(mockCacheGet).not.toHaveBeenCalled();
        expect(mockNormalizeMarketBriefing).not.toHaveBeenCalled();
    });

    it('(Worst/G2) 캐시가 briefing이 null인 객체를 반환하면 null을 반환하고 normalizeMarketBriefing을 호출하지 않는다', async () => {
        mockCacheGet.mockResolvedValueOnce({
            briefing: null,
            generatedAt: '2026-06-04T10:00:00.000Z',
        });

        const result = await peekBriefingCache(mockData, CTX);

        expect(result).toBeNull();
        expect(mockNormalizeMarketBriefing).not.toHaveBeenCalled();
    });

    it('(Worst/G2) 캐시가 briefing이 undefined인 객체를 반환하면 null을 반환하고 normalizeMarketBriefing을 호출하지 않는다', async () => {
        mockCacheGet.mockResolvedValueOnce({
            generatedAt: '2026-06-04T10:00:00.000Z',
        });

        const result = await peekBriefingCache(mockData, CTX);

        expect(result).toBeNull();
        expect(mockNormalizeMarketBriefing).not.toHaveBeenCalled();
    });

    it('캐시 HIT 경로에서 set/delete 부작용이 없다 (read-only)', async () => {
        mockCacheGet.mockResolvedValueOnce(mockCachedData);
        await peekBriefingCache(mockData, CTX);

        expect(mockCacheSet).not.toHaveBeenCalled();
        expect(mockCacheDelete).not.toHaveBeenCalled();
    });

    it('캐시 MISS 경로에서 set/delete 부작용이 없다 (read-only)', async () => {
        mockCacheGet.mockResolvedValueOnce(null);
        await peekBriefingCache(mockData, CTX);

        expect(mockCacheSet).not.toHaveBeenCalled();
        expect(mockCacheDelete).not.toHaveBeenCalled();
    });
});
