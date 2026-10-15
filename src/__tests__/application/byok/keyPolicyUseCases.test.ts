import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

/*
 * End-to-end key routing for `keyPolicy` across every use-case that generates.
 *
 * Deliberately NOT mocking `callAnalysisAi`: the point is what reaches the
 * provider dispatch. Only the four provider adapters (the network edge), the
 * cache, the skills loader and `resolveServerApiKey` are replaced.
 * `resolveServerApiKey` is a spy that THROWS unless a test opts in to the
 * default-policy server key — so "byok-only never touches a server key" is a
 * hard failure the moment any code path reads one, not a call-count we hope to
 * remember to check.
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
vi.mock('@/infrastructure/skills/loader');
vi.mock('@/application/market/barsApi');

import { DEEPSEEK_V4_1_FLASH_MODEL } from '@/application/chat/constants';
import { UserApiKeyMissingError } from '@/application/byok/errors';
import { runAnalysis } from '@/application/market/runAnalysis';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';
import { runNewsAnalysis } from '@/application/news/runNewsAnalysis';
import { runFundamentalAnalysis } from '@/application/fundamental/runFundamentalAnalysis';
import { runFinancialsAnalysis } from '@/application/financials/runFinancialsAnalysis';
import { runOptionsAnalysis } from '@/application/options/runOptionsAnalysis';
import { runCongressTrend } from '@/application/congress/runCongressTrend';
import { runMarketNewsDigest } from '@/application/news/runMarketNewsDigest';
import { runNewsCardAnalysis } from '@/application/news/runNewsCardAnalysis';
import { runIndicatorTranslation } from '@/application/economy/runIndicatorTranslation';
import { runEconomicEventAnalysis } from '@/application/economy/runEconomicEventAnalysis';
import { resolveServerApiKey } from '@/infrastructure/ai/serverKeys';
import { callClaudeWithRetry } from '@/infrastructure/ai/retry/anthropicRetry';
import { callChatGPTWithRetry } from '@/infrastructure/ai/retry/openaiRetry';
import { callGeminiWithRetry } from '@/infrastructure/ai/retry/geminiRetry';
import { callDeepSeekWithRetry } from '@/infrastructure/ai/retry/deepseekRetry';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { loadSkillsCached } from '@/infrastructure/skills/loader';
import { getModelAccess } from '@/domain/tier';
import {
    EMPTY_INDICATOR_RESULT,
    EMPTY_SMC_RESULT,
} from '@/domain/indicators/constants';
import type { KeyPolicy } from '@/domain/keyRouting';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';
import type { CongressTradesProvider } from '@/domain/ports/congressTradesProvider';
import type { FundamentalDataProvider } from '@/domain/ports/fundamentalDataProvider';
import type {
    ActiveModelId,
    EnrichedNewsItem,
    ModelId,
    OptionsSnapshot,
    Tier,
} from '@/domain/types';

const mockResolveServerApiKey = resolveServerApiKey as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;
const mockLoadSkillsCached = loadSkillsCached as Mock;
const mockFetchBars = fetchBarsWithIndicators as Mock;

const USER_KEY = 'user-key';
const SERVER_KEY = 'server-key';

/** One model per access class, checked against the registry below. */
const MODEL_CLASSES = [
    { access: 'free', model: 'gemini-3.6-flash' },
    { access: 'member', model: 'claude-sonnet-5-5' },
    { access: 'byok', model: 'claude-opus-5' },
] as const satisfies ReadonlyArray<{ access: string; model: ActiveModelId }>;

const ADAPTERS = [
    callClaudeWithRetry,
    callChatGPTWithRetry,
    callGeminiWithRetry,
    callDeepSeekWithRetry,
] as const;

interface DispatchCall {
    model: unknown;
    key: unknown;
}

/** Every provider dispatch so far, across all four adapters. */
function dispatches(): DispatchCall[] {
    return ADAPTERS.flatMap(adapter =>
        vi.mocked(adapter).mock.calls.map(c => ({ model: c[1], key: c[2] }))
    );
}

function makeSpyThatThrows(): void {
    mockResolveServerApiKey.mockImplementation((provider: string) => {
        throw new Error(
            `resolveServerApiKey(${provider}) must not be called under byok-only`
        );
    });
}

// ── Fixtures ─────────────────────────────────────────────────────────────

