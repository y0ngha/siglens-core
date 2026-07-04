import { describe, it, expect } from 'vitest';
import { buildAnalysisPrompt, CONTRACT_RECAP } from '@/domain/analysis/prompt';
import {
    buildFundamentalAnalysisPrompt,
    FUNDAMENTAL_CONTRACT_RECAP,
} from '@/domain/analysis/fundamentalPrompt';
import {
    buildFinancialsAnalysisPrompt,
    FINANCIALS_CONTRACT_RECAP,
} from '@/domain/analysis/financialsPrompt';
import { computeFinancialsScorecard } from '@/domain/analysis/financialsScorecard';
import {
    buildNewsAnalysisPrompt,
    NEWS_CONTRACT_RECAP,
} from '@/domain/analysis/newsPrompt';
import { buildNewsCardAnalysisPrompt } from '@/domain/analysis/newsCardPrompt';
import {
    buildMarketNewsDigestPrompt,
    MARKET_NEWS_DIGEST_CONTRACT_RECAP,
} from '@/domain/analysis/marketNewsDigestPrompt';
import { buildOverallAnalysisPrompt } from '@/domain/analysis/overallPrompt';
import { buildCongressTrendPrompt } from '@/domain/analysis/congressTrendPrompt';
import { buildMarketBriefingPrompt } from '@/domain/analysis/marketBriefingPrompt';
import { buildOptionsAnalysisPrompt } from '@/domain/options/optionsPrompt';
import { buildMacroBriefingPrompt } from '@/domain/economy/macroBriefingPrompt';
import { buildEconomicEventAnalysisPrompt } from '@/domain/economy/economicEventPrompt';
import { buildIndicatorTranslationPrompt } from '@/domain/economy/indicatorTranslationPrompt';
import { calculateIndicators } from '@/domain/indicators';
import {
    EMPTY_INDICATOR_RESULT,
    EMPTY_SMC_RESULT,
} from '@/domain/indicators/constants';
import type {
    AnalysisResponse,
    Bar,
    CongressTradeStats,
    EconomySnapshot,
    FinancialsSnapshot,
    FundamentalAnalysisResponse,
    FundamentalSnapshot,
    IndicatorResult,
    MarketIndexData,
    MarketSectorData,
    NewsAnalysisResponse,
    NewsItem,
    Skill,
    SkillGating,
} from '@/domain/types';
import type { EconomicEventAnalysisInput } from '@/domain/economy/types';
import type { OptionsSnapshot } from '@/domain/options/types';

// Spec §3.4 / plan Task 4.2 Step 1 — the assembly-split stability invariants:
// `stable` depends only on (analysisType, catalog fingerprint), never on the
// call's symbol/bars/timestamp, so it can serve as a byte-identical cacheable
// prefix at the worker/provider layer. These tests pin that contract directly
// against the shipped `{ stable, dynamic }` shape (no flattening wrapper).

const emptyIndicators = (): IndicatorResult => ({
    ...EMPTY_INDICATOR_RESULT,
    smc: EMPTY_SMC_RESULT,
});

const makeBars = (count: number, startClose: number): Bar[] =>
    Array.from({ length: count }, (_, i) => {
        const close = startClose + i;
        return {
            time: 1_700_000_000 + i * 86_400,
            open: close - 0.5,
            high: close + 1,
            low: close - 1,
            close,
            volume: 1_000_000 + i * 1_000,
        };
    });

const alwaysOn: SkillGating = { tier: 'always_on' };
const eventGated = (triggers: string[]): SkillGating => ({
    tier: 'gated',
    signalKind: 'event',
    triggers,
});

const makeSkill = (overrides: Partial<Skill>): Skill => ({
    name: 'Skill',
    description: 'desc',
    indicators: [],
    confidenceWeight: 0.8,
    content: '## Body\n- content',
    ...overrides,
});

