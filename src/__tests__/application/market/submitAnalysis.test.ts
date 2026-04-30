import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import type { AnalysisResponse, TierConfig, Timeframe } from '@/domain/types';
import { EMPTY_SMC_RESULT } from '@/domain/indicators/constants';
import type { UsageRepository } from '@/infrastructure/db';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/infrastructure/skills/loader');
vi.mock('@/application/market/barsApi');

import { submitAnalysis } from '@/application/market/submitAnalysis';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { FileSkillsLoader } from '@/infrastructure/skills/loader';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';

const mockCreateCacheProvider = createCacheProvider as Mock;
const mockSetJobMeta = setJobMeta as Mock;
const mockFetchBarsWithIndicators = fetchBarsWithIndicators as Mock;

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheProvider = {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: vi.fn(),
};

const mockLoadSkills = vi.fn();
const mockFetch = vi.fn();
const mockRecordUsage = vi.fn();
const mockGetUsageToday = vi.fn();
const mockUsageRepository: UsageRepository = {
    recordUsage: mockRecordUsage,
    getUsageToday: mockGetUsageToday,
};

const mockSymbol = 'AAPL';
const mockTimeframe: Timeframe = '1Day';

const mockBarsData = {
    bars: [
        {
            time: 1705312200,
            open: 100,
            high: 105,
            low: 99,
            close: 103,
            volume: 1000000,
        },
    ],
    indicators: {
        macd: [],
        bollinger: [],
        dmi: [],
        stochastic: [],
        stochRsi: [],
        rsi: [],
        cci: [],
        vwap: [],
        ma: {},
        ema: {},
        volumeProfile: null,
        ichimoku: [],
        atr: [],
        obv: [],
        parabolicSar: [],
        williamsR: [],
        supertrend: [],
        mfi: [],
        keltnerChannel: [],
        cmf: [],
        donchianChannel: [],
        buySellVolume: [],
        squeezeMomentum: [],
        smc: EMPTY_SMC_RESULT,
    },
};

const mockResult: AnalysisResponse = {
    summary: '테스트',
    trend: 'bullish' as const,
    indicatorResults: [],
    riskLevel: 'low' as const,
    keyLevels: { support: [], resistance: [] },
    priceTargets: {
        bullish: { targets: [], condition: '' },
        bearish: { targets: [], condition: '' },
    },
    patternSummaries: [],
    strategyResults: [],
    candlePatterns: [],
    trendlines: [],
};

const restrictedTierConfig: TierConfig = {
    limits: {
        analysisPerDay: { free: 1, member: Infinity, pro: Infinity },
        chatbotPerDay: { free: Infinity, member: Infinity, pro: Infinity },
    },
    timeframes: { free: ['1Day'], member: ['1Day'], pro: ['1Day'] },
    infoDepth: { free: ['summary'], member: ['summary'], pro: ['summary'] },
    models: {
        free: ['gemini-2.5-flash'],
        member: ['gemini-2.5-flash'],
        pro: ['gemini-2.5-flash'],
    },
    featureFlags: { enableTierRestrictions: true },
};