const NEWS_ITEM: EnrichedNewsItem = {
    id: 'news-1',
    symbol: 'AAPL',
    source: 'Reuters',
    url: 'https://reuters.com/news-1',
    publishedAt: '2026-05-01T10:00:00Z',
    titleEn: 'Apple announces new product',
    bodyEn: 'Apple announced a new product today.',
    card: {
        titleKo: '애플 신제품 발표',
        bodyKo: '애플이 오늘 신제품을 발표했습니다.',
        summaryKo: '신제품 발표',
        sentiment: 'bullish',
        category: 'product',
        priceImpact: 'medium',
    },
};

const SNAPSHOT: OptionsSnapshot = {
    symbol: 'AAPL',
    underlyingPrice: 200,
    capturedAt: '2026-05-14T10:00:00Z',
    chains: [
        {
            expirationDate: '2026-06-20',
            daysToExpiration: 37,
            calls: [
                {
                    contractSymbol: 'AAPL260620C00195000',
                    strike: 195,
                    lastPrice: 8.5,
                    bid: 8.3,
                    ask: 8.7,
                    volume: 100,
                    openInterest: 500,
                    impliedVolatility: 0.28,
                    inTheMoney: true,
                },
            ],
            puts: [
                {
                    contractSymbol: 'AAPL260620P00195000',
                    strike: 195,
                    lastPrice: 4.0,
                    bid: 3.8,
                    ask: 4.2,
                    volume: 60,
                    openInterest: 400,
                    impliedVolatility: 0.29,
                    inTheMoney: false,
                },
            ],
        },
    ],
};

const SENATE_ROW = {
    firstName: 'Jane',
    lastName: 'Doe',
    office: 'Jane Doe',
    district: 'CA',
    owner: 'self',
    type: 'Purchase',
    amount: '$1,001 - $15,000',
    assetType: 'Stock',
    assetDescription: 'Apple Inc',
    transactionDate: '2026-05-01',
    disclosureDate: '2026-05-20',
    link: 'https://example.test/1',
    capitalGainsOver200USD: 'false',
};

const marketDataProvider: MarketDataProvider = {
    getBars: vi.fn().mockResolvedValue([]),
    getQuote: vi.fn().mockResolvedValue(null),
};
const congressProvider: CongressTradesProvider = {
    getTrades: vi.fn((_symbol: string, chamber: string) =>
        Promise.resolve(chamber === 'senate' ? [SENATE_ROW] : [])
    ),
};
const fundamentalProvider: FundamentalDataProvider = {
    getProfile: vi.fn().mockResolvedValue({
        symbol: 'AAPL',
        companyName: 'Apple Inc.',
        sector: 'Technology',
        industry: 'Consumer Electronics',
        marketCap: 3_000_000_000_000,
        ceo: 'Tim Cook',
        website: 'https://www.apple.com',
        description: null,
    }),
    getKeyMetricsTtm: vi.fn().mockResolvedValue(null),
    getRatiosTtm: vi.fn().mockResolvedValue(null),
    getCashFlowStatement: vi.fn().mockResolvedValue(null),
    getIncomeStatementGrowth: vi.fn().mockResolvedValue(null),
    getFinancialScores: vi.fn().mockResolvedValue(null),
    getStockPeers: vi.fn().mockResolvedValue([]),
    getAnalystEstimates: vi.fn().mockResolvedValue(null),
    getGradesConsensus: vi.fn().mockResolvedValue(null),
    getPriceTargetConsensus: vi.fn().mockResolvedValue(null),
    getPriceTargetSummary: vi.fn().mockResolvedValue(null),
    getEarningsReport: vi.fn().mockResolvedValue(null),
    getSectorPerformanceSnapshot: vi.fn().mockResolvedValue([]),
    getHistoricalSectorPerformance: vi.fn().mockResolvedValue([]),
};
const financialsProvider = {
    getIncomeStatements: vi.fn().mockResolvedValue([]),
    getBalanceSheets: vi.fn().mockResolvedValue([]),
    getCashFlowStatements: vi.fn().mockResolvedValue([]),
    getIncomeStatementGrowths: vi.fn().mockResolvedValue([]),
    getFinancialGrowths: vi.fn().mockResolvedValue([]),
    getCashFlowGrowths: vi.fn().mockResolvedValue([]),
};

// ── Scenarios ────────────────────────────────────────────────────────────

interface RunArgs {
    modelId: ModelId;
    tier: Tier;
    userApiKey?: string;
    keyPolicy?: KeyPolicy;
    providerFallback?: boolean;
}

