import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

/*
 * `runOverallAnalysis` under `keyPolicy`.
 *
 * The four dependency axes are mocked here — each axis's own routing is
 * covered end to end in `keyPolicyUseCases.test.ts`. What this file pins is
 * (a) the overall call's own dispatch, with the real `callAnalysisAi`, and
 * (b) that the policy reaches every axis call. `resolveServerApiKey` throws
 * unless a test opts in, same as the sibling file.
 */
vi.mock('@/infrastructure/ai/serverKeys', () => ({
    resolveServerApiKey: vi.fn(),
}));
vi.mock('@/infrastructure/ai/retry/anthropicRetry', () => ({
    callClaudeWithRetry: vi.fn(),
}));
vi.mock('@/infrastructure/ai/retry/openaiRetry', () => ({
    callChatGPTWithRetry: vi.fn(),
}));
vi.mock('@/infrastructure/ai/retry/geminiRetry', () => ({
    callGeminiWithRetry: vi.fn(),
}));
vi.mock('@/infrastructure/ai/retry/deepseekRetry', () => ({
    callDeepSeekWithRetry: vi.fn(),
}));
vi.mock('@/infrastructure/cache/redis');
vi.mock('@/application/market/runAnalysis');
vi.mock('@/application/news/runNewsAnalysis');
vi.mock('@/application/market/barsApi');
vi.mock('@/application/fundamental/runFundamentalAnalysis');
vi.mock('@/application/options/runOptionsAnalysis');

import { runOverallAnalysis } from '@/application/overall/runOverallAnalysis';
import { runAnalysisForOverall } from '@/application/market/runAnalysis';
import { runNewsAnalysis } from '@/application/news/runNewsAnalysis';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';
import { runFundamentalAnalysis } from '@/application/fundamental/runFundamentalAnalysis';
import { runOptionsAnalysis } from '@/application/options/runOptionsAnalysis';
import { resolveServerApiKey } from '@/infrastructure/ai/serverKeys';
import { callClaudeWithRetry } from '@/infrastructure/ai/retry/anthropicRetry';
import { callChatGPTWithRetry } from '@/infrastructure/ai/retry/openaiRetry';
import { callGeminiWithRetry } from '@/infrastructure/ai/retry/geminiRetry';
import { callDeepSeekWithRetry } from '@/infrastructure/ai/retry/deepseekRetry';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import type { RunOverallAnalysisOptions } from '@/application/overall/types';
import type {
    AnalysisResponse,
    EnrichedNewsItem,
    FundamentalAnalysisResponse,
    NewsAnalysisResponse,
    OptionsAnalysisResponse,
    OptionsSnapshot,
    OverallAnalysisResponse,
} from '@/domain/types';
import type { FundamentalDataProvider } from '@/domain/ports/fundamentalDataProvider';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';

const mockResolveServerApiKey = resolveServerApiKey as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;
const mockTechnical = runAnalysisForOverall as Mock;
const mockNews = runNewsAnalysis as Mock;
const mockFundamental = runFundamentalAnalysis as Mock;
const mockOptions = runOptionsAnalysis as Mock;
const mockFetchBars = fetchBarsWithIndicators as Mock;

const USER_KEY = 'user-key';
const SERVER_KEY = 'server-key';

const MODEL_CLASSES = [
    { access: 'free', model: 'gemini-3.6-flash' },
    { access: 'member', model: 'claude-sonnet-5-5' },
    { access: 'byok', model: 'claude-opus-5' },
] as const;

const ADAPTERS = [
    callClaudeWithRetry,
    callChatGPTWithRetry,
    callGeminiWithRetry,
    callDeepSeekWithRetry,
] as const;

function dispatchKeys(): unknown[] {
    return ADAPTERS.flatMap(a => vi.mocked(a).mock.calls.map(c => c[2]));
}

