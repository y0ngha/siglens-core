import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import type {
    AnalysisResponse,
    FearGreedSnapshot,
    Skill,
    TierConfig,
    Timeframe,
} from '@/domain/types';
import {
    EMPTY_INDICATOR_RESULT,
    EMPTY_SMC_RESULT,
} from '@/domain/indicators/constants';
import { getAllowedTimeframes } from '@/domain/tier';
import type { UsageRepository } from '@/domain/ports/usageRepository';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';

vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/jobs/queue');
vi.mock('@/infrastructure/skills/loader');
vi.mock('@/application/market/barsApi');
vi.mock('@/domain/analysis/prompt', () => ({
    // `buildAnalysisPrompt` returns `{ stable, dynamic }` (spec §3.4 assembly
    // split) — the two halves are joined with the same '\n\n' the production
    // dispatch site uses, so `body.prompt`/`body.seed` assertions below stay
    // meaningful.
    buildAnalysisPrompt: vi.fn(() => ({
        stable: 'mock-stable',
        dynamic: 'mock-dynamic',
    })),
}));
vi.mock('@/domain/indicators/fearGreed', () => ({
    computeFearGreedIndex: vi.fn(),
}));
// Real implementation by default (fixture bars are too sparse to match any
// classifier anyway); individual tests override `screenChartPatterns` with
// `mockImplementationOnce` to exercise the observe-only failure path.
vi.mock('@/domain/patterns', async importOriginal => {
    const actual = await importOriginal<typeof import('@/domain/patterns')>();
    return {
        ...actual,
        screenChartPatterns: vi.fn(actual.screenChartPatterns),
    };
});