interface Scenario {
    name: string;
    /** `true` when the caller picks the model; `false` for a fixed-model pipeline. */
    modelIsParameter: boolean;
    /** How a missing key surfaces: a `key_error` result, or a thrown error. */
    denial: 'result' | 'throw';
    /** `false` for a pipeline that never touches the shared cache. */
    usesCache?: boolean;
    /** Valid raw provider output so the real normalizers succeed. */
    raw: unknown;
    run: (args: RunArgs) => Promise<{ status: string }>;
}

const SCENARIOS: Scenario[] = [
    {
        name: 'runAnalysis',
        modelIsParameter: true,
        denial: 'result',
        raw: {
            summary: '테스트 요약',
            trend: 'bullish',
            indicatorResults: [],
            riskLevel: 'low',
            keyLevels: { support: [], resistance: [] },
            priceTargets: {
                bullish: { targets: [], condition: '' },
                bearish: { targets: [], condition: '' },
            },
            patternSummaries: [],
            strategyResults: [],
            candlePatterns: [],
            trendlines: [],
        },
        run: a =>
            runAnalysis('AAPL', 'Apple Inc.', '1Day', false, undefined, {
                marketDataProvider,
                tierContext: { userId: 'u1', tier: a.tier },
                modelId: a.modelId,
                userApiKey: a.userApiKey,
                keyPolicy: a.keyPolicy,
                providerFallback: a.providerFallback,
            }),
    },
    {
        name: 'runNewsAnalysis',
        modelIsParameter: true,
        denial: 'result',
        raw: {
            currentDriverKo: '신제품 발표가 주가 흐름을 주도한다.',
            keyEventsKo: ['애플 신제품 발표'],
            upcomingEventsKo: ['7월 실적 발표'],
            overallSentiment: 'bullish',
        },
        run: a =>
            runNewsAnalysis({
                symbol: 'AAPL',
                modelId: a.modelId,
                news: [NEWS_ITEM],
                upcomingCalendar: [],
                tier: a.tier,
                userApiKey: a.userApiKey,
                keyPolicy: a.keyPolicy,
                providerFallback: a.providerFallback,
            }),
    },
    {
        name: 'runFundamentalAnalysis',
        modelIsParameter: true,
        denial: 'result',
        raw: {
            overallConclusionKo: '테스트 분석입니다.',
            categoryAssessments: [
                {
                    category: 'profitability',
                    sentiment: 'positive',
                    summaryKo: '양호',
                },
            ],
            riskFactorsKo: [],
            overallSentiment: 'positive',
        },
        run: a =>
            runFundamentalAnalysis({
                symbol: 'AAPL',
                modelId: a.modelId,
                dataProvider: fundamentalProvider,
                tier: a.tier,
                userApiKey: a.userApiKey,
                keyPolicy: a.keyPolicy,
                providerFallback: a.providerFallback,
            }),
    },
    {
        name: 'runFinancialsAnalysis',
        modelIsParameter: true,
        denial: 'result',
        raw: {
            overallConclusionKo: '재무 상태 양호.',
            axisAssessments: [],
            riskFactorsKo: [],
            overallSentiment: 'positive',
        },
        run: a =>
            runFinancialsAnalysis({
                symbol: 'AAPL',
                modelId: a.modelId,
                dataProvider: financialsProvider,
                tier: a.tier,
                userApiKey: a.userApiKey,
                keyPolicy: a.keyPolicy,
                providerFallback: a.providerFallback,
            }),
    },
    {
        name: 'runOptionsAnalysis',
        modelIsParameter: true,
        denial: 'result',
        raw: {
            summaryKo: '옵션 시장 중립.',
            sentiment: 'neutral',
            keyObservationsKo: [],
            strategySuggestionsKo: [],
        },
        run: a =>
            runOptionsAnalysis({
                symbol: 'AAPL',
                modelId: a.modelId,
                snapshot: SNAPSHOT,
                expirationDate: 'all',
                tier: a.tier,
                userApiKey: a.userApiKey,
                keyPolicy: a.keyPolicy,
                providerFallback: a.providerFallback,
            }),
    },
    {
        name: 'runCongressTrend',
        modelIsParameter: true,
        denial: 'throw',
        raw: {
            summaryKo: '의회 거래 동향 분석.',
            notableMembersKo: ['Jane Doe 상원의원'],
            riskNoteKo: '공시 지연 주의.',
            overallSentiment: 'bullish',
        },
        run: a =>
            runCongressTrend({
                symbol: 'AAPL',
                modelId: a.modelId,
                dataProvider: congressProvider,
                tier: a.tier,
                userApiKey: a.userApiKey,
                keyPolicy: a.keyPolicy,
                providerFallback: a.providerFallback,
            }),
    },
    {
        name: 'runMarketNewsDigest',
        modelIsParameter: true,
        denial: 'throw',
        raw: {
            currentDriverKo: '시장 전반 상승 모멘텀.',
            keyEventsKo: ['BTC ETF 유입 급증'],
            upcomingEventsKo: [],
            overallSentiment: 'bullish',
        },
        run: a =>
            runMarketNewsDigest({
                category: 'crypto',
                categoryLabel: '미국 암호화폐',
                modelId: a.modelId,
                news: [NEWS_ITEM],
                tier: a.tier,
                userApiKey: a.userApiKey,
                keyPolicy: a.keyPolicy,
                providerFallback: a.providerFallback,
            }),
    },
    {
        name: 'runNewsCardAnalysis',
        usesCache: false,
        modelIsParameter: false,
        denial: 'throw',
        raw: {
            titleKo: '애플 신제품 발표',
            bodyKo: '애플이 신제품을 발표했습니다.',
            summaryKo: '신제품 발표',
            sentiment: 'bullish',
            category: 'product',
            priceImpact: 'medium',
        },
        run: a =>
            runNewsCardAnalysis({
                item: {
                    id: 'card-1',
                    symbol: 'AAPL',
                    source: 'Reuters',
                    url: 'https://reuters.com/card-1',
                    publishedAt: '2026-05-01T10:00:00Z',
                    titleEn: 'Apple announces new product lineup',
                    bodyEn: 'Apple has announced a new product lineup.',
                },
                userApiKey: a.userApiKey,
                keyPolicy: a.keyPolicy,
                providerFallback: a.providerFallback,
            }),
    },
    {
        name: 'runIndicatorTranslation',
        modelIsParameter: false,
        denial: 'throw',
        raw: { nameKo: '소비자물가지수 월간' },
        run: a =>
            runIndicatorTranslation('cpi_mom', {
                userApiKey: a.userApiKey,
                keyPolicy: a.keyPolicy,
            }),
    },
    {
        name: 'runEconomicEventAnalysis',
        modelIsParameter: false,
        denial: 'throw',
        raw: {
            sentiment: 'bullish',
            summaryKo: 'CPI 예상 하회로 금리 인하 기대 강화.',
            interpretationKo: '위험 자산에 긍정적 신호.',
        },
        run: a =>
            runEconomicEventAnalysis(
                {
                    region: '미국',
                    event: 'CPI MoM',
                    impact: 'High',
                    actual: 0.1,
                    estimate: 0.3,
                    previous: 0.4,
                    unit: '%',
                },
                { userApiKey: a.userApiKey, keyPolicy: a.keyPolicy }
            ),
    },
];