describe('buildAnalysisPrompt — stable/dynamic assembly-split invariants (spec §3.4)', () => {
    it('stable part is byte-identical across symbols/bars and contains no per-call values', () => {
        const skills = [
            makeSkill({
                name: 'Always Pattern',
                type: 'pattern',
                gating: alwaysOn,
            }),
            makeSkill({
                name: 'RSI Guide',
                type: 'indicator_guide',
                gating: eventGated(['rsi_oversold']),
            }),
        ];
        const barsA = makeBars(60, 100);
        const barsB = makeBars(60, 400);
        const indA = calculateIndicators(barsA);
        const indB = calculateIndicators(barsB);

        const a = buildAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            barsA,
            indA,
            skills,
            '1Day'
        );
        const b = buildAnalysisPrompt(
            'TSLA',
            'Tesla Inc.',
            barsB,
            indB,
            skills,
            '1Day'
        );

        expect(a.stable).toBe(b.stable);
        expect(a.stable).not.toContain('AAPL');
        expect(a.stable).not.toContain('TSLA');
        expect(a.stable).not.toContain('Apple Inc.');
    });

    it('stable contains no symbol or company name — only dynamic carries per-call framing', () => {
        const { stable, dynamic } = buildAnalysisPrompt(
            'MSFT',
            'Microsoft Corporation',
            makeBars(40, 300),
            calculateIndicators(makeBars(40, 300)),
            [],
            '1Day'
        );
        expect(stable).not.toContain('MSFT');
        expect(stable).not.toContain('Microsoft Corporation');
        // The symbol/company framing line lives in dynamic instead.
        expect(dynamic).toContain('MSFT');
        expect(dynamic).toContain('Microsoft Corporation');
    });

    it('is deterministic: identical inputs build byte-identical stable AND dynamic across two calls', () => {
        const bars = makeBars(60, 150);
        const indicators = calculateIndicators(bars);
        const skills = [
            makeSkill({ name: 'B Pattern', type: 'pattern', gating: alwaysOn }),
            makeSkill({ name: 'A Pattern', type: 'pattern', gating: alwaysOn }),
        ];

        const first = buildAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            bars,
            indicators,
            skills,
            '1Day'
        );
        const second = buildAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            bars,
            indicators,
            skills,
            '1Day'
        );

        expect(first.stable).toBe(second.stable);
        expect(first.dynamic).toBe(second.dynamic);
    });

    it('always_on (core) skill content lands in stable; chart-gated (selected) skill content lands in dynamic', () => {
        const coreSkill = makeSkill({
            name: 'Always Pattern Guide',
            type: 'pattern',
            gating: alwaysOn,
        });
        const gatedSkill = makeSkill({
            name: 'Downtrend RSI Guide',
            type: 'indicator_guide',
            gating: eventGated([
                'rsi_oversold',
                'macd_bearish_cross',
                'supertrend_bearish_flip',
                'cci_bearish_cross',
                'dmi_bearish_cross',
            ]),
        });
        // A clear downtrend so the gated skill's trigger signal fires.
        const bars = makeBars(60, 200).map((b, i) => {
            const close = 200 - i * 2;
            return {
                ...b,
                open: close + 0.5,
                high: close + 1,
                low: close - 1,
                close,
            };
        });
        const indicators = calculateIndicators(bars);

        const { stable, dynamic } = buildAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            bars,
            indicators,
            [coreSkill, gatedSkill],
            '1Day'
        );

        // The digest CONTENT block (the `buildSkillBlock` "### <name> ..."
        // header immediately followed by the skill body) is what's actually
        // stable/dynamic-split. The gated-skill's plain name may still appear
        // in `dynamic`'s per-type "Skills ... list to analyze:" enumeration
        // (it must — the writing-rule checklist covers core ∪ selected), so
        // this asserts on the digest-block marker, not the bare name.
        expect(stable).toContain('### Always Pattern Guide');
        expect(dynamic).not.toContain('### Always Pattern Guide');
        expect(dynamic).toContain('### Downtrend RSI Guide');
        expect(stable).not.toContain('### Downtrend RSI Guide');
    });

    it('combining stable + dynamic with exactly "\\n\\n" reproduces the legacy single-string prompt content', () => {
        const bars = makeBars(30, 100);
        const indicators = emptyIndicators();
        const { stable, dynamic } = buildAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            bars,
            indicators,
            [],
            '1Day'
        );
        const combined = `${stable}\n\n${dynamic}`;
        // Both halves are non-empty and the join is the exact contract dispatch
        // relies on (`prompt: stable + '\n\n' + dynamic`, `seed: analysisSeed(combined)`).
        expect(stable.length).toBeGreaterThan(0);
        expect(dynamic.length).toBeGreaterThan(0);
        expect(combined).toContain('## Analysis Intent');
        expect(combined).toContain('AAPL');
    });

    // A/B smoke test on the stable-first ordering found actionability
    // collapse (entry==target, null top-level plan fields): the Contingent
    // Plan Mandate lives in `stable`, far ahead of the chart data the model
    // reasons over. CONTRACT_RECAP is the instruction-sandwiching fix — a
    // compact, timeless recap appended as the LAST section of `dynamic` so
    // rule recency survives regardless of how much data precedes it. Pin the
    // order directly: it must be the literal suffix of `dynamic`, after the
    // per-type writing-rule/active-skill-name request block.
    it('dynamic ends with CONTRACT_RECAP (instruction-sandwiching order pin)', () => {
        const bars = makeBars(60, 150);
        const indicators = calculateIndicators(bars);
        const { dynamic } = buildAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            bars,
            indicators,
            [],
            '1Day'
        );

        expect(dynamic.endsWith(CONTRACT_RECAP)).toBe(true);
        expect(dynamic).toContain('Contingent Plan Mandate');
    });
});