import {
    submitAnalysis,
    submitAnalysisForOverall,
} from '@/application/market/submitAnalysis';
import {
    DEFAULT_ANALYSIS_MODEL_ID,
    PROMPT_TEMPLATE_VERSION,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import {
    analysisSeed,
    hashSkillCatalog,
} from '@/infrastructure/hash/analysisInput';
import { setJobMeta } from '@/infrastructure/jobs/queue';
import {
    createSkillsProvider,
    loadSkillsCached,
} from '@/infrastructure/skills/loader';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { AI_SYSTEM_PROMPT } from '@/domain/analysis/systemPrompt';
import { computeFearGreedIndex } from '@/domain/indicators/fearGreed';
import { screenChartPatterns } from '@/domain/patterns';
import { TEST_TIER_CONFIG } from '@/__tests__/helpers/testTierConfig';

/** Fingerprint of the empty skill catalog the loader stub returns by default. */
const EMPTY_CATALOG_FP = hashSkillCatalog([]);
/** Default free-tier cache-key suffix: prompt version + tier + fingerprint. */
const KEY_SUFFIX = `${PROMPT_TEMPLATE_VERSION}:free:${EMPTY_CATALOG_FP}`;

const mockCreateCacheProvider = createCacheProvider as Mock;
const mockSetJobMeta = setJobMeta as Mock;
const mockFetchBarsWithIndicators = fetchBarsWithIndicators as Mock;
const mockBuildAnalysisPrompt = buildAnalysisPrompt as Mock;
const mockComputeFearGreedIndex = computeFearGreedIndex as Mock;
const mockScreenChartPatterns = screenChartPatterns as Mock;

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
        ...EMPTY_INDICATOR_RESULT,
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
        // The empty catalog produces the same sampled fingerprint for every tier.
        (loadSkillsCached as Mock).mockResolvedValue({
            skills: [],
            skillsDegraded: false,
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

        it('기본 free tier는 5Min 요청 시 에러 결과를 반환한다', async () => {
            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                '5Min',
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(result).toEqual({
                status: 'error',
                error: {
                    code: 'timeframe_not_allowed',
                    message: 'Timeframe 5Min is not available for free tier.',
                    tier: 'free',
                    timeframe: '5Min',
                    allowedTimeframes: ['1Day'],
                },
            });
            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(mockFetchBarsWithIndicators).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('기본 free tier는 1Day 요청을 제출할 수 있다', async () => {
            mockCacheGet.mockResolvedValueOnce(null);

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                '1Day',
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(result.status).toBe('submitted');
            expect(mockFetchBarsWithIndicators).toHaveBeenCalledWith(
                fakeProvider,
                mockSymbol,
                '1Day',
                undefined
            );
        });

        it('member tier의 5Min 요청은 타임프레임 게이트에서 차단되지 않고 제출된다', async () => {
            mockCacheGet.mockResolvedValueOnce(null);

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                '5Min',
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierContext: { userId: null, tier: 'member' },
                }
            );

            expect(result.status).toBe('submitted');
            expect(mockFetchBarsWithIndicators).toHaveBeenCalledWith(
                fakeProvider,
                mockSymbol,
                '5Min',
                undefined
            );
            expect(mockFetch).toHaveBeenCalled();
        });

        it('legacy unrestricted custom config allows free tier to request 5Min', async () => {
            mockCacheGet.mockResolvedValueOnce(null);

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                '5Min',
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierConfig: {
                        ...restrictedTierConfig,
                        featureFlags: { enableTierRestrictions: false },
                    },
                }
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
                expect(result.result).toMatchObject({
                    summary: mockResult.summary,
                    trend: mockResult.trend,
                    indicatorResults: null,
                    keyLevels: null,
                });
                expect(result.lockedInfoDepth).toContain('partial_detail');
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
                `analysis:AAPL:1Day:gemini-2.5-flash:${KEY_SUFFIX}`
            );
        });

        it('modelId가 없으면 기본 모델 ID를 포함한 캐시 키로 조회한다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockResult);

            await submitAnalysis(mockSymbol, mockCompanyName, mockTimeframe);

            expect(mockCacheGet).toHaveBeenCalledWith(
                `analysis:AAPL:1Day:${DEFAULT_ANALYSIS_MODEL_ID}:${KEY_SUFFIX}`
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

            expect(result).toMatchObject({
                status: 'cached',
                result: {
                    summary: mockResult.summary,
                    trend: mockResult.trend,
                },
                lockedInfoDepth: expect.arrayContaining(['partial_detail']),
            });
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

    describe('submitAnalysisForOverall (internal visibility) 캐시 히트일 때', () => {
        it('free tier 호출자여도 필터링 없이 전체 AnalysisResponse를 반환하고 lockedInfoDepth는 빈 배열이다', async () => {
            mockCacheGet.mockResolvedValueOnce(mockResult);

            const result = await submitAnalysisForOverall(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierContext: { userId: null, tier: 'free' },
                }
            );

            expect(result.status).toBe('cached');
            if (result.status === 'cached') {
                // Unfiltered: gated fields stay populated instead of being
                // nulled out by filterAnalysisResult, because the 'internal'
                // response visibility branch (submitAnalysis.ts) bypasses
                // paywall filtering for overall prompt composition.
                expect(result.result.indicatorResults).not.toBeNull();
                expect(result.result.indicatorResults).toEqual(
                    mockResult.indicatorResults
                );
                expect(result.result.keyLevels).not.toBeNull();
                expect(result.result.keyLevels).toEqual(mockResult.keyLevels);
                expect(result.result).toMatchObject({
                    summary: mockResult.summary,
                    trend: mockResult.trend,
                });
                expect(result.lockedInfoDepth).toEqual([]);
            }
            expect(mockFetchBarsWithIndicators).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
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
            expect(body.analysisType).toBe('technical');
            // Design C: the always-on skill digest (`stable`) folds into the
            // SYSTEM prompt; `prompt` is `dynamic` alone. No promptStable/
            // promptDynamic split fields on the dispatch body.
            expect(body.system).toBe(`${AI_SYSTEM_PROMPT}\n\nmock-stable`);
            expect(body.prompt).toBe('mock-dynamic');
            expect(body.promptStable).toBeUndefined();
            expect(body.promptDynamic).toBeUndefined();
            expect(body.seed).toBe(
                analysisSeed(
                    `${body.system as string}\n\n${body.prompt as string}`
                )
            );
        });

        it('cache miss 시 marketDataProvider를 주입하면 submitted를 반환한다', async () => {
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

        it('Skills 로딩이 degraded여도 Worker에 요청을 보낸다', async () => {
            // loadSkillsCached catches its own failures and reports
            // skillsDegraded: true; submission must still proceed.
            (loadSkillsCached as Mock).mockResolvedValueOnce({
                skills: [],
                skillsDegraded: true,
            });

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
            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ skillsDegraded: true })
            );
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

    describe('reasoning 토글이 적용될 때 (member-reasoning-toggle spec Part A)', () => {
        it('reasoning: true이면 Worker body에 reasoning: true를 포함하고 :reason=on 캐시 키로 조회한다', async () => {
            mockCacheGet.mockReset();
            mockCacheGet.mockResolvedValueOnce(null);

            await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider, reasoning: true }
            );

            expect(mockCacheGet).toHaveBeenCalledWith(
                `analysis:AAPL:1Day:${DEFAULT_ANALYSIS_MODEL_ID}:${KEY_SUFFIX}:reason=on`
            );
            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(body.reasoning).toBe(true);
            expect(mockSetJobMeta).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ reasoning: true })
            );
        });

        it('reasoning을 생략하면 Worker body에 reasoning 필드가 없고 기존 캐시 키와 동일하다 (하위 호환)', async () => {
            mockCacheGet.mockReset();
            mockCacheGet.mockResolvedValueOnce(null);

            await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(mockCacheGet).toHaveBeenCalledWith(
                `analysis:AAPL:1Day:${DEFAULT_ANALYSIS_MODEL_ID}:${KEY_SUFFIX}`
            );
            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(body.reasoning).toBeUndefined();
        });

        it('reasoning: false이면 Worker body에 reasoning 필드가 없다 (off는 keyless와 동일 취급)', async () => {
            mockCacheGet.mockReset();
            mockCacheGet.mockResolvedValueOnce(null);

            await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider, reasoning: false }
            );

            expect(mockCacheGet).toHaveBeenCalledWith(
                `analysis:AAPL:1Day:${DEFAULT_ANALYSIS_MODEL_ID}:${KEY_SUFFIX}`
            );
            const body = JSON.parse(
                mockFetch.mock.calls[0][1].body as string
            ) as Record<string, unknown>;
            expect(body.reasoning).toBeUndefined();
        });

        it('reasoning: true 캐시 히트 시 cached 상태를 반환한다', async () => {
            mockCacheGet.mockReset();
            mockCacheGet.mockResolvedValueOnce(mockResult);

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider, reasoning: true }
            );

            expect(result.status).toBe('cached');
            expect(mockCacheGet).toHaveBeenCalledWith(
                `analysis:AAPL:1Day:${DEFAULT_ANALYSIS_MODEL_ID}:${KEY_SUFFIX}:reason=on`
            );
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

        it('sampled catalog is identical라도 tier-scoped cacheKey를 저장한다', async () => {
            const skills: Skill[] = Array.from({ length: 2 }, (_, index) => ({
                name: `pattern-${index}`,
                description: `pattern-${index}`,
                type: 'pattern',
                indicators: [],
                confidenceWeight: 1,
                content: `pattern-${index}`,
            }));
            (loadSkillsCached as Mock).mockResolvedValue({
                skills,
                skillsDegraded: false,
            });
            mockCacheGet.mockResolvedValue(null);

            await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );
            const freeMeta = mockSetJobMeta.mock.calls.at(-1)?.[1] as {
                cacheKey: string;
            };
            const freePromptSkills = mockBuildAnalysisPrompt.mock.calls.at(
                -1
            )?.[4] as Skill[];

            await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierContext: { userId: 'member-1', tier: 'member' },
                }
            );
            const memberMeta = mockSetJobMeta.mock.calls.at(-1)?.[1] as {
                cacheKey: string;
            };
            const memberPromptSkills = mockBuildAnalysisPrompt.mock.calls.at(
                -1
            )?.[4] as Skill[];

            expect(freePromptSkills).toHaveLength(2);
            expect(memberPromptSkills).toHaveLength(2);
            expect(freeMeta.cacheKey).not.toBe(memberMeta.cacheKey);
            expect(freeMeta.cacheKey).toContain('free:');
            expect(memberMeta.cacheKey).toContain('member:');
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
            // crypto phase adds an 8th arg (assetClass, defaulting to 'equity').
            expect(args.length).toBe(8);
        });

        it('1Day가 아닌 타임프레임이면 일봉 데이터를 추가로 fetch한다', async () => {
            await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                '4Hour' as Timeframe,
                false,
                undefined,
                {
                    marketDataProvider: fakeProvider,
                    tierContext: { userId: null, tier: 'member' },
                }
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
                {
                    marketDataProvider: fakeProvider,
                    tierContext: { userId: null, tier: 'member' },
                }
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

    describe('인자 해석(short overload)의 선택적 인자 폴백', () => {
        beforeEach(() => {
            mockCacheGet.mockReset();
        });

        it('short overload에서 force/fmpSymbol/options를 모두 생략하면 기본값으로 폴백한다', async () => {
            // (symbol, timeframe) 형태의 short overload만 호출 → companyNameOrTimeframe가
            // 타임프레임으로 인식되는 첫 번째 브랜치 진입.
            // timeframeOrForce가 boolean이 아니므로 force=false(80번 라인),
            // forceOrFmpSymbol이 string이 아니므로 fmpSymbol=undefined(84번 라인),
            // fmpSymbolOrOptions가 object가 아니므로 options={}(89번 라인)로 폴백.
            // options={}이면 marketDataProvider가 없으므로 캐시 히트로 fetch 경로를 회피.
            mockCacheGet.mockResolvedValue(mockResult);

            const result = await submitAnalysis(mockSymbol, mockTimeframe);

            expect(result.status).toBe('cached');
            // companyName은 symbol로 폴백(첫 번째 브랜치) → 캐시 키는 symbol 기준.
            expect(mockCacheGet).toHaveBeenCalledWith(
                `analysis:${mockSymbol}:${mockTimeframe}:${DEFAULT_ANALYSIS_MODEL_ID}:${KEY_SUFFIX}`
            );
            expect(mockFetchBarsWithIndicators).not.toHaveBeenCalled();
        });

        it('short overload에서 fmpSymbol을 문자열로 넘기면 그대로 사용한다', async () => {
            // (symbol, timeframe, force, fmpSymbol) 형태 → forceOrFmpSymbol이 string이므로
            // fmpSymbol에 그 문자열이 그대로 들어감(83번 라인 then-브랜치).
            mockCacheGet.mockResolvedValue(null);

            const result = await submitAnalysis(
                mockSymbol,
                mockTimeframe,
                false,
                '^SPX',
                { marketDataProvider: fakeProvider }
            );

            expect(result.status).toBe('submitted');
            expect(mockFetchBarsWithIndicators).toHaveBeenCalledWith(
                fakeProvider,
                mockSymbol,
                mockTimeframe,
                '^SPX'
            );
        });
    });

    describe('인자 해석(long overload)의 options 위치 폴백', () => {
        beforeEach(() => {
            mockCacheGet.mockReset();
        });

        it('long overload에서 options를 5번째 인자(fmpSymbol 슬롯)로 넘기면 options로 해석한다', async () => {
            // (symbol, companyName, timeframe, force, options) 형태 →
            // maybeOptions는 undefined, fmpSymbolOrOptions가 object이므로
            // 중첩 삼항(104-105번 라인)에서 fmpSymbolOrOptions를 options로 사용.
            mockCacheGet.mockResolvedValue(null);

            // 타입상 5번째 인자는 fmpSymbol(string)이지만, 구현은 object가
            // 오면 options로 해석하는 런타임 폴백을 가진다. 그 방어 경로를
            // 검증하기 위해 의도적으로 캐스팅해 호출한다.
            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                {
                    marketDataProvider: fakeProvider,
                    modelId: 'gemini-2.5-flash',
                } as unknown as string
            );

            expect(result.status).toBe('submitted');
            // options.modelId가 정상 해석되었음을 캐시 키로 확인.
            expect(mockCacheGet).toHaveBeenCalledWith(
                `analysis:${mockSymbol}:${mockTimeframe}:gemini-2.5-flash:${KEY_SUFFIX}`
            );
            expect(mockFetchBarsWithIndicators).toHaveBeenCalledWith(
                fakeProvider,
                mockSymbol,
                mockTimeframe,
                undefined
            );
        });
    });

    describe('캐시 조회가 실패할 때', () => {
        beforeEach(() => {
            mockCacheGet.mockReset();
        });

        it('cache.get이 reject하면 에러를 로깅하고 캐시 미스로 처리해 Worker에 제출한다', async () => {
            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockCacheGet.mockRejectedValue(new Error('redis down'));

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(result.status).toBe('submitted');
            expect(consoleSpy).toHaveBeenCalledWith(
                '[Submit] Cache read failed:',
                expect.any(Error)
            );
            expect(mockFetchBarsWithIndicators).toHaveBeenCalled();
            expect(mockFetch).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    describe('Worker fetch가 실패할 때', () => {
        beforeEach(() => {
            mockCacheGet.mockReset();
        });

        it('fetch가 reject해도 에러를 로깅만 하고 submitted를 반환한다', async () => {
            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            mockCacheGet.mockResolvedValue(null);
            mockFetch.mockRejectedValueOnce(new Error('network error'));
            // dispatch promise가 등록되어 .catch가 실행되도록 waitUntil로 완료를 기다린다.
            const pending: Promise<unknown>[] = [];
            const waitUntil = (p: Promise<unknown>) => {
                pending.push(p);
            };

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider, waitUntil }
            );

            await Promise.all(pending);

            expect(result.status).toBe('submitted');
            expect(consoleSpy).toHaveBeenCalledWith(
                '[Submit] Worker request failed:',
                expect.any(Error)
            );
            consoleSpy.mockRestore();
        });
    });

    describe('패턴 스크리너 observe-only 로깅', () => {
        beforeEach(() => {
            mockCacheGet.mockResolvedValueOnce(null);
        });

        it('제출 성공 시 [PatternScreen] 로그를 남긴다', async () => {
            const consoleInfoSpy = vi
                .spyOn(console, 'info')
                .mockImplementation(() => undefined);

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(result.status).toBe('submitted');
            expect(consoleInfoSpy).toHaveBeenCalledWith(
                '[PatternScreen]',
                expect.any(String)
            );
            consoleInfoSpy.mockRestore();
        });

        it('스크리너가 throw해도 제출은 성공하고 실패를 로깅한다', async () => {
            const consoleErrorSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            // atr must be defined for observePatternCandidates to actually
            // invoke screenChartPatterns (see the atr-undefined test below).
            mockFetchBarsWithIndicators.mockResolvedValueOnce({
                ...mockBarsData,
                indicators: { ...mockBarsData.indicators, atr: [null, 2.5, 3] },
            });
            mockScreenChartPatterns.mockImplementationOnce(() => {
                throw new Error('classifier exploded');
            });

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(result.status).toBe('submitted');
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '[PatternScreen] failed:',
                expect.any(Error)
            );
            consoleErrorSpy.mockRestore();
        });

        it('ATR이 없으면 스크리너를 호출하지 않고 candidates: [] 를 로깅한다', async () => {
            const consoleInfoSpy = vi
                .spyOn(console, 'info')
                .mockImplementation(() => undefined);
            mockFetchBarsWithIndicators.mockResolvedValueOnce({
                ...mockBarsData,
                indicators: { ...mockBarsData.indicators, atr: [null, null] },
            });

            const result = await submitAnalysis(
                mockSymbol,
                mockCompanyName,
                mockTimeframe,
                false,
                undefined,
                { marketDataProvider: fakeProvider }
            );

            expect(result.status).toBe('submitted');
            expect(mockScreenChartPatterns).not.toHaveBeenCalled();
            expect(consoleInfoSpy).toHaveBeenCalledWith(
                '[PatternScreen]',
                expect.stringContaining('"candidates":[]')
            );
            consoleInfoSpy.mockRestore();
        });
    });
});