/**
 * Cache provider that records every key it is asked about. `cached` makes every
 * read a hit; `locking` adds the Redis lock surface (`setIfAbsent` and
 * `deleteIfEquals`) so a test can assert the lock was never taken.
 */
function makeRecordingCache(
    opts: { cached?: unknown; locking?: boolean } = {}
) {
    const gets: string[] = [];
    const sets: string[] = [];
    const setIfAbsent = vi.fn(() => Promise.resolve(true));
    const deleteIfEquals = vi.fn(() => Promise.resolve(true));
    return {
        gets,
        sets,
        setIfAbsent,
        deleteIfEquals,
        provider: {
            get: vi.fn((key: string) => {
                gets.push(key);
                return Promise.resolve(opts.cached ?? null);
            }),
            set: vi.fn((key: string) => {
                sets.push(key);
                return Promise.resolve(undefined);
            }),
            delete: vi.fn(),
            ...(opts.locking ? { setIfAbsent, deleteIfEquals } : {}),
        },
    };
}

/** Data-fetch spies a use-case must not touch once its key gate has denied. */
const IO_SPIES: Record<string, () => Mock[]> = {
    runAnalysis: () => [mockFetchBars],
    runCongressTrend: () => [congressProvider.getTrades as Mock],
    runFundamentalAnalysis: () => [fundamentalProvider.getProfile as Mock],
    runFinancialsAnalysis: () => [financialsProvider.getIncomeStatements],
};

/** Let fire-and-forget cache writes land before the keys are read. */
async function flush(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0));
}

function respondWith(raw: unknown): void {
    const text = JSON.stringify(raw);
    for (const adapter of ADAPTERS) {
        vi.mocked(adapter).mockResolvedValue(text);
    }
}