// Spec §3.4 / plan Task 4.2 Step 1 — only `buildAnalysisPrompt` (technical) had
// a dedicated stable-boundary test above. The remaining 12 worker-dispatched
// split builders share the same `{ stable, dynamic }` contract but had no
// test pinning it, so any of them could silently start leaking a per-call
// value (symbol, company name, event name, ...) into `stable` without any
// test failing. One minimal boundary assertion per builder below: build twice
// with two distinct per-call fixtures and assert `stable` is byte-identical
// and never contains the distinctive per-call marker.

const makeFundamentalSnapshot = (
    symbol: string,
    companyName: string
): FundamentalSnapshot => ({
    profile: {
        symbol,
        companyName,
        sector: 'Technology',
        industry: 'Consumer Electronics',
        marketCap: 3_000_000_000_000,
        ceo: 'Tim Cook',
        website: 'https://example.com',
        description: 'A company.',
    },
    valuation: {
        per: 28.5,
        psr: 7.2,
        pbr: 45.1,
        peg: 2.1,
        evToEbitda: 22.4,
        eps: 6.13,
    },
    peers: [],
    profitability: {
        roe: 160.5,
        roa: 28.3,
        operatingMargin: 30.1,
        netMargin: 25.3,
    },
    growth: { revenueYoy: 8.2, epsYoy: 12.5 },
    health: {
        debtRatio: 1.76,
        currentRatio: 0.94,
        operatingCashFlow: 110_000_000_000,
        altmanZScore: 4.2,
        piotroskiScore: 7,
    },
    futureDirection: {
        nextEarningsAt: '2025-07-30',
        analystEstimateEps: 6.5,
        analystEstimateRevenue: 95_000_000_000,
        gradesConsensus: {
            strongBuy: 20,
            buy: 15,
            hold: 5,
            sell: 1,
            strongSell: 0,
        },
        priceTargetConsensus: {
            high: 250,
            low: 180,
            median: 215,
            consensus: 212,
        },
        priceTargetSummary: { month1Avg: 210, month3Avg: 208, year1Avg: 200 },
    },
    sectorDirection: { todayChangePct: 1.2, historical: [] },
});