const technicalResult: AnalysisResponse = {
    summary: '기술적 강세 추세.',
    trend: 'bullish',
    riskLevel: 'medium',
    keyLevels: { support: [], resistance: [] },
    priceTargets: { bullish: null, bearish: null },
    patternSummaries: [],
    strategyResults: [],
    candlePatterns: [],
    trendlines: [],
    indicatorResults: [],
};
const newsResult: NewsAnalysisResponse = {
    currentDriverKo: '뉴스 드라이버 요약.',
    keyEventsKo: [],
    upcomingEventsKo: [],
    overallSentiment: 'bullish',
};
const fundamentalResult: FundamentalAnalysisResponse = {
    overallConclusionKo: '펀더멘털 결론.',
    categoryAssessments: [],
    riskFactorsKo: [],
    overallSentiment: 'neutral',
};
const optionsResult: OptionsAnalysisResponse = {
    summary: '옵션 포지셔닝 요약.',
    perExpiration: [],
    signals: [],
    analyzedAt: '2026-09-01T00:00:00.000Z',
};
const overallResult: OverallAnalysisResponse = {
    headlineKo: '종합 분석 헤드라인.',
    technicalBulletsKo: [],
    fundamentalBulletsKo: [],
    newsBulletsKo: [],
    optionsBulletsKo: [],
    financialsBulletsKo: [],
    integratedConclusionKo: '통합 결론.',
    scenarios: [],
    riskFactorsKo: [],
};
const newsItem: EnrichedNewsItem = {
    id: 'news-001',
    symbol: 'AAPL',
    source: 'Reuters',
    url: 'https://reuters.com/1',
    publishedAt: '2026-08-01T10:00:00Z',
    titleEn: 'Apple news',
    bodyEn: 'Body text.',
    card: {
        titleKo: '애플 뉴스',
        bodyKo: '본문.',
        summaryKo: '요약.',
        sentiment: 'bullish',
        category: 'earnings',
        priceImpact: 'medium',
    },
};
const optionsSnapshot: OptionsSnapshot = {
    symbol: 'AAPL',
    underlyingPrice: 200,
    chains: [
        {
            expirationDate: '2099-01-15',
            daysToExpiration: 9999,
            calls: [],
            puts: [],
        },
    ],
    capturedAt: '2026-09-01T00:00:00.000Z',
};

/** Equity run, so all four axes (technical, fundamental, news, options) fire. */
function options(
    over: Partial<RunOverallAnalysisOptions> = {}
): RunOverallAnalysisOptions {
    return {
        symbol: 'AAPL',
        timeframe: '1Day',
        modelId: 'gemini-3.6-flash',
        technical: {},
        newsItems: [newsItem],
        upcomingCalendar: [],
        optionsSnapshot,
        fundamentalProvider: {} as FundamentalDataProvider,
        marketDataProvider: {} as MarketDataProvider,
        ...over,
    };
}

function throwOnServerKey(): void {
    mockResolveServerApiKey.mockImplementation((provider: string) => {
        throw new Error(`resolveServerApiKey(${provider}) must not be called`);
    });
}

let cacheGets: string[] = [];
let cacheSets: string[] = [];

beforeEach(() => {
    vi.clearAllMocks();
    cacheGets = [];
    cacheSets = [];
    mockCreateCacheProvider.mockReturnValue({
        get: vi.fn((k: string) => {
            cacheGets.push(k);
            return Promise.resolve(null);
        }),
        set: vi.fn((k: string) => {
            cacheSets.push(k);
            return Promise.resolve(undefined);
        }),
        delete: vi.fn(),
    });
    mockTechnical.mockResolvedValue({
        status: 'done',
        result: technicalResult,
    });
    mockNews.mockResolvedValue({ status: 'done', result: newsResult });
    mockFundamental.mockResolvedValue({
        status: 'done',
        result: fundamentalResult,
    });
    mockOptions.mockResolvedValue({ status: 'done', result: optionsResult });
    mockFetchBars.mockResolvedValue({
        bars: [],
        indicators: { buySellVolume: [] },
    });
    const body = JSON.stringify(overallResult);
    for (const adapter of ADAPTERS) vi.mocked(adapter).mockResolvedValue(body);
    throwOnServerKey();
});

/** The options each axis `run*` received on its single call. */
function axisCalls() {
    return {
        technical: mockTechnical.mock.calls[0][5] as Record<string, unknown>,
        fundamental: mockFundamental.mock.calls[0][0] as Record<
            string,
            unknown
        >,
        news: mockNews.mock.calls[0][0] as Record<string, unknown>,
        options: mockOptions.mock.calls[0][0] as Record<string, unknown>,
    };
}