/**
 * Every adapter blocks on one gate, then answers by key: `bad-key` fails with a
 * 401, any other key succeeds. Lets two runs be provably in flight together.
 */
function installGatedAdapters(raw: unknown): { release: () => void } {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => {
        release = resolve;
    });
    const text = JSON.stringify(raw);
    for (const adapter of ADAPTERS) {
        vi.mocked(adapter).mockImplementation((async (
            _prompt: unknown,
            _model: unknown,
            key: unknown
        ) => {
            await gate;
            if (key === 'bad-key') {
                throw Object.assign(new Error('401 invalid key'), {
                    status: 401,
                });
            }
            return text;
        }) as never);
    }
    return { release };
}

let cache = makeRecordingCache();

beforeEach(() => {
    vi.clearAllMocks();
    cache = makeRecordingCache();
    mockCreateCacheProvider.mockReturnValue(cache.provider);
    mockLoadSkillsCached.mockResolvedValue({
        skills: [],
        skillsDegraded: false,
    });
    mockFetchBars.mockResolvedValue({
        bars: [
            {
                time: 1705312200,
                open: 100,
                high: 105,
                low: 99,
                close: 103,
                volume: 1_000_000,
            },
        ],
        indicators: { ...EMPTY_INDICATOR_RESULT, smc: EMPTY_SMC_RESULT },
    });
    makeSpyThatThrows();
});

describe('model class fixtures', () => {
    it.each(MODEL_CLASSES)(
        '$model is a $access-class model in the registry',
        ({ access, model }) => {
            expect(getModelAccess(model)).toBe(access);
        }
    );
});

