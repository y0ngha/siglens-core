import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import type {
    AnalysisResponse,
    FearGreedSnapshot,
    TierConfig,
    Timeframe,
} from '@/domain/types';
import { EMPTY_SMC_RESULT } from '@/domain/indicators/constants';
import { getAllowedTimeframes } from '@/domain/tier';
import type { UsageRepository } from '@/domain/ports/usageRepository';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/infrastructure/skills/loader');
vi.mock('@/application/market/barsApi');
vi.mock('@/domain/analysis/prompt', () => ({
    buildAnalysisPrompt: vi.fn(() => 'mock-prompt'),
}));
vi.mock('@/domain/indicators/fearGreed', () => ({
    computeFearGreedIndex: vi.fn(),
}));

import { submitAnalysis } from '@/application/market/submitAnalysis';
import { DEFAULT_ANALYSIS_MODEL_ID } from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import { createSkillsProvider } from '@/infrastructure/skills/loader';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { computeFearGreedIndex } from '@/domain/indicators/fearGreed';
import { TEST_TIER_CONFIG } from '@/__tests__/helpers/testTierConfig';

const mockCreateCacheProvider = createCacheProvider as Mock;
const mockSetJobMeta = setJobMeta as Mock;
const mockFetchBarsWithIndicators = fetchBarsWithIndicators as Mock;
const mockBuildAnalysisPrompt = buildAnalysisPrompt as Mock;
const mockComputeFearGreedIndex = computeFearGreedIndex as Mock;

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

const fakeProvider: MarketDataProvider = {
    getBars: vi.fn().mockResolvedValue([]),
    getQuote: vi.fn().mockResolvedValue(null),
};