describe('runOverallAnalysis — keyPolicy: byok-only', () => {
    it.each(MODEL_CLASSES)(
        'dispatches its own $access-class call on the user key, never a server key',
        async ({ model }) => {
            const result = await runOverallAnalysis(
                options({
                    modelId: model,
                    tier: 'free',
                    userApiKey: USER_KEY,
                    keyPolicy: 'byok-only',
                })
            );

            expect(result.status).toBe('done');
            expect(dispatchKeys()).toEqual([USER_KEY]);
            expect(mockResolveServerApiKey).not.toHaveBeenCalled();
        }
    );

    it('propagates the policy and the key to every dependency axis', async () => {
        await runOverallAnalysis(
            options({
                tier: 'free',
                userApiKey: USER_KEY,
                keyPolicy: 'byok-only',
            })
        );

        const calls = axisCalls();
        for (const [axis, received] of Object.entries(calls)) {
            expect(received, axis).toMatchObject({
                keyPolicy: 'byok-only',
                userApiKey: USER_KEY,
            });
        }
    });

    it('an axis object that carries its own keyPolicy cannot loosen the top-level byok-only', async () => {
        // An untyped JS caller can put `keyPolicy` on an axis object: the
        // per-axis option types omit it, but nothing stops it at runtime, and
        // the axis spreads would let it win if it were assigned before them.
        const loosened = { keyPolicy: 'tier' } as never;
        await runOverallAnalysis(
            options({
                tier: 'free',
                userApiKey: USER_KEY,
                keyPolicy: 'byok-only',
                technical: { ...(loosened as object) },
                fundamental: loosened,
                news: loosened,
                options: {
                    ...(loosened as object),
                    modelId: 'gemini-3.6-flash',
                },
            })
        );

        for (const [axis, received] of Object.entries(axisCalls())) {
            expect(received.keyPolicy, axis).toBe('byok-only');
        }
    });

    it.each(MODEL_CLASSES)(
        'denies the $access-class model without a key before any axis or provider call',
        async ({ model }) => {
            const result = await runOverallAnalysis(
                options({
                    modelId: model,
                    tier: 'free',
                    keyPolicy: 'byok-only',
                })
            );

            expect(result).toMatchObject({
                status: 'key_error',
                code: 'user_api_key_required',
            });
            expect(mockTechnical).not.toHaveBeenCalled();
            expect(mockFundamental).not.toHaveBeenCalled();
            expect(mockNews).not.toHaveBeenCalled();
            expect(mockOptions).not.toHaveBeenCalled();
            expect(dispatchKeys()).toHaveLength(0);
            expect(mockResolveServerApiKey).not.toHaveBeenCalled();
        }
    );

    it('does not fall back to Gemini on a DeepSeek failure even when requested', async () => {
        vi.mocked(callDeepSeekWithRetry).mockRejectedValue(
            Object.assign(new Error('upstream down'), { status: 503 })
        );

        await expect(
            runOverallAnalysis(
                options({
                    modelId: 'deepseek-v4.1-flash',
                    tier: 'free',
                    userApiKey: USER_KEY,
                    keyPolicy: 'byok-only',
                    providerFallback: true,
                })
            )
        ).rejects.toThrow('upstream down');

        expect(callDeepSeekWithRetry).toHaveBeenCalledTimes(1);
        expect(callGeminiWithRetry).not.toHaveBeenCalled();
        expect(mockResolveServerApiKey).not.toHaveBeenCalled();
    });
});

describe('runOverallAnalysis — default keyPolicy is unchanged', () => {
    beforeEach(() => {
        mockResolveServerApiKey.mockReset();
        mockResolveServerApiKey.mockReturnValue(SERVER_KEY);
    });

    it.each(MODEL_CLASSES.filter(c => c.access !== 'byok'))(
        'a $access-class model still runs on the server key without a user key',
        async ({ model }) => {
            const result = await runOverallAnalysis(
                options({ modelId: model, tier: 'free' })
            );

            expect(result.status).toBe('done');
            expect(dispatchKeys()).toEqual([SERVER_KEY]);
            for (const received of Object.values(axisCalls())) {
                expect(received.keyPolicy).toBeUndefined();
            }
        }
    );

    it('a byok-class model on a non-pro tier is still denied without a key and uses the user key with one', async () => {
        await expect(
            runOverallAnalysis(
                options({ modelId: 'claude-opus-5', tier: 'free' })
            )
        ).resolves.toMatchObject({ status: 'key_error' });
        expect(dispatchKeys()).toHaveLength(0);

        const result = await runOverallAnalysis(
            options({
                modelId: 'claude-opus-5',
                tier: 'free',
                userApiKey: USER_KEY,
            })
        );
        expect(result.status).toBe('done');
        expect(dispatchKeys()).toEqual([USER_KEY]);
    });
});