describe.each(SCENARIOS)('$name — keyPolicy', scenario => {
    const classes = scenario.modelIsParameter
        ? MODEL_CLASSES
        : MODEL_CLASSES.slice(0, 1);

    describe('byok-only + userApiKey', () => {
        it.each(classes)(
            'dispatches the $access-class model on the user key and never reads a server key',
            async ({ model }) => {
                respondWith(scenario.raw);

                const result = await scenario.run({
                    modelId: model,
                    tier: 'free',
                    userApiKey: USER_KEY,
                    keyPolicy: 'byok-only',
                });

                expect(result.status).toBe('done');
                const calls = dispatches();
                expect(calls).toHaveLength(1);
                expect(calls[0].key).toBe(USER_KEY);
                if (scenario.modelIsParameter) {
                    expect(calls[0].model).toBe(model);
                }
                expect(mockResolveServerApiKey).not.toHaveBeenCalled();
            }
        );

        it('uses the user key for a pro-tier caller too (tier no longer picks the key)', async () => {
            respondWith(scenario.raw);

            await scenario.run({
                modelId: MODEL_CLASSES[0].model,
                tier: 'pro',
                userApiKey: USER_KEY,
                keyPolicy: 'byok-only',
            });

            expect(dispatches().map(c => c.key)).toEqual([USER_KEY]);
            expect(mockResolveServerApiKey).not.toHaveBeenCalled();
        });
    });

    describe('byok-only without a key', () => {
        it.each(classes)(
            'denies the $access-class model before any provider call',
            async ({ model }) => {
                respondWith(scenario.raw);
                const attempt = scenario.run({
                    modelId: model,
                    tier: 'free',
                    keyPolicy: 'byok-only',
                });

                if (scenario.denial === 'result') {
                    await expect(attempt).resolves.toMatchObject({
                        status: 'key_error',
                        code: 'user_api_key_required',
                    });
                } else {
                    await expect(attempt).rejects.toBeInstanceOf(
                        UserApiKeyMissingError
                    );
                }

                expect(dispatches()).toHaveLength(0);
                expect(mockResolveServerApiKey).not.toHaveBeenCalled();
            }
        );

        it('treats an empty key as missing', async () => {
            respondWith(scenario.raw);
            const attempt = scenario.run({
                modelId: MODEL_CLASSES[0].model,
                tier: 'free',
                userApiKey: '',
                keyPolicy: 'byok-only',
            });

            if (scenario.denial === 'result') {
                await expect(attempt).resolves.toMatchObject({
                    status: 'key_error',
                });
            } else {
                await expect(attempt).rejects.toBeInstanceOf(
                    UserApiKeyMissingError
                );
            }
            expect(dispatches()).toHaveLength(0);
        });
    });

    describe('default policy is unchanged', () => {
        beforeEach(() => {
            mockResolveServerApiKey.mockReset();
            mockResolveServerApiKey.mockReturnValue(SERVER_KEY);
        });

        it.each(
            classes.filter(c => c.access === 'free' || c.access === 'member')
        )(
            '$access-class model runs on the server key with no user key',
            async ({ model }) => {
                respondWith(scenario.raw);

                const result = await scenario.run({
                    modelId: model,
                    tier: 'free',
                });

                expect(result.status).toBe('done');
                expect(dispatches().map(c => c.key)).toEqual([SERVER_KEY]);
            }
        );

        it('an explicit keyPolicy: "tier" behaves like omitting it', async () => {
            respondWith(scenario.raw);

            await scenario.run({
                modelId: MODEL_CLASSES[0].model,
                tier: 'free',
                userApiKey: USER_KEY,
                keyPolicy: 'tier',
            });

            expect(dispatches().map(c => c.key)).toEqual([SERVER_KEY]);
        });

        it.skipIf(!scenario.modelIsParameter)(
            'byok-class model on a non-pro tier uses the user key, and is denied without one',
            async () => {
                respondWith(scenario.raw);
                const byok = MODEL_CLASSES[2].model;

                await scenario.run({
                    modelId: byok,
                    tier: 'free',
                    userApiKey: USER_KEY,
                });
                expect(dispatches().map(c => c.key)).toEqual([USER_KEY]);

                vi.clearAllMocks();
                const denied = scenario.run({ modelId: byok, tier: 'free' });
                if (scenario.denial === 'result') {
                    await expect(denied).resolves.toMatchObject({
                        status: 'key_error',
                    });
                } else {
                    await expect(denied).rejects.toBeInstanceOf(
                        UserApiKeyMissingError
                    );
                }
                expect(dispatches()).toHaveLength(0);
            }
        );
    });

    describe('provider fallback', () => {
        const DEEPSEEK = 'deepseek-v4.1-flash';

        it.skipIf(!scenario.modelIsParameter)(
            'is disabled under byok-only even when requested',
            async () => {
                vi.mocked(callDeepSeekWithRetry).mockRejectedValue(
                    Object.assign(new Error('upstream down'), { status: 503 })
                );

                await expect(
                    scenario.run({
                        modelId: DEEPSEEK,
                        tier: 'free',
                        userApiKey: USER_KEY,
                        keyPolicy: 'byok-only',
                        providerFallback: true,
                    })
                ).rejects.toThrow('upstream down');

                expect(callDeepSeekWithRetry).toHaveBeenCalledTimes(1);
                expect(callGeminiWithRetry).not.toHaveBeenCalled();
                expect(mockResolveServerApiKey).not.toHaveBeenCalled();
            }
        );

        it.skipIf(!scenario.modelIsParameter)(
            'still falls back under the default policy (control)',
            async () => {
                mockResolveServerApiKey.mockReset();
                mockResolveServerApiKey.mockReturnValue(SERVER_KEY);
                vi.mocked(callDeepSeekWithRetry).mockRejectedValue(
                    Object.assign(new Error('upstream down'), { status: 503 })
                );
                vi.mocked(callGeminiWithRetry).mockResolvedValue(
                    JSON.stringify(scenario.raw)
                );

                await scenario.run({
                    modelId: DEEPSEEK,
                    tier: 'free',
                    providerFallback: true,
                });

                expect(callGeminiWithRetry).toHaveBeenCalledTimes(1);
            }
        );
    });

    const expectDenied = (promise: Promise<{ status: string }>) =>
        scenario.denial === 'result'
            ? expect(promise).resolves.toMatchObject({
                  status: 'key_error',
              })
            : expect(promise).rejects.toBeInstanceOf(UserApiKeyMissingError);

    describe('early key gate (byok-only)', () => {
        it.skipIf(scenario.usesCache === false)(
            'serves a cached result without a key (cache hits are free)',
            async () => {
                cache = makeRecordingCache({
                    cached: scenario.raw,
                    locking: true,
                });
                mockCreateCacheProvider.mockReturnValue(cache.provider);

                const result = await scenario.run({
                    modelId: MODEL_CLASSES[0].model,
                    tier: 'free',
                    keyPolicy: 'byok-only',
                });

                expect(result.status).toBe('cached');
                expect(dispatches()).toHaveLength(0);
                expect(cache.setIfAbsent).not.toHaveBeenCalled();
                expect(mockResolveServerApiKey).not.toHaveBeenCalled();
            }
        );

        it('on a miss denies with no data fetch, no lock and no provider call', async () => {
            cache = makeRecordingCache({ locking: true });
            mockCreateCacheProvider.mockReturnValue(cache.provider);

            await expectDenied(
                scenario.run({
                    modelId: MODEL_CLASSES[0].model,
                    tier: 'free',
                    keyPolicy: 'byok-only',
                })
            );

            for (const spy of IO_SPIES[scenario.name]?.() ?? []) {
                expect(spy).not.toHaveBeenCalled();
            }
            expect(cache.setIfAbsent).not.toHaveBeenCalled();
            expect(dispatches()).toHaveLength(0);
            expect(mockResolveServerApiKey).not.toHaveBeenCalled();
        });
    });

    describe('unknown keyPolicy value fails closed', () => {
        it('is treated as byok-only: user key used, no server key read', async () => {
            respondWith(scenario.raw);

            await scenario.run({
                modelId: MODEL_CLASSES[0].model,
                tier: 'free',
                userApiKey: USER_KEY,
                keyPolicy: 'byok_only' as never,
            });

            expect(dispatches().map(c => c.key)).toEqual([USER_KEY]);
            expect(mockResolveServerApiKey).not.toHaveBeenCalled();
        });

        it('is denied without a key', async () => {
            respondWith(scenario.raw);
            await expectDenied(
                scenario.run({
                    modelId: MODEL_CLASSES[0].model,
                    tier: 'free',
                    keyPolicy: 'bogus' as never,
                })
            );
            expect(dispatches()).toHaveLength(0);
        });
    });

    describe('concurrent runs do not join across policies or keys', () => {
        const free = MODEL_CLASSES[0].model;
        const settle = async (...runs: Promise<{ status: string }>[]) =>
            Promise.allSettled(runs);

        beforeEach(() => {
            mockResolveServerApiKey.mockReset();
            mockResolveServerApiKey.mockReturnValue(SERVER_KEY);
        });

        it('(a) a bad-key byok-only run does not fail a concurrent tier run, which dispatches on its own key', async () => {
            const { release } = installGatedAdapters(scenario.raw);
            const byok = scenario.run({
                modelId: free,
                tier: 'free',
                userApiKey: 'bad-key',
                keyPolicy: 'byok-only',
            });
            const tier = scenario.run({ modelId: free, tier: 'free' });
            const pending = settle(byok, tier);
            await flush();
            release();
            const [byokResult, tierResult] = await pending;

            expect(byokResult.status).toBe('rejected');
            expect(tierResult.status).toBe('fulfilled');
            if (tierResult.status === 'fulfilled') {
                expect(tierResult.value.status).toBe('done');
            }
            expect(
                dispatches()
                    .map(c => c.key)
                    .sort()
            ).toEqual(['bad-key', SERVER_KEY].sort());
        });

        it('(b) a keyless byok-only run is denied and a concurrent tier run still succeeds', async () => {
            const { release } = installGatedAdapters(scenario.raw);
            const keyless = scenario.run({
                modelId: free,
                tier: 'free',
                keyPolicy: 'byok-only',
            });
            const tier = scenario.run({ modelId: free, tier: 'free' });
            const pending = settle(keyless, tier);
            await flush();
            release();
            const [keylessResult, tierResult] = await pending;

            if (scenario.denial === 'result') {
                expect(keylessResult).toMatchObject({
                    status: 'fulfilled',
                    value: { status: 'key_error' },
                });
            } else {
                expect(keylessResult.status).toBe('rejected');
            }
            expect(tierResult).toMatchObject({
                status: 'fulfilled',
                value: { status: 'done' },
            });
            expect(dispatches().map(c => c.key)).toEqual([SERVER_KEY]);
        });

        it('(c) two byok-only runs with different keys stay independent', async () => {
            const { release } = installGatedAdapters(scenario.raw);
            const one = scenario.run({
                modelId: free,
                tier: 'free',
                userApiKey: 'key-one',
                keyPolicy: 'byok-only',
            });
            const two = scenario.run({
                modelId: free,
                tier: 'free',
                userApiKey: 'key-two',
                keyPolicy: 'byok-only',
            });
            const pending = settle(one, two);
            await flush();
            release();
            const results = await pending;

            expect(results.map(r => r.status)).toEqual([
                'fulfilled',
                'fulfilled',
            ]);
            expect(
                dispatches()
                    .map(c => c.key)
                    .sort()
            ).toEqual(['key-one', 'key-two']);
        });

        it('(c2) a bad-key byok-only run does not fail another byok-only user', async () => {
            const { release } = installGatedAdapters(scenario.raw);
            const bad = scenario.run({
                modelId: free,
                tier: 'free',
                userApiKey: 'bad-key',
                keyPolicy: 'byok-only',
            });
            const good = scenario.run({
                modelId: free,
                tier: 'free',
                userApiKey: 'good-key',
                keyPolicy: 'byok-only',
            });
            const pending = settle(bad, good);
            await flush();
            release();
            const [badResult, goodResult] = await pending;

            expect(badResult.status).toBe('rejected');
            expect(goodResult.status).toBe('fulfilled');
        });

        it('(d) two tier runs still share one dispatch', async () => {
            const { release } = installGatedAdapters(scenario.raw);
            const one = scenario.run({ modelId: free, tier: 'free' });
            const two = scenario.run({ modelId: free, tier: 'free' });
            const pending = settle(one, two);
            await flush();
            release();
            const results = await pending;

            expect(results.map(r => r.status)).toEqual([
                'fulfilled',
                'fulfilled',
            ]);
            expect(dispatches()).toHaveLength(1);
        });
    });

    describe.skipIf(scenario.usesCache === false)('cache keys', () => {
        it('are identical whether the server key or a user key generated the result', async () => {
            respondWith(scenario.raw);
            mockResolveServerApiKey.mockReset();
            mockResolveServerApiKey.mockReturnValue(SERVER_KEY);
            await scenario.run({
                modelId: MODEL_CLASSES[0].model,
                tier: 'free',
            });
            await flush();
            const serverRun = { gets: [...cache.gets], sets: [...cache.sets] };
            expect(dispatches().map(c => c.key)).toEqual([SERVER_KEY]);

            vi.clearAllMocks();
            cache = makeRecordingCache();
            mockCreateCacheProvider.mockReturnValue(cache.provider);
            makeSpyThatThrows();
            respondWith(scenario.raw);
            await scenario.run({
                modelId: MODEL_CLASSES[0].model,
                tier: 'free',
                userApiKey: USER_KEY,
                keyPolicy: 'byok-only',
            });
            await flush();
            expect(dispatches().map(c => c.key)).toEqual([USER_KEY]);

            // Same model, same inputs: the same entries are read and written.
            // (Non-empty first, so an empty-equals-empty pass cannot slip by.)
            expect(serverRun.gets.length).toBeGreaterThan(0);
            expect(cache.gets).toEqual(serverRun.gets);
            expect(cache.sets).toEqual(serverRun.sets);
            for (const key of [...cache.gets, ...cache.sets]) {
                expect(key).not.toContain('byok');
                expect(key).not.toContain(USER_KEY);
            }
        });
    });
});

