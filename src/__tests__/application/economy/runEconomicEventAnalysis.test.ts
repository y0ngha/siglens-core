import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/application/analysis/callAnalysisAi');
vi.mock('@/infrastructure/cache/redis');

import { runEconomicEventAnalysis } from '@/application/economy/runEconomicEventAnalysis';
import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { ECONOMIC_EVENT_CACHE_TTL } from '@/infrastructure/cache/config';
import type { EconomicEventAnalysisInput } from '@/domain/economy/types';

const mockCallAnalysisAi = callAnalysisAi as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};

const mockRawResult = {
    sentiment: 'bullish',
    summaryKo: 'CPI 예상 하회로 금리 인하 기대 강화.',
    interpretationKo: '위험 자산에 긍정적 신호.',
};

const mockCachedResult = {
    sentiment: 'neutral' as const,
    summaryKo: '캐시된 경제 이벤트 분석.',
    interpretationKo: '중립 해석.',
};

const CPI_INPUT: EconomicEventAnalysisInput = {
    event: 'CPI MoM',
    impact: 'High',
    actual: 0.1,
    estimate: 0.3,
    previous: 0.4,
    unit: '%',
};

describe('runEconomicEventAnalysis', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockCacheGet.mockResolvedValue(null);
        mockCacheSet.mockResolvedValue(undefined);
        mockCallAnalysisAi.mockResolvedValue(JSON.stringify(mockRawResult));
    });

    describe('cache hit', () => {
        it('cache hit → callAnalysisAi NOT called, returns {status:"cached"}', async () => {
            mockCacheGet.mockResolvedValueOnce(mockCachedResult);

            const result = await runEconomicEventAnalysis(CPI_INPUT);

            expect(result.status).toBe('cached');
            expect(mockCallAnalysisAi).not.toHaveBeenCalled();
        });
    });

    describe('cache miss → LLM', () => {
        it('callAnalysisAi를 1회 호출하고 done을 반환한다', async () => {
            const result = await runEconomicEventAnalysis(CPI_INPUT);

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(result.status).toBe('done');
        });

        it('signal을 callAnalysisAi에 그대로 전달한다', async () => {
            const controller = new AbortController();

            await runEconomicEventAnalysis(CPI_INPUT, {
                signal: controller.signal,
            });

            expect(mockCallAnalysisAi).toHaveBeenCalledWith(
                expect.objectContaining({ signal: controller.signal })
            );
        });

        it('결과를 ECONOMIC_EVENT_CACHE_TTL로 캐시에 기록한다', async () => {
            await runEconomicEventAnalysis(CPI_INPUT);

            expect(mockCacheSet).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    sentiment: expect.any(String),
                }),
                ECONOMIC_EVENT_CACHE_TTL
            );
        });
    });

    describe('캐시 프로바이더 없음', () => {
        it('cache provider null이면 조회 건너뛰고 LLM을 호출한다', async () => {
            mockCreateCacheProvider.mockReturnValueOnce(null);

            const result = await runEconomicEventAnalysis(CPI_INPUT);

            expect(result.status).toBe('done');
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
        });
    });

    describe('입력 동일성 — 해시 결정성', () => {
        it('동일 입력은 같은 캐시 키를 사용한다 (cache 두 번 get)', async () => {
            await runEconomicEventAnalysis(CPI_INPUT);
            await runEconomicEventAnalysis(CPI_INPUT);

            const [firstKey] = mockCacheGet.mock.calls[0] as [string];
            const [secondKey] = mockCacheGet.mock.calls[1] as [string];
            expect(firstKey).toBe(secondKey);
        });

        it('입력이 다르면 캐시 키도 다르다', async () => {
            await runEconomicEventAnalysis(CPI_INPUT);
            await runEconomicEventAnalysis({
                ...CPI_INPUT,
                actual: 0.5,
            });

            const [firstKey] = mockCacheGet.mock.calls[0] as [string];
            const [secondKey] = mockCacheGet.mock.calls[1] as [string];
            expect(firstKey).not.toBe(secondKey);
        });
    });

    describe('in-flight 중복 제거', () => {
        it('같은 캐시 키 동시 호출은 LLM을 1회만 태운다', async () => {
            let resolveAi: (value: string) => void = () => {};
            mockCallAnalysisAi.mockReturnValueOnce(
                new Promise<string>(resolve => {
                    resolveAi = resolve;
                })
            );

            const both = Promise.all([
                runEconomicEventAnalysis(CPI_INPUT),
                runEconomicEventAnalysis(CPI_INPUT),
            ]);

            resolveAi(JSON.stringify(mockRawResult));
            const [a, b] = await both;

            expect(mockCallAnalysisAi).toHaveBeenCalledTimes(1);
            expect(a.status).toBe('done');
            expect(b.status).toBe('done');
        });
    });
});