const EMPTY_FINANCIALS: FinancialsSnapshot = {
    income: [],
    balance: [],
    cashFlow: [],
    incomeGrowth: [],
    financialGrowth: [],
    cashFlowGrowth: [],
};

describe('split builders — stable/dynamic assembly-split boundary invariants (spec §3.4)', () => {
    it('buildFundamentalAnalysisPrompt: stable is symbol/company invariant', () => {
        const a = buildFundamentalAnalysisPrompt(
            'AAPL',
            makeFundamentalSnapshot('AAPL', 'Apple Inc.'),
            []
        );
        const b = buildFundamentalAnalysisPrompt(
            'MSFT',
            makeFundamentalSnapshot('MSFT', 'Microsoft Corporation'),
            []
        );
        expect(a.stable).toBe(b.stable);
        expect(a.stable).not.toContain('AAPL');
        expect(a.stable).not.toContain('Microsoft Corporation');
    });

    // Mini-recap tail (instruction sandwiching): the Output Schema + Rules
    // block lives only in `stable`, ahead of every data section. Pin that
    // `dynamic` ends with the timeless recap so rule recency survives
    // regardless of data length.
    it('buildFundamentalAnalysisPrompt: dynamic ends with FUNDAMENTAL_CONTRACT_RECAP', () => {
        const { dynamic } = buildFundamentalAnalysisPrompt(
            'AAPL',
            makeFundamentalSnapshot('AAPL', 'Apple Inc.'),
            []
        );
        expect(dynamic.endsWith(FUNDAMENTAL_CONTRACT_RECAP)).toBe(true);
    });

    it('buildFinancialsAnalysisPrompt: stable is symbol invariant', () => {
        const scorecard = computeFinancialsScorecard(EMPTY_FINANCIALS);
        const a = buildFinancialsAnalysisPrompt(
            'AAPL',
            EMPTY_FINANCIALS,
            scorecard,
            []
        );
        const b = buildFinancialsAnalysisPrompt(
            'MSFT',
            EMPTY_FINANCIALS,
            scorecard,
            []
        );
        expect(a.stable).toBe(b.stable);
        expect(a.stable).not.toContain('AAPL');
        expect(a.stable).not.toContain('MSFT');
    });

    it('buildFinancialsAnalysisPrompt: dynamic ends with FINANCIALS_CONTRACT_RECAP', () => {
        const scorecard = computeFinancialsScorecard(EMPTY_FINANCIALS);
        const { dynamic } = buildFinancialsAnalysisPrompt(
            'AAPL',
            EMPTY_FINANCIALS,
            scorecard,
            []
        );
        expect(dynamic.endsWith(FINANCIALS_CONTRACT_RECAP)).toBe(true);
    });

    it('buildNewsAnalysisPrompt: stable is symbol invariant', () => {
        const a = buildNewsAnalysisPrompt('AAPL', [], [], []);
        const b = buildNewsAnalysisPrompt('TSLA', [], [], []);
        expect(a.stable).toBe(b.stable);
        expect(a.stable).not.toContain('AAPL');
        expect(a.stable).not.toContain('TSLA');
    });

    it('buildNewsAnalysisPrompt: dynamic ends with NEWS_CONTRACT_RECAP', () => {
        const { dynamic } = buildNewsAnalysisPrompt('AAPL', [], [], []);
        expect(dynamic.endsWith(NEWS_CONTRACT_RECAP)).toBe(true);
    });

    it('buildNewsCardAnalysisPrompt: stable is symbol/title invariant', () => {
        const makeItem = (symbol: string, titleEn: string): NewsItem => ({
            id: 'n1',
            symbol,
            source: 'Reuters',
            url: 'https://example.com/article',
            publishedAt: '2025-04-28T14:30:00Z',
            titleEn,
            bodyEn: null,
        });
        const a = buildNewsCardAnalysisPrompt(
            makeItem('NVDA', 'Nvidia unveils next-gen AI chip platform')
        );
        const b = buildNewsCardAnalysisPrompt(
            makeItem('TSLA', 'Tesla misses Q1 delivery estimates')
        );
        expect(a.stable).toBe(b.stable);
        expect(a.stable).not.toContain('NVDA');
        expect(a.stable).not.toContain('TSLA');
    });

    it('buildMarketNewsDigestPrompt: stable is category-label invariant', () => {
        const a = buildMarketNewsDigestPrompt('미국 암호화폐', [], []);
        const b = buildMarketNewsDigestPrompt('미국 원자재', [], []);
        expect(a.stable).toBe(b.stable);
        expect(a.stable).not.toContain('미국 암호화폐');
        expect(a.stable).not.toContain('미국 원자재');
    });

    it('buildMarketNewsDigestPrompt: dynamic ends with MARKET_NEWS_DIGEST_CONTRACT_RECAP', () => {
        const { dynamic } = buildMarketNewsDigestPrompt(
            '미국 암호화폐',
            [],
            []
        );
        expect(dynamic.endsWith(MARKET_NEWS_DIGEST_CONTRACT_RECAP)).toBe(true);
    });

    it('buildOverallAnalysisPrompt: stable is symbol/company invariant', () => {
        const technical: AnalysisResponse = {
            summary: 'technical summary',
            trend: 'bearish',
            indicatorResults: [],
            riskLevel: 'high',
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
        const fundamental: FundamentalAnalysisResponse = {
            overallConclusionKo: 'conclusion',
            categoryAssessments: [],
            riskFactorsKo: [],
            overallSentiment: 'neutral',
        };
        const news: NewsAnalysisResponse = {
            currentDriverKo: 'driver',
            keyEventsKo: [],
            upcomingEventsKo: [],
            overallSentiment: 'neutral',
        };
        const a = buildOverallAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            technical,
            fundamental,
            news,
            '1Day'
        );
        const b = buildOverallAnalysisPrompt(
            'TSLA',
            'Tesla, Inc.',
            technical,
            fundamental,
            news,
            '1Day'
        );
        expect(a.stable).toBe(b.stable);
        expect(a.stable).not.toContain('AAPL');
        expect(a.stable).not.toContain('Apple Inc.');
        expect(a.stable).not.toContain('TSLA');
    });

    it('buildCongressTrendPrompt: stable is symbol invariant', () => {
        const stats: CongressTradeStats = {
            buyCount: 3,
            sellCount: 1,
            unknownCount: 0,
            direction: 'net_buying',
            uniqueMembers: 2,
            senateCount: 2,
            houseCount: 2,
        };
        const a = buildCongressTrendPrompt('AAPL', [], stats, []);
        const b = buildCongressTrendPrompt('TSLA', [], stats, []);
        expect(a.stable).toBe(b.stable);
        expect(a.stable).not.toContain('AAPL');
        expect(a.stable).not.toContain('TSLA');
    });

    it('buildMarketBriefingPrompt: stable is index/sector-data invariant', () => {
        const indicesA: MarketIndexData[] = [
            {
                symbol: 'GSPC',
                fmpSymbol: '^GSPC',
                displayName: 'S&P 500',
                koreanName: '미국 대형주 500',
                price: 5200.5,
                changesPercentage: 0.45,
            },
        ];
        const indicesB: MarketIndexData[] = [
            {
                symbol: 'IXIC',
                fmpSymbol: '^IXIC',
                displayName: 'Nasdaq 100',
                koreanName: '나스닥 100',
                price: 18_000.1,
                changesPercentage: -1.1,
            },
        ];
        const sectors: MarketSectorData[] = [];
        const a = buildMarketBriefingPrompt(indicesA, sectors);
        const b = buildMarketBriefingPrompt(indicesB, sectors);
        expect(a.stable).toBe(b.stable);
        expect(a.stable).not.toContain('S&P 500');
        expect(a.stable).not.toContain('Nasdaq 100');
    });

    it('buildOptionsAnalysisPrompt: stable is symbol/company invariant', () => {
        // Note: the static Interpretation Guide text uses "AAPL" as its own
        // illustrative example (`e.g. AAPL`), so the per-call markers here
        // must be symbols/names that never appear in that static guide.
        const snapshotA: OptionsSnapshot = {
            symbol: 'ZZZZ',
            underlyingPrice: 198,
            capturedAt: '2026-05-14T16:00:00Z',
            chains: [],
        };
        const snapshotB: OptionsSnapshot = {
            symbol: 'QQQQ',
            underlyingPrice: 420,
            capturedAt: '2026-05-14T16:00:00Z',
            chains: [],
        };
        const a = buildOptionsAnalysisPrompt({
            expirationDate: 'all',
            companyName: 'Acme Corp.',
            snapshot: snapshotA,
        });
        const b = buildOptionsAnalysisPrompt({
            expirationDate: 'all',
            companyName: 'Globex Inc.',
            snapshot: snapshotB,
        });
        expect(a.stable).toBe(b.stable);
        expect(a.stable).not.toContain('ZZZZ');
        expect(a.stable).not.toContain('Globex Inc.');
    });

    it('buildMacroBriefingPrompt: stable is indicator/calendar-data invariant', () => {
        const snapA: EconomySnapshot = {
            indicators: [],
            treasury: null,
            calendar: [
                {
                    date: '2026-06-17 14:00:00',
                    event: 'Fed Rate Decision',
                    impact: 'High',
                    actual: null,
                    estimate: 3.63,
                    previous: 3.63,
                    unit: '%',
                },
            ],
        };
        const snapB: EconomySnapshot = {
            indicators: [],
            treasury: null,
            calendar: [
                {
                    date: '2026-07-02 08:30:00',
                    event: 'CPI Release',
                    impact: 'High',
                    actual: null,
                    estimate: 0.2,
                    previous: 0.3,
                    unit: '%',
                },
            ],
        };
        const a = buildMacroBriefingPrompt(snapA);
        const b = buildMacroBriefingPrompt(snapB);
        expect(a.stable).toBe(b.stable);
        expect(a.stable).not.toContain('Fed Rate Decision');
        expect(a.stable).not.toContain('CPI Release');
    });

    it('buildEconomicEventAnalysisPrompt: stable is event-name invariant', () => {
        // Note: the static few-shot block hardcodes its own illustrative
        // events ("CPI MoM", "Fed Rate Decision"), so the per-call markers
        // here use different event names to avoid a false collision.
        const base: Omit<EconomicEventAnalysisInput, 'event'> = {
            impact: 'High',
            actual: 0.2,
            estimate: 0.3,
            previous: 0.4,
            unit: '%',
        };
        const a = buildEconomicEventAnalysisPrompt({
            ...base,
            event: 'Retail Sales MoM',
        });
        const b = buildEconomicEventAnalysisPrompt({
            ...base,
            event: 'Housing Starts',
        });
        expect(a.stable).toBe(b.stable);
        expect(a.stable).not.toContain('Retail Sales MoM');
        expect(a.stable).not.toContain('Housing Starts');
    });

    it('buildIndicatorTranslationPrompt: stable is indicator-name invariant', () => {
        // Note: the static few-shot block hardcodes its own illustrative
        // indicator names (Unemployment Claims, Core CPI MoM, Nonfarm
        // Payrolls, Core PCE Price Index YoY, ISM Manufacturing PMI), so the
        // per-call markers here use different indicator names to avoid a
        // false collision.
        const a = buildIndicatorTranslationPrompt('Producer Price Index');
        const b = buildIndicatorTranslationPrompt('Consumer Confidence Index');
        expect(a.stable).toBe(b.stable);
        expect(a.stable).not.toContain('Producer Price Index');
        expect(a.stable).not.toContain('Consumer Confidence Index');
    });
});
