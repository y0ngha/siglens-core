import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import {
    EMPTY_INDICATOR_RESULT,
    EMPTY_SMC_RESULT,
} from '@/domain/indicators/constants';
import type {
    AnalysisResponse,
    EnrichedNewsItem,
    MarketEvent,
    NewsAnalysisResponse,
    OverallAnalysisResponse,
    Skill,
} from '@/domain/types';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';
import type { FundamentalDataProvider } from '@/domain/ports/fundamentalDataProvider';

// Only the model call, the network-ish loaders and the prompt text builder are
// stubbed. `runAnalysis`, `runAnalysisForOverall`, `runOverallAnalysis`, the
// cache-key builders and the Redis read/write semantics (via an in-memory
// provider) are the real thing — this file exists to prove they agree.
vi.mock('@/application/analysis/callAnalysisAi');
vi.mock('@/infrastructure/cache/redis');
vi.mock('@/infrastructure/skills/loader');
vi.mock('@/application/market/barsApi');
vi.mock('@/application/news/runNewsAnalysis');
vi.mock('@/domain/indicators/fearGreed', () => ({
    computeFearGreedIndex: vi.fn(() => null),
}));
vi.mock('@/domain/analysis/prompt', () => ({
    buildAnalysisPrompt: vi.fn(() => ({
        stable: 'stable',
        dynamic: 'dynamic',
        overlayCandidates: [],
        overlayBuildFailures: [],
        patternScreenFailure: null,
        patternGeometries: new Map(),
    })),
}));

import { callAnalysisAi } from '@/application/analysis/callAnalysisAi';
import { fetchBarsWithIndicators } from '@/application/market/barsApi';
import { runAnalysis } from '@/application/market/runAnalysis';
import { runNewsAnalysis } from '@/application/news/runNewsAnalysis';
import { runOverallAnalysis } from '@/application/overall/runOverallAnalysis';
import {
    OVERALL_RESPONSE_SCHEMA,
    TECHNICAL_RESPONSE_SCHEMA,
} from '@/domain/analysis/responseSchemas';
import { narrowMarketEventsForCacheKey } from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import { loadSkillsCached } from '@/infrastructure/skills/loader';

const mockCallAnalysisAi = callAnalysisAi as Mock;
const mockCreateCacheProvider = createCacheProvider as Mock;
const mockLoadSkillsCached = loadSkillsCached as Mock;
const mockFetchBars = fetchBarsWithIndicators as Mock;
const mockRunNewsAnalysis = runNewsAnalysis as Mock;

const SYMBOL = 'AAPL';
const COMPANY = 'Apple Inc.';
const MODEL_ID = 'deepseek-v4.1-flash';