describe('submitAnalysis 함수는', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', mockFetch);
        process.env = {
            ...originalEnv,
            WORKER_URL: 'https://worker.test',
            WORKER_SECRET: 'test-secret',
        };
        (FileSkillsLoader as Mock).mockImplementation(() => ({
            loadSkills: mockLoadSkills,
        }));
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockLoadSkills.mockResolvedValue([]);
        mockSetJobMeta.mockResolvedValue(undefined);
        mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
        mockFetchBarsWithIndicators.mockResolvedValue(mockBarsData);
        mockGetUsageToday.mockResolvedValue({ analysis: 0, chatbot: 0 });
        mockRecordUsage.mockResolvedValue({
            id: 'usage-1',
            userId: null,
            ipHash: 'hashed-ip',
            actionType: 'analysis',
            modelUsed: 'analysis-worker',
            date: '2026-04-29',
            createdAt: new Date('2026-04-29T00:00:00.000Z'),
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        process.env = originalEnv;
    });

    describe('캐시 히트일 때', () => {
        it('cached 상태와 함께 결과를 반환한다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockResult);

            const result = await submitAnalysis(mockSymbol, mockTimeframe);

            expect(result.status).toBe('cached');
            if (result.status === 'cached') {
                expect(result.result).toBe(mockResult);
            }
            expect(mockFetchBarsWithIndicators).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('사용량 옵션이 있으면 캐시 결과 반환 후 분석 사용량을 기록한다', async () => {
            const occurredAt = new Date('2026-04-29T00:00:00.000Z');
            mockCacheGet.mockResolvedValueOnce(mockResult);

            const result = await submitAnalysis(
                mockSymbol,
                mockTimeframe,
                false,
                undefined,
                {
                    usage: {
                        usageRepository: mockUsageRepository,
                        clientIp: '203.0.113.10',
                        tier: 'free',
                        userId: 'user-1',
                        modelUsed: 'cached-analysis',
                        occurredAt,
                    },
                }
            );

            expect(result.status).toBe('cached');
            expect(mockRecordUsage).toHaveBeenCalledWith({
                userId: 'user-1',
                ipAddress: '203.0.113.10',
                actionType: 'analysis',
                modelUsed: 'cached-analysis',
                occurredAt,
            });
        });

        it('사용량 기록이 실패해도 캐시 결과를 반환한다', async () => {
            const consoleWarn = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => undefined);
            const occurredAt = new Date('2026-04-29T00:00:00.000Z');
            mockCacheGet.mockResolvedValueOnce(mockResult);
            mockRecordUsage.mockRejectedValueOnce(new Error('usage db failed'));

            const result = await submitAnalysis(
                mockSymbol,
                mockTimeframe,
                false,
                undefined,
                {
                    usage: {
                        usageRepository: mockUsageRepository,
                        clientIp: '203.0.113.10',
                        tier: 'free',
                        occurredAt,
                    },
                }
            );

            expect(result).toEqual({ status: 'cached', result: mockResult });
            expect(consoleWarn).toHaveBeenCalledWith(
                '[recordAnalysisUsageSafely] Failed to record analysis usage:',
                expect.any(Error)
            );
            consoleWarn.mockRestore();
        });

        it('force가 true이면 캐시를 건너뛰고 Worker에 요청을 보낸다', async () => {
            const result = await submitAnalysis(
                mockSymbol,
                mockTimeframe,
                true
            );

            expect(result.status).toBe('submitted');
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockFetchBarsWithIndicators).toHaveBeenCalledWith(
                mockSymbol,
                mockTimeframe,
                undefined
            );
            expect(mockFetch).toHaveBeenCalled();
        });
    });

    describe('캐시 미스일 때', () => {
        beforeEach(() => {
            mockCacheGet.mockResolvedValueOnce(null);
        });

        it('fetchBarsWithIndicators를 호출하고 Worker에 요청을 보낸 뒤 jobId를 반환한다', async () => {
            const result = await submitAnalysis(mockSymbol, mockTimeframe);

            expect(mockFetchBarsWithIndicators).toHaveBeenCalledWith(
                mockSymbol,
                mockTimeframe,
                undefined
            );
            expect(result.status).toBe('submitted');
            if (result.status === 'submitted') {
                expect(result.jobId).toBeDefined();
                expect(typeof result.jobId).toBe('string');
            }
            expect(mockSetJobMeta).toHaveBeenCalled();
            expect(mockFetch).toHaveBeenCalledWith(
                'https://worker.test/analyze',
                expect.objectContaining({
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Worker-Secret': 'test-secret',
                    },
                })
            );
        });

        it('사용량 옵션이 있으면 제한 확인 후 제출 성공 사용량을 기록한다', async () => {
            const occurredAt = new Date('2026-04-29T00:00:00.000Z');

            const result = await submitAnalysis(
                mockSymbol,
                mockTimeframe,
                false,
                undefined,
                {
                    usage: {
                        usageRepository: mockUsageRepository,
                        clientIp: '203.0.113.10',
                        tier: 'free',
                        occurredAt,
                        tierConfig: restrictedTierConfig,
                    },
                }
            );

            expect(result.status).toBe('submitted');
            expect(mockGetUsageToday).toHaveBeenCalledWith(
                expect.any(String),
                occurredAt
            );
            expect(mockRecordUsage).toHaveBeenCalledWith({
                userId: null,
                ipAddress: '203.0.113.10',
                actionType: 'analysis',
                modelUsed: 'analysis-worker',
                occurredAt,
            });
        });

        it('사용량 기록이 실패해도 제출 성공 결과를 반환한다', async () => {
            const consoleWarn = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => undefined);
            const occurredAt = new Date('2026-04-29T00:00:00.000Z');
            mockRecordUsage.mockRejectedValueOnce(new Error('usage db failed'));

            const result = await submitAnalysis(
                mockSymbol,
                mockTimeframe,
                false,
                undefined,
                {
                    usage: {
                        usageRepository: mockUsageRepository,
                        clientIp: '203.0.113.10',
                        tier: 'free',
                        occurredAt,
                    },
                }
            );

            expect(result.status).toBe('submitted');
            expect(mockFetch).toHaveBeenCalled();
            expect(consoleWarn).toHaveBeenCalledWith(
                '[recordAnalysisUsageSafely] Failed to record analysis usage:',
                expect.any(Error)
            );
            consoleWarn.mockRestore();
        });

        it('분석 사용량 제한을 넘으면 구조화된 error를 반환하고 Worker 요청을 건너뛴다', async () => {
            mockGetUsageToday.mockResolvedValueOnce({
                analysis: 1,
                chatbot: 0,
            });

            const result = await submitAnalysis(
                mockSymbol,
                mockTimeframe,
                false,
                undefined,
                {
                    usage: {
                        usageRepository: mockUsageRepository,
                        clientIp: '203.0.113.10',
                        tier: 'free',
                        tierConfig: restrictedTierConfig,
                    },
                }
            );

            expect(result).toEqual({
                status: 'error',
                error: {
                    code: 'analysis_limit_exceeded',
                    message: 'Daily analysis usage limit exceeded.',
                    feature: 'analysisPerDay',
                    tier: 'free',
                },
            });
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockFetchBarsWithIndicators).not.toHaveBeenCalled();
            expect(mockRecordUsage).not.toHaveBeenCalled();
        });

        it('waitUntil이 제공되면 Worker 요청 promise를 등록한다', async () => {
            const waitUntil = vi.fn();

            await submitAnalysis(mockSymbol, mockTimeframe, false, undefined, {
                waitUntil,
            });

            expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
        });

        it('WORKER_URL이 없으면 에러를 던진다', async () => {
            delete process.env.WORKER_URL;

            await expect(
                submitAnalysis(mockSymbol, mockTimeframe)
            ).rejects.toThrow(
                'WORKER_URL and WORKER_SECRET environment variables are required'
            );
        });

        it('Skills 로딩 실패 시에도 Worker에 요청을 보낸다', async () => {
            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockLoadSkills.mockRejectedValueOnce(new Error('load failed'));

            const result = await submitAnalysis(mockSymbol, mockTimeframe);

            expect(result.status).toBe('submitted');
            expect(mockFetch).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    describe('fmpSymbol이 제공될 때', () => {
        beforeEach(() => {
            mockCacheGet.mockResolvedValueOnce(null);
        });

        it('fetchBarsWithIndicators에 fmpSymbol을 전달한다', async () => {
            const mockFmpSymbol = '^SPX';

            await submitAnalysis('SPX', mockTimeframe, false, mockFmpSymbol);

            expect(mockFetchBarsWithIndicators).toHaveBeenCalledWith(
                'SPX',
                mockTimeframe,
                mockFmpSymbol
            );
        });
    });

    describe('캐시 프로바이더가 없을 때', () => {
        it('캐시 조회를 건너뛰고 Worker에 요청을 보낸다', async () => {
            mockCreateCacheProvider.mockReturnValue(null);

            const result = await submitAnalysis(mockSymbol, mockTimeframe);

            expect(result.status).toBe('submitted');
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockFetch).toHaveBeenCalled();
        });
    });

    describe('JobMeta에 reconcile 기준값 저장', () => {
        beforeEach(() => {
            mockCacheGet.mockResolvedValueOnce(null);
        });

        it('마지막 bar 종가(lastClose)를 meta에 저장한다', async () => {
            await submitAnalysis(mockSymbol, mockTimeframe);

            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ lastClose: 103 })
            );
        });

        it('ATR이 있으면 마지막 non-null 값을 meta에 저장한다', async () => {
            mockFetchBarsWithIndicators.mockResolvedValueOnce({
                ...mockBarsData,
                indicators: { ...mockBarsData.indicators, atr: [null, 2.5, 3] },
            });

            await submitAnalysis(mockSymbol, mockTimeframe);

            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ atr: 3 })
            );
        });

        it('ATR이 모두 null이면 undefined로 저장한다', async () => {
            mockFetchBarsWithIndicators.mockResolvedValueOnce({
                ...mockBarsData,
                indicators: {
                    ...mockBarsData.indicators,
                    atr: [null, null],
                },
            });

            await submitAnalysis(mockSymbol, mockTimeframe);

            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ atr: undefined })
            );
        });

        it('ATR 배열이 비어있으면 undefined로 저장한다', async () => {
            await submitAnalysis(mockSymbol, mockTimeframe);

            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ atr: undefined })
            );
        });
    });
});