describe('runOverallAnalysis — cache key ignores keyPolicy', () => {
    it('reads and writes the same overall entry on the server key and on a user key', async () => {
        mockResolveServerApiKey.mockReset();
        mockResolveServerApiKey.mockReturnValue(SERVER_KEY);
        await runOverallAnalysis(options({ tier: 'free' }));
        const serverGets = [...cacheGets];
        const serverSets = [...cacheSets];
        expect(dispatchKeys()).toEqual([SERVER_KEY]);

        vi.clearAllMocks();
        cacheGets.length = 0;
        cacheSets.length = 0;
        mockCreateCacheProvider.mockReturnValue({
            get: vi.fn((k: string) => {
                cacheGets.push(k);
                return Promise.resolve(null);
            }),
            set: vi.fn((k: string) => {
                cacheSets.push(k);
                return Promise.resolve(undefined);
            }),
            delete: vi.fn(),
        });
        mockTechnical.mockResolvedValue({
            status: 'done',
            result: technicalResult,
        });
        mockNews.mockResolvedValue({ status: 'done', result: newsResult });
        mockFundamental.mockResolvedValue({
            status: 'done',
            result: fundamentalResult,
        });
        mockOptions.mockResolvedValue({
            status: 'done',
            result: optionsResult,
        });
        mockFetchBars.mockResolvedValue({
            bars: [],
            indicators: { buySellVolume: [] },
        });
        const body = JSON.stringify(overallResult);
        for (const adapter of ADAPTERS)
            vi.mocked(adapter).mockResolvedValue(body);
        throwOnServerKey();

        await runOverallAnalysis(
            options({
                tier: 'free',
                userApiKey: USER_KEY,
                keyPolicy: 'byok-only',
            })
        );

        expect(serverGets.length).toBeGreaterThan(0);
        expect(cacheGets).toEqual(serverGets);
        expect(cacheSets).toEqual(serverSets);
        expect(dispatchKeys()).toEqual([USER_KEY]);
    });
});

describe('runOverallAnalysis — concurrent runs do not join across policies or keys', () => {
    function installGatedAdapters(): { release: () => void } {
        let release: () => void = () => {};
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const text = JSON.stringify(overallResult);
        for (const adapter of ADAPTERS) {
            vi.mocked(adapter).mockImplementation((async (
                _p: unknown,
                _m: unknown,
                key: unknown
            ) => {
                await gate;
                if (key === 'bad-key') {
                    throw Object.assign(new Error('401'), { status: 401 });
                }
                return text;
            }) as never);
        }
        return { release };
    }
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));

    beforeEach(() => {
        mockResolveServerApiKey.mockReset();
        mockResolveServerApiKey.mockReturnValue(SERVER_KEY);
    });

    it('a bad-key byok-only overall does not fail a concurrent tier overall', async () => {
        const { release } = installGatedAdapters();
        const pending = Promise.allSettled([
            runOverallAnalysis(
                options({
                    tier: 'free',
                    userApiKey: 'bad-key',
                    keyPolicy: 'byok-only',
                })
            ),
            runOverallAnalysis(options({ tier: 'free' })),
        ]);
        await flush();
        release();
        const [byok, tier] = await pending;

        expect(byok.status).toBe('rejected');
        expect(tier).toMatchObject({
            status: 'fulfilled',
            value: { status: 'done' },
        });
        expect(dispatchKeys().sort()).toEqual(['bad-key', SERVER_KEY].sort());
    });

    it('two byok-only overalls with different keys dispatch separately', async () => {
        const { release } = installGatedAdapters();
        const pending = Promise.allSettled(
            ['key-one', 'key-two'].map(key =>
                runOverallAnalysis(
                    options({
                        tier: 'free',
                        userApiKey: key,
                        keyPolicy: 'byok-only',
                    })
                )
            )
        );
        await flush();
        release();
        const results = await pending;

        expect(results.map(r => r.status)).toEqual(['fulfilled', 'fulfilled']);
        expect(dispatchKeys().sort()).toEqual(['key-one', 'key-two']);
    });

    it('two tier overalls still share one dispatch', async () => {
        const { release } = installGatedAdapters();
        const pending = Promise.allSettled([
            runOverallAnalysis(options({ tier: 'free' })),
            runOverallAnalysis(options({ tier: 'free' })),
        ]);
        await flush();
        release();
        const results = await pending;

        expect(results.map(r => r.status)).toEqual(['fulfilled', 'fulfilled']);
        expect(dispatchKeys()).toHaveLength(1);
    });
});