describe('runAnalysis — byok-only with no modelId', () => {
    const run = (extra: { userApiKey?: string; keyPolicy?: KeyPolicy }) =>
        runAnalysis('AAPL', 'Apple Inc.', '1Day', false, undefined, {
            marketDataProvider,
            tierContext: { userId: 'u1', tier: 'free' },
            ...extra,
        });
    const raw = SCENARIOS[0].raw;

    it('is denied without a key, naming the default model, before any fetch or dispatch', async () => {
        respondWith(raw);

        await expect(run({ keyPolicy: 'byok-only' })).resolves.toMatchObject({
            status: 'key_error',
            code: 'user_api_key_required',
            modelId: DEEPSEEK_V4_1_FLASH_MODEL,
        });

        expect(dispatches()).toHaveLength(0);
        expect(mockFetchBars).not.toHaveBeenCalled();
        expect(mockResolveServerApiKey).not.toHaveBeenCalled();
    });

    it('dispatches the default model on the user key when one is supplied', async () => {
        respondWith(raw);

        const result = await run({
            keyPolicy: 'byok-only',
            userApiKey: USER_KEY,
        });

        expect(result.status).toBe('done');
        expect(dispatches()).toEqual([
            { model: DEEPSEEK_V4_1_FLASH_MODEL, key: USER_KEY },
        ]);
        expect(mockResolveServerApiKey).not.toHaveBeenCalled();
    });

    it('default policy with no modelId is unchanged: server key, no denial', async () => {
        mockResolveServerApiKey.mockReset();
        mockResolveServerApiKey.mockReturnValue(SERVER_KEY);
        respondWith(raw);

        const result = await run({});

        expect(result.status).toBe('done');
        expect(dispatches().map(c => c.key)).toEqual([SERVER_KEY]);
    });
});