const technicalRaw: AnalysisResponse = {
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

const overallRaw: OverallAnalysisResponse = {
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

const newsResult: NewsAnalysisResponse = {
    currentDriverKo: '뉴스 드라이버 요약.',
    keyEventsKo: [],
    upcomingEventsKo: [],
    overallSentiment: 'bullish',
};

const newsItem: EnrichedNewsItem = {
    id: 'news-001',
    symbol: SYMBOL,
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

const marketDataProvider = {} as MarketDataProvider;
const fundamentalProvider = {} as FundamentalDataProvider;

function makeEvent(isoTime: string): MarketEvent {
    return {
        publishedAt: new Date(isoTime),
        category: 'earnings',
        sentiment: 'bullish',
        impact: 'high',
    };
}

/** Events the technical tab saw. */
const EVENTS_AT_TECHNICAL_TAB: readonly MarketEvent[] = [
    makeEvent('2026-10-01T10:00:00Z'),
];
/** Same set plus an article ingested by the news tab in between. */
const EVENTS_AT_OVERALL_TAB: readonly MarketEvent[] = [
    ...EVENTS_AT_TECHNICAL_TAB,
    makeEvent('2026-10-04T09:00:00Z'),
];
/** One more article ingested before a later overall run. */
const EVENTS_AT_LATER_OVERALL_TAB: readonly MarketEvent[] = [
    ...EVENTS_AT_OVERALL_TAB,
    makeEvent('2026-10-04T09:30:00Z'),
];

/** Redis stand-in: values round-trip through JSON like the real Upstash client. */
function createInMemoryCache() {
    const store = new Map<string, string>();
    return {
        store,
        get: vi.fn(async (key: string) => {
            const raw = store.get(key);
            return raw === undefined ? null : (JSON.parse(raw) as unknown);
        }),
        set: vi.fn(async (key: string, value: unknown) => {
            store.set(key, JSON.stringify(value));
        }),
        delete: vi.fn(async (key: string) => {
            store.delete(key);
        }),
    };
}

/** LLM calls that used `schema`, found by the discriminating argument. */
function callsWithSchema(schema: unknown): unknown[] {
    return mockCallAnalysisAi.mock.calls.filter(
        call =>
            (call[0] as { responseSchema: unknown }).responseSchema === schema
    );
}

/** The input-hash-addressed overall entry, not its content-free peek pointer. */
function isCanonicalOverallKey(key: string): boolean {
    return key.includes(':analysis:overall:') && !key.includes(':peek:');
}

function runTechnicalTab() {
    return runAnalysis(SYMBOL, COMPANY, '1Day', false, undefined, {
        marketDataProvider,
        modelId: MODEL_ID,
        marketEvents: EVENTS_AT_TECHNICAL_TAB,
    });
}

function runOverallTab(marketEvents: readonly MarketEvent[]) {
    return runOverallAnalysis({
        symbol: SYMBOL,
        companyName: COMPANY,
        timeframe: '1Day',
        modelId: MODEL_ID,
        assetClass: 'crypto',
        technical: { marketEvents },
        newsItems: [newsItem],
        upcomingCalendar: [],
        fundamentalProvider,
        marketDataProvider,
    });
}

describe('overall reuses the technical generation produced by the technical tab', () => {
    let cache: ReturnType<typeof createInMemoryCache>;

    beforeEach(() => {
        vi.clearAllMocks();
        cache = createInMemoryCache();
        mockCreateCacheProvider.mockReturnValue(cache);
        mockLoadSkillsCached.mockResolvedValue({
            skills: [] as Skill[],
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
        mockRunNewsAnalysis.mockResolvedValue({
            status: 'done',
            result: newsResult,
        });
        mockCallAnalysisAi.mockImplementation(
            async (args: { responseSchema: unknown }) =>
                JSON.stringify(
                    args.responseSchema === OVERALL_RESPONSE_SCHEMA
                        ? overallRaw
                        : technicalRaw
                )
        );
    });

    it('the news tab changes the technical exact-key fingerprint (precondition of the bug)', () => {
        expect(
            narrowMarketEventsForCacheKey(EVENTS_AT_OVERALL_TAB).fingerprint
        ).not.toBe(
            narrowMarketEventsForCacheKey(EVENTS_AT_TECHNICAL_TAB).fingerprint
        );
    });

    it('does not call the LLM for technical again when only a new article arrived in between', async () => {
        const technical = await runTechnicalTab();
        expect(technical.status).toBe('done');
        expect(callsWithSchema(TECHNICAL_RESPONSE_SCHEMA)).toHaveLength(1);

        const overall = await runOverallTab(EVENTS_AT_OVERALL_TAB);

        expect(overall.status).toBe('done');
        expect(callsWithSchema(TECHNICAL_RESPONSE_SCHEMA)).toHaveLength(1);
        expect(callsWithSchema(OVERALL_RESPONSE_SCHEMA)).toHaveLength(1);
    });

    it('keeps the overall cache key stable across repeated runs while more articles arrive', async () => {
        await runTechnicalTab();

        const first = await runOverallTab(EVENTS_AT_OVERALL_TAB);
        const overallKeysAfterFirst = [...cache.store.keys()]
            .filter(isCanonicalOverallKey)
            .toSorted();
        const second = await runOverallTab(EVENTS_AT_LATER_OVERALL_TAB);
        const overallKeysAfterSecond = [...cache.store.keys()]
            .filter(isCanonicalOverallKey)
            .toSorted();

        expect(first.status).toBe('done');
        expect(second.status).toBe('cached');
        expect(callsWithSchema(TECHNICAL_RESPONSE_SCHEMA)).toHaveLength(1);
        expect(callsWithSchema(OVERALL_RESPONSE_SCHEMA)).toHaveLength(1);
        // Same inputHash → no new overall key was minted by the second run.
        expect(overallKeysAfterFirst.length).toBeGreaterThan(0);
        expect(overallKeysAfterSecond).toEqual(overallKeysAfterFirst);
    });

    it('still generates technical when the technical tab never ran (cold peek)', async () => {
        const overall = await runOverallTab(EVENTS_AT_OVERALL_TAB);

        expect(overall.status).toBe('done');
        expect(callsWithSchema(TECHNICAL_RESPONSE_SCHEMA)).toHaveLength(1);
    });
});