const mockSymbol = 'AAPL';
const mockCompanyName = 'Apple Inc.';
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
        (createSkillsProvider as Mock).mockReturnValue({
            loadSkills: mockLoadSkills,
        });
        mockCreateCacheProvider.mockReturnValue(mockCacheProvider);
        mockLoadSkills.mockResolvedValue([]);
        mockSetJobMeta.mockResolvedValue(undefined);
        mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
        mockFetchBarsWithIndicators.mockResolvedValue(mockBarsData);
        // Default fearGreed compute → null (matches real behavior on the
        // 1-bar fixture where walk-forward sampling is insufficient).
        // Individual tests override with mockReturnValueOnce when they need
        // a deterministic snapshot.
        mockComputeFearGreedIndex.mockReturnValue(null);
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
        vi.useRealTimers();
        vi.unstubAllGlobals();
        process.env = originalEnv;
    });

    describe('타임프레임 제한이 적용될 때', () => {
        it('요청자 tier가 타임프레임에 접근할 수 없으면 에러 결과를 반환한다', async () => {
            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                '5Min',
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierConfig: restrictedTierConfig,
                    tierContext: { userId: 'user-1', tier: 'free' },
                }
            );

            expect(result).toEqual({
                status: 'error',
                error: {
                    code: 'timeframe_not_allowed',
                    message: 'Timeframe 5Min is not available for free tier.',
                    tier: 'free',
                    timeframe: '5Min',
                    allowedTimeframes: getAllowedTimeframes(
                        'free',
                        restrictedTierConfig
                    ),
                },
            });
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockFetchBarsWithIndicators).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('제한이 꺼져 있으면 기본 free tier도 모든 타임프레임으로 요청할 수 있다', async () => {
            mockCacheGet.mockResolvedValueOnce(null);

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                '5Min',
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(result.status).toBe('submitted');
            expect(mockFetchBarsWithIndicators).toHaveBeenCalledWith(
                fakeProvider,
                mockSymbol,
                '5Min',
                undefined
            );
        });
    });

    describe('캐시 히트일 때', () => {
        it('cached 상태와 함께 결과를 반환한다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockResult);

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe
            );

            expect(result.status).toBe('cached');
            if (result.status === 'cached') {
                expect(result.result).toMatchObject(mockResult);
            }
            expect(mockFetchBarsWithIndicators).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('modelId가 포함된 캐시 키로 조회한다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockResult);

            await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    modelId: 'gemini-2.5-flash',
                }
            );

            expect(mockCacheGet).toHaveBeenCalledWith(
                'analysis:AAPL:1Day:gemini-2.5-flash'
            );
        });

        it('modelId가 없으면 기본 모델 ID를 포함한 캐시 키로 조회한다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockResult);

            await submitAnalysis(mockSymbol, mockCompanyName, mockTimeframe);

            expect(mockCacheGet).toHaveBeenCalledWith(
                `analysis:AAPL:1Day:${DEFAULT_ANALYSIS_MODEL_ID}`
            );
        });

        it('사용량 옵션이 있으면 캐시 결과 반환 후 분석 사용량을 기록한다', async () => {
            const occurredAt = new Date('2026-04-29T00:00:00.000Z');
            mockCacheGet.mockResolvedValueOnce(mockResult);

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierContext: { userId: 'user-1', tier: 'free' },
                    usage: {
                        usageRepository: mockUsageRepository,
                        clientIp: '203.0.113.10',
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
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierContext: { userId: null, tier: 'free' },
                    usage: {
                        usageRepository: mockUsageRepository,
                        clientIp: '203.0.113.10',
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
                mockCompanyName,
                mockTimeframe,
                true,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(result.status).toBe('submitted');
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockFetchBarsWithIndicators).toHaveBeenCalledWith(
                fakeProvider,
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
            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(mockFetchBarsWithIndicators).toHaveBeenCalledWith(
                fakeProvider,
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
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json',
                        'X-Worker-Secret': 'test-secret',
                    }),
                })
            );
            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(body.model).toBe(DEFAULT_ANALYSIS_MODEL_ID);
        });

        it('기존 공개 시그니처(symbol, timeframe, options)를 계속 지원한다', async () => {
            const result = await submitAnalysis(
                mockSymbol,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(result.status).toBe('submitted');
            expect(mockFetchBarsWithIndicators).toHaveBeenCalledWith(
                fakeProvider,
                mockSymbol,
                mockTimeframe,
                undefined
            );
            expect(mockFetch).toHaveBeenCalled();
        });

        it('사용량 옵션이 있으면 제한 확인 후 제출 성공 사용량을 기록한다', async () => {
            const occurredAt = new Date('2026-04-29T00:00:00.000Z');

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierConfig: restrictedTierConfig,
                    tierContext: { userId: null, tier: 'free' },
                    usage: {
                        usageRepository: mockUsageRepository,
                        clientIp: '203.0.113.10',
                        occurredAt,
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
                modelUsed: DEFAULT_ANALYSIS_MODEL_ID,
                occurredAt,
            });
        });

        it('modelId가 있고 modelUsed가 없으면 effectiveModelId로 사용량을 기록한다', async () => {
            const occurredAt = new Date('2026-04-29T00:00:00.000Z');

            await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    modelId: 'gemini-2.5-flash',
                    usage: {
                        usageRepository: mockUsageRepository,
                        clientIp: '203.0.113.10',
                        occurredAt,
                    },
                }
            );

            expect(mockRecordUsage).toHaveBeenCalledWith(
                expect.objectContaining({ modelUsed: 'gemini-2.5-flash' })
            );
        });

        it('사용량 발생 시각이 없으면 제한 확인과 기록에 같은 현재 시각을 사용한다', async () => {
            const currentTime = new Date('2026-04-29T23:59:59.999Z');
            vi.useFakeTimers();
            vi.setSystemTime(currentTime);

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierConfig: restrictedTierConfig,
                    tierContext: { userId: null, tier: 'free' },
                    usage: {
                        usageRepository: mockUsageRepository,
                        clientIp: '203.0.113.10',
                    },
                }
            );

            const checkedAt = mockGetUsageToday.mock.calls[0][1];
            const recordedAt = mockRecordUsage.mock.calls[0][0].occurredAt;

            expect(result.status).toBe('submitted');
            expect(checkedAt).toEqual(currentTime);
            expect(recordedAt).toBe(checkedAt);
        });

        it('사용량 기록이 실패해도 제출 성공 결과를 반환한다', async () => {
            const consoleWarn = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => undefined);
            const occurredAt = new Date('2026-04-29T00:00:00.000Z');
            mockRecordUsage.mockRejectedValueOnce(new Error('usage db failed'));

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierContext: { userId: null, tier: 'free' },
                    usage: {
                        usageRepository: mockUsageRepository,
                        clientIp: '203.0.113.10',
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
            const occurredAt = new Date('2026-04-29T00:00:00.000Z');
            mockGetUsageToday.mockResolvedValueOnce({
                analysis: 1,
                chatbot: 0,
            });

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierConfig: restrictedTierConfig,
                    tierContext: { userId: null, tier: 'free' },
                    usage: {
                        usageRepository: mockUsageRepository,
                        clientIp: '203.0.113.10',
                        occurredAt,
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

        it('usage check DB 오류 발생 시 fail-open으로 분석을 허용한다', async () => {
            const occurredAt = new Date('2026-04-29T00:00:00.000Z');
            const consoleWarn = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => undefined);
            mockGetUsageToday.mockRejectedValueOnce(
                new Error('DB connection failed')
            );

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierConfig: restrictedTierConfig,
                    tierContext: { userId: null, tier: 'free' },
                    usage: {
                        usageRepository: mockUsageRepository,
                        clientIp: '203.0.113.10',
                        occurredAt,
                    },
                }
            );

            expect(result.status).toBe('submitted');
            expect(consoleWarn).toHaveBeenCalledWith(
                '[checkUsageLimit] Usage check failed, allowing request:',
                expect.any(Error)
            );
            consoleWarn.mockRestore();
        });

        it('waitUntil이 제공되면 Worker 요청 promise를 등록한다', async () => {
            const waitUntil = vi.fn();

            await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    waitUntil,
                }
            );

            expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
        });

        it('WORKER_URL이 없으면 에러를 던진다', async () => {
            delete process.env.WORKER_URL;

            // marketDataProvider must be supplied so the provider guard (which
            // now runs before readWorkerConfig) does not short-circuit first.
            await expect(
                submitAnalysis(
                    mockSymbol,
                    mockCompanyName,
                    mockTimeframe,
                    false,
                    undefined,
                    { marketDataProvider: fakeProvider }
                )
            ).rejects.toThrow(
                'WORKER_URL and WORKER_SECRET environment variables are required'
            );
        });

        it('marketDataProvider가 없으면 에러를 던진다', async () => {
            // Guard sits after the cache check and skipEnqueueIfMiss early-return,
            // but before readWorkerConfig — omit marketDataProvider from options
            // to trigger the guard.
            await expect(
                submitAnalysis(
                    mockSymbol,
                    mockCompanyName,
                    mockTimeframe,
                    false,
                    undefined,
                    {}
                )
            ).rejects.toThrow('marketDataProvider');
        });

        it('Skills 로딩 실패 시에도 Worker에 요청을 보낸다', async () => {
            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockLoadSkills.mockRejectedValueOnce(new Error('load failed'));

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(result.status).toBe('submitted');
            expect(mockFetch).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        it('Worker body에 model을 포함한다', async () => {
            await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    modelId: 'gemini-2.5-flash',
                }
            );

            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(body.model).toBe('gemini-2.5-flash');
        });

        it('userApiKey가 있으면 X-AI-API-KEY 헤더를 포함한다', async () => {
            await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    userApiKey: 'sk-user-key-123',
                }
            );

            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'X-AI-API-KEY': 'sk-user-key-123',
                    }),
                })
            );
        });

        it('userApiKey가 없으면 X-AI-API-KEY 헤더를 포함하지 않는다', async () => {
            await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            const headers = mockFetch.mock.calls[0][1].headers as Record<
                string,
                string
            >;
            expect(headers['X-AI-API-KEY']).toBeUndefined();
        });
    });

    describe('fmpSymbol이 제공될 때', () => {
        beforeEach(() => {
            mockCacheGet.mockResolvedValueOnce(null);
        });

        it('fetchBarsWithIndicators에 fmpSymbol을 전달한다', async () => {
            const mockFmpSymbol = '^SPX';

            await submitAnalysis(
                'SPX',
                'S&P 500 Index',
                mockTimeframe,
                false,
                mockFmpSymbol,
                { marketDataProvider: fakeProvider }
            );

            expect(mockFetchBarsWithIndicators).toHaveBeenCalledWith(
                fakeProvider,
                'SPX',
                mockTimeframe,
                mockFmpSymbol
            );
        });
    });

    describe('캐시 프로바이더가 없을 때', () => {
        it('캐시 조회를 건너뛰고 Worker에 요청을 보낸다', async () => {
            mockCreateCacheProvider.mockReturnValue(null);

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

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
            await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ lastClose: 103 })
            );
        });

        it('modelId가 제공되면 jobMeta에 저장한다', async () => {
            await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    modelId: 'gemini-2.5-flash',
                }
            );

            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ modelId: 'gemini-2.5-flash' })
            );
        });

        it('modelId가 없으면 기본값으로 jobMeta에 저장한다', async () => {
            await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ modelId: DEFAULT_ANALYSIS_MODEL_ID })
            );
        });

        it('ATR이 있으면 마지막 non-null 값을 meta에 저장한다', async () => {
            mockFetchBarsWithIndicators.mockResolvedValueOnce({
                ...mockBarsData,
                indicators: { ...mockBarsData.indicators, atr: [null, 2.5, 3] },
            });

            await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

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

            await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ atr: undefined })
            );
        });

        it('ATR 배열이 비어있으면 undefined로 저장한다', async () => {
            await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ atr: undefined })
            );
        });
    });

    describe('submitAnalysis BYOK gate + tier forwarding', () => {
        const testTierConfig = TEST_TIER_CONFIG;

        beforeEach(() => {
            mockCacheGet.mockResolvedValueOnce(null);
        });

        it('returns user_api_key_required when non-pro tier requests premium model without BYOK', async () => {
            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierConfig: testTierConfig,
                    tierContext: { tier: 'member', userId: null },
                    modelId: 'gemini-2.5-pro',
                }
            );

            expect(result.status).toBe('key_error');
            if (result.status === 'key_error') {
                expect(result.code).toBe('user_api_key_required');
            }
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('error includes modelId and tier diagnostic fields', async () => {
            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierConfig: testTierConfig,
                    tierContext: { tier: 'member', userId: null },
                    modelId: 'gemini-2.5-pro',
                }
            );

            expect(result).toMatchObject({
                status: 'key_error',
                code: 'user_api_key_required',
                modelId: 'gemini-2.5-pro',
                tier: 'member',
            });
        });

        it('proceeds when non-pro tier requests premium model with BYOK', async () => {
            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierConfig: testTierConfig,
                    tierContext: { tier: 'member', userId: null },
                    modelId: 'gemini-2.5-pro',
                    userApiKey: 'usr-key',
                }
            );

            expect(result.status).toBe('submitted');
            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'X-AI-API-KEY': 'usr-key',
                    }),
                })
            );
            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(body.tier).toBe('member');
        });

        it('proceeds when pro tier requests premium model without BYOK', async () => {
            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierConfig: testTierConfig,
                    tierContext: { tier: 'pro', userId: null },
                    modelId: 'gemini-2.5-pro',
                }
            );

            expect(result.status).toBe('submitted');
            const fetchCall = mockFetch.mock.calls[0][1] as {
                headers: Record<string, string>;
                body: string;
            };
            expect(fetchCall.headers['X-AI-API-KEY']).toBeUndefined();
            const body = JSON.parse(fetchCall.body) as Record<string, unknown>;
            expect(body.tier).toBe('pro');
        });

        it('proceeds when any tier requests free model without BYOK', async () => {
            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierConfig: testTierConfig,
                    tierContext: { tier: 'free', userId: null },
                    modelId: 'gemini-2.5-flash',
                }
            );

            expect(result.status).toBe('submitted');
            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(body.tier).toBe('free');
        });

        it('forwards tier "free" when no tierContext provided', async () => {
            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierConfig: testTierConfig,
                    modelId: 'gemini-2.5-flash',
                }
            );

            expect(result.status).toBe('submitted');
            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(body.tier).toBe('free');
        });
    });

    describe('FearGreed snapshot 주입 시', () => {
        beforeEach(() => {
            mockCacheGet.mockResolvedValueOnce(null);
        });

        it('1Day 타임프레임이면 추가 fetch 없이 buildAnalysisPrompt 7번째 인자로 fearGreed가 전달된다', async () => {
            const mockSnapshot: FearGreedSnapshot = {
                score: 50,
                label: 'NEUTRAL',
                groups: [
                    { name: 'Flow', score: 50, factors: [] },
                    { name: 'Trend', score: 50, factors: [] },
                ],
                confidence: 'normal',
                sampleSize: 100,
                warning: null,
            };
            mockComputeFearGreedIndex.mockReturnValueOnce(mockSnapshot);

            await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                '1Day' as Timeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            // 추가 일봉 fetch 없이 1번만 호출됨.
            expect(mockFetchBarsWithIndicators).toHaveBeenCalledTimes(1);
            expect(mockFetchBarsWithIndicators).toHaveBeenCalledWith(
                fakeProvider,
                mockSymbol,
                '1Day',
                undefined
            );

            // buildAnalysisPrompt가 호출되었고, 7번째 인자(fearGreed)는 mock한
            // FearGreedSnapshot 객체와 정확히 동일해야 함.
            expect(mockBuildAnalysisPrompt).toHaveBeenCalledTimes(1);
            const args = mockBuildAnalysisPrompt.mock.calls[0];
            // Positional-arg assertion: if buildAnalysisPrompt's signature ever switches
            // to an options object, replace args[6] with args[0].fearGreed.
            const seventh = args[6];
            expect(seventh).toBe(mockSnapshot);
            expect(args.length).toBe(7);
        });

        it('1Day가 아닌 타임프레임이면 일봉 데이터를 추가로 fetch한다', async () => {
            await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                '4Hour' as Timeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(mockFetchBarsWithIndicators).toHaveBeenCalledTimes(2);
            expect(mockFetchBarsWithIndicators).toHaveBeenNthCalledWith(
                1,
                fakeProvider,
                mockSymbol,
                '4Hour',
                undefined
            );
            expect(mockFetchBarsWithIndicators).toHaveBeenNthCalledWith(
                2,
                fakeProvider,
                mockSymbol,
                '1Day',
                undefined
            );
        });

        it('일봉 fetch가 throw해도 분석은 fearGreed=undefined로 계속 진행된다', async () => {
            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            mockFetchBarsWithIndicators
                .mockResolvedValueOnce(mockBarsData) // 1차: 4Hour 정상
                .mockRejectedValueOnce(new Error('daily fetch failed')); // 2차: 1Day 실패

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                '4Hour' as Timeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(result.status).toBe('submitted');
            expect(consoleSpy).toHaveBeenCalledWith(
                '[Submit] FearGreed daily fetch/compute failed; proceeding without sentiment:',
                expect.any(Error)
            );

            // buildAnalysisPrompt 7번째 인자는 undefined여야 함.
            expect(mockBuildAnalysisPrompt).toHaveBeenCalledTimes(1);
            const args = mockBuildAnalysisPrompt.mock.calls[0];
            expect(args[6]).toBeUndefined();

            consoleSpy.mockRestore();
        });
    });

    describe('skipEnqueueIfMiss 옵션이 true일 때', () => {
        beforeEach(() => {
            // 이 파일의 다른 테스트들이 mockResolvedValueOnce 큐를 남기는
            // 경우가 있어 격리 차원에서 reset (vi.clearAllMocks는 큐를 지우지 않음).
            mockCacheGet.mockReset();
        });

        it('캐시 미스이면 워커를 트리거하지 않고 miss_no_trigger를 반환한다', async () => {
            mockCacheGet.mockResolvedValue(null);

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider, skipEnqueueIfMiss: true }
            );

            expect(result).toEqual({ status: 'miss_no_trigger' });
            expect(mockFetchBarsWithIndicators).not.toHaveBeenCalled();
            expect(mockSetJobMeta).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('캐시 히트면 평소처럼 cached 결과를 반환한다', async () => {
            mockCacheGet.mockResolvedValue(mockResult);

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider, skipEnqueueIfMiss: true }
            );

            expect(result.status).toBe('cached');
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('marketDataProvider가 제공되면 캐시 미스 시 submitted를 반환한다', async () => {
            mockCacheGet.mockResolvedValue(null);

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(result.status).toBe('submitted');
            expect(mockFetch).toHaveBeenCalled();
        });
    });
});
