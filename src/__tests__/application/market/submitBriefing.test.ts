import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/domain/analysis/normalizeMarketBriefing');
vi.mock('@/domain/analysis/marketBriefingPrompt');

import {
    submitBriefing,
    BRIEFING_MODEL_ID,
} from '@/application/market/submitBriefing';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { normalizeMarketBriefing } from '@/domain/analysis/normalizeMarketBriefing';
import { buildMarketBriefingPrompt } from '@/domain/analysis/marketBriefingPrompt';
import type {
    MarketSummaryData,
    MarketBriefingResponse,
    MarketIndexData,
    MarketSectorData,
} from '@/domain/types';

const mockCreateCacheProvider = createCacheProvider as Mock;
const mockSetJobMeta = setJobMeta as Mock;
const mockNormalizeMarketBriefing = normalizeMarketBriefing as Mock;
const mockBuildMarketBriefingPrompt = buildMarketBriefingPrompt as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};
const mockFetch = vi.fn();

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

describe('submitBriefing 함수는', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', mockFetch);
        process.env = {
            ...originalEnv,
            WORKER_URL: 'https://worker.test',
            WORKER_SECRET: 'test-secret',
        };
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockSetJobMeta.mockResolvedValue(undefined);
        mockCacheGet.mockResolvedValue(null);
        mockCacheSet.mockResolvedValue(undefined);
        mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
        mockBuildMarketBriefingPrompt.mockReturnValue('mock prompt');
        mockNormalizeMarketBriefing.mockReturnValue(mockBriefing);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        process.env = originalEnv;
    });

    describe('캐시 히트일 때', () => {
        it('cached 상태와 briefing을 반환한다', async () => {
            const cachedData = {
                briefing: mockBriefing,
                generatedAt: '2024-01-15T09:00:00.000Z',
            };
            mockCacheGet.mockResolvedValueOnce(cachedData);

            const result = await submitBriefing(mockData);

            expect(result.status).toBe('cached');
            if (result.status === 'cached') {
                expect(result.generatedAt).toBe(cachedData.generatedAt);
                expect(result.briefing).toBe(mockBriefing);
            }
            expect(mockFetch).not.toHaveBeenCalled();
            expect(mockSetJobMeta).not.toHaveBeenCalled();
        });
    });

    describe('캐시 미스일 때', () => {
        it('Worker /briefing 엔드포인트에 요청을 보낸다', async () => {
            const result = await submitBriefing(mockData);

            expect(result.status).toBe('submitted');
            expect(mockFetch).toHaveBeenCalledWith(
                'https://worker.test/briefing',
                expect.objectContaining({
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Worker-Secret': 'test-secret',
                    },
                })
            );
        });

        it('dispatch 본문에 model: BRIEFING_MODEL_ID를 포함한다', async () => {
            await submitBriefing(mockData);

            const [, init] = mockFetch.mock.calls[0] as [
                string,
                { body: string },
            ];
            const body = JSON.parse(init.body) as Record<string, unknown>;
            expect(body.model).toBe(BRIEFING_MODEL_ID);
            expect(body).toMatchObject({
                jobId: expect.any(String),
                prompt: 'mock prompt',
                model: BRIEFING_MODEL_ID,
            });
        });

        it('submitted 상태와 jobId를 반환한다', async () => {
            const result = await submitBriefing(mockData);

            expect(result.status).toBe('submitted');
            if (result.status === 'submitted') {
                expect(typeof result.jobId).toBe('string');
                expect(result.jobId.length).toBeGreaterThan(0);
            }
        });

        it('waitUntil이 제공되면 Worker 요청 promise를 등록한다', async () => {
            const waitUntil = vi.fn();

            await submitBriefing(mockData, { waitUntil });

            expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
        });
    });

    describe('환경변수가 없을 때', () => {
        it('WORKER_URL이 없으면 에러를 던진다', async () => {
            delete process.env.WORKER_URL;

            await expect(submitBriefing(mockData)).rejects.toThrow(
                'WORKER_URL and WORKER_SECRET environment variables are required'
            );
        });

        it('WORKER_SECRET이 없으면 에러를 던진다', async () => {
            delete process.env.WORKER_SECRET;

            await expect(submitBriefing(mockData)).rejects.toThrow(
                'WORKER_URL and WORKER_SECRET environment variables are required'
            );
        });
    });

    describe('캐시 프로바이더가 없을 때', () => {
        it('캐시 조회를 건너뛰고 submitted를 반환한다', async () => {
            mockCreateCacheProvider.mockReturnValueOnce(null);

            const result = await submitBriefing(mockData);

            expect(result.status).toBe('submitted');
            expect(mockCacheGet).not.toHaveBeenCalled();
        });
    });

    describe('입력 해시 캐시 키', () => {
        const indexA: MarketIndexData = {
            symbol: 'SPY',
            fmpSymbol: '^GSPC',
            displayName: 'S&P 500',
            koreanName: 'S&P 500',
            price: 5000,
            changesPercentage: 1.2,
        };
        const sectorA: MarketSectorData = {
            symbol: 'XLK',
            sectorName: 'Technology',
            koreanName: '기술',
            price: 200,
            changesPercentage: 0.5,
        };

        function readCacheKey(): string {
            const call = mockCacheGet.mock.calls[0];
            return call[0] as string;
        }

        it('캐시 조회 키에 dateHour, model, 입력 해시가 포함된다', async () => {
            await submitBriefing({ indices: [indexA], sectors: [sectorA] });

            const key = readCacheKey();
            // briefing:market:<dateHour(13)>:<model>:<inputHash(16 hex)>
            expect(key).toMatch(
                new RegExp(
                    `^briefing:market:.{13}:${BRIEFING_MODEL_ID}:[0-9a-f]{16}$`
                )
            );
        });

        it('입력 데이터가 바뀌면 캐시 키가 달라진다', async () => {
            await submitBriefing({ indices: [indexA], sectors: [sectorA] });
            const keyA = readCacheKey();

            mockCacheGet.mockClear();
            await submitBriefing({
                indices: [{ ...indexA, price: 5100 }],
                sectors: [sectorA],
            });
            const keyB = readCacheKey();

            expect(keyA).not.toBe(keyB);
        });

        it('입력 배열 순서가 달라도 동일한 해시(키)를 만든다', async () => {
            const indexB: MarketIndexData = { ...indexA, fmpSymbol: '^IXIC' };
            const sectorB: MarketSectorData = { ...sectorA, symbol: 'XLF' };

            await submitBriefing({
                indices: [indexA, indexB],
                sectors: [sectorA, sectorB],
            });
            const keyOrder1 = readCacheKey();

            mockCacheGet.mockClear();
            await submitBriefing({
                indices: [indexB, indexA],
                sectors: [sectorB, sectorA],
            });
            const keyOrder2 = readCacheKey();

            expect(keyOrder1).toBe(keyOrder2);
        });

        it('정적 표시명만 다르면 해시(키)는 동일하다', async () => {
            await submitBriefing({ indices: [indexA], sectors: [sectorA] });
            const keyA = readCacheKey();

            mockCacheGet.mockClear();
            await submitBriefing({
                indices: [{ ...indexA, displayName: 'Different Label' }],
                sectors: [{ ...sectorA, sectorName: 'Other' }],
            });
            const keyB = readCacheKey();

            expect(keyA).toBe(keyB);
        });

        it('submit 시 동일한 캐시 키를 job meta에 저장한다 (read==write 보장)', async () => {
            await submitBriefing({ indices: [indexA], sectors: [sectorA] });

            const readKey = readCacheKey();
            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ cacheKey: readKey })
            );
        });
    });

    describe('캐시 읽기가 실패할 때', () => {
        it('에러를 로깅하고 worker 제출로 진행한다 (캐시 장애가 제출을 막지 않음)', async () => {
            const consoleErrorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockCacheGet.mockRejectedValueOnce(new Error('cache down'));

            const result = await submitBriefing(mockData);

            expect(result.status).toBe('submitted');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[Briefing/Submit] Cache read failed:',
                expect.any(Error)
            );
            expect(mockFetch).toHaveBeenCalled();
            consoleErrorSpy.mockRestore();
        });
    });

    describe('Worker 요청이 실패할 때', () => {
        it('dispatch 에러를 로깅하지만 submitted를 반환한다', async () => {
            const consoleErrorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockFetch.mockRejectedValueOnce(new Error('network error'));

            const result = await submitBriefing(mockData);

            expect(result.status).toBe('submitted');
            // fire-and-forget dispatch 의 .catch 는 microtask 로 큐잉되므로,
            // macrotask(setTimeout 0)로 한 틱 양보해 대기 중인 microtask 가 모두
            // 비워진 뒤 .catch 가 실행 완료된 상태를 보장한다.
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[Briefing/Submit] Worker request failed:',
                expect.any(Error)
            );
            consoleErrorSpy.mockRestore();
        });
    });

    describe('job meta 저장이 실패할 때', () => {
        it('setJobMeta가 실패해도 submitted를 반환한다', async () => {
            const consoleErrorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockSetJobMeta.mockRejectedValueOnce(
                new Error('meta write failed')
            );

            const result = await submitBriefing(mockData);

            expect(result.status).toBe('submitted');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[Briefing/Submit] Failed to store job meta:',
                expect.any(Error)
            );
            expect(mockFetch).toHaveBeenCalled();
            consoleErrorSpy.mockRestore();
        });
    });
});
