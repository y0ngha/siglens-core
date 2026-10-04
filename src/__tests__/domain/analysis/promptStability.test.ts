import { describe, it, expect } from 'vitest';
import {
    buildAnalysisPrompt,
    CORE_SKILL_REFERENCE_POINTER,
} from '@/domain/analysis/prompt';
import { buildFundamentalAnalysisPrompt } from '@/domain/analysis/fundamentalPrompt';
import { buildFinancialsAnalysisPrompt } from '@/domain/analysis/financialsPrompt';
import { computeFinancialsScorecard } from '@/domain/analysis/financialsScorecard';
import { buildNewsAnalysisPrompt } from '@/domain/analysis/newsPrompt';
import { buildNewsCardAnalysisPrompt } from '@/domain/analysis/newsCardPrompt';
import { buildMarketNewsDigestPrompt } from '@/domain/analysis/marketNewsDigestPrompt';
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

// Spec §3.4 / plan Task 4.2 Step 1 — Design C ("skills-to-system split"): the
// assembly-split stability invariants. `stable` carries ONLY the always_on
// skill digests (empty when the catalog has none for this call) and depends
// only on (analysisType, catalog fingerprint), never on the call's
// symbol/bars/timestamp, so it can serve as a byte-identical cacheable
// system-message suffix at the worker/provider layer (see
// `scripts/ab-harness/buildPrompts.ts`'s `--fold-stable-into-system`).
// `dynamic` reproduces the ORIGINAL PRODUCTION (v0.31, pre-split) section
// order faithfully — the user prompt's ordering never changed; only the
// skill digests moved. These tests pin that contract directly against the
// shipped `{ stable, dynamic }` shape (no flattening wrapper).

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

const BRIEFING_CONTEXT = {
    marketLabel: '미국 증시',
    volatility: { label: 'VIX', level: 18.3 },
} as const;

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
        // An always_on skill so `stable` is guaranteed non-empty for this
        // assertion — with zero skills, `stable` legitimately collapses to
        // `''` (see the dedicated empty-stable test below).
        const skills = [
            makeSkill({
                name: 'Always Pattern',
                type: 'pattern',
                gating: alwaysOn,
            }),
        ];
        const { stable, dynamic } = buildAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            bars,
            indicators,
            skills,
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

    // Design C: with no `always_on` skills in the catalog, `stable` has
    // nothing to carry (only always_on skill digests ever live there) and
    // legitimately collapses to the empty string — mirroring the
    // already-established pattern in `overallPrompt`/`optionsPrompt`.
    it('stable is the empty string when the catalog has no always_on skills', () => {
        const bars = makeBars(30, 100);
        const indicators = emptyIndicators();
        const { stable } = buildAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            bars,
            indicators,
            [],
            '1Day'
        );
        expect(stable).toBe('');
    });

    // Design C ("skills-to-system split"): two prior orderings both degraded
    // actionability in A/B smoke tests — (1) moving the output rules into
    // `stable` ahead of the chart data, and (2) restoring the rules to the
    // tail but appending a `FINAL_REMINDER` recap. This design avoids the
    // regression differently: `dynamic` reproduces the ORIGINAL PRODUCTION
    // (v0.31) section order byte-for-byte, so the full "## Analysis Request"
    // block (critical response rules + field content guidance + per-type
    // writing-rule instructions) already sits at the TRUE tail — nothing was
    // ever moved away from it, so no recap is needed. Only the always_on
    // skill digests moved out of `dynamic` (into `stable`), replaced by a
    // one-line pointer at the exact spot they used to occupy.
    it('dynamic ends with the full Analysis Request block (no recap needed) — production order preserved', () => {
        const bars = makeBars(60, 150);
        const indicators = calculateIndicators(bars);
        const skills = [
            makeSkill({
                name: 'Always Pattern',
                type: 'pattern',
                gating: alwaysOn,
            }),
        ];
        const { stable, dynamic } = buildAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            bars,
            indicators,
            skills,
            '1Day'
        );

        expect(dynamic).toContain('## Analysis Request');
        // The Field Content Guidance BODY (not just the Analysis Intent
        // block's textual reference to the section name) is a reliable
        // marker for the actual output-rules block.
        const fieldGuidanceMarker =
            'Use the exact numbers provided above rather than recomputing arithmetic';
        expect(dynamic).toContain(fieldGuidanceMarker);
        // The full Analysis Request block IS the tail of `dynamic` — nothing
        // follows it (no FINAL_REMINDER-style recap in this design). With
        // only a `pattern`-type always_on skill active, the last per-type
        // instruction rendered is the patternSummaries Writing Rules' skill
        // enumeration, ending in this skill's own name.
        expect(dynamic.trimEnd().endsWith('- Always Pattern')).toBe(true);
        // Timeframe/production-order markers precede the Analysis Request
        // tail, exactly as in v0.31 (pre-split) production.
        expect(dynamic.indexOf('Timeframe:')).toBeLessThan(
            dynamic.indexOf('## Analysis Request')
        );
        // The one-line pointer replaces the always_on digest content at the
        // exact spot the combined skill-content block used to occupy.
        expect(dynamic).toContain(CORE_SKILL_REFERENCE_POINTER);
        expect(dynamic.indexOf(CORE_SKILL_REFERENCE_POINTER)).toBeLessThan(
            dynamic.indexOf('## Analysis Request')
        );
        // The digest CONTENT (the "### <name>" block) must not leak into
        // `dynamic` for a core (always_on) skill — it belongs in `stable`.
        expect(stable).toContain('### Always Pattern');
        expect(dynamic).not.toContain('### Always Pattern');
        // The output rules must NOT be in `stable` — `stable` carries ONLY
        // the always_on skill digests in this design.
        expect(stable).not.toContain('## Analysis Request');
        expect(stable).not.toContain(fieldGuidanceMarker);
        // Guidelines (incl. the Contingent Plan Mandate's textual
        // description) and the anti-fabrication guardrail now live in
        // `dynamic`, in their original production position — not `stable`.
        expect(dynamic).toContain('Contingent Plan Mandate');
        expect(stable).not.toContain('Contingent Plan Mandate');
        expect(dynamic).toContain('Anti-fabrication:');
        expect(stable).not.toContain('Anti-fabrication:');
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

    // Rules-to-tail fix: the Output Schema + Rules block lives at the END of
    // `dynamic` (after every data section), not in `stable` ahead of it — the
    // long recap that used to compensate for the opposite ordering is gone.
    // Pin: the rules block precedes the literal end, and `stable` no longer
    // carries any output-format content.
    it('buildFundamentalAnalysisPrompt: dynamic ends with the Rules block, which follows all data sections', () => {
        const { stable, dynamic } = buildFundamentalAnalysisPrompt(
            'AAPL',
            makeFundamentalSnapshot('AAPL', 'Apple Inc.'),
            []
        );
        expect(
            dynamic.endsWith(
                '- overallSentiment must reflect the balance of all 5 category sentiments.'
            )
        ).toBe(true);
        expect(dynamic.indexOf('## Sector Direction')).toBeLessThan(
            dynamic.indexOf('## Output Schema')
        );
        expect(stable).not.toContain('## Output Schema');
        expect(stable).not.toContain('Rules:');
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

    it('buildFinancialsAnalysisPrompt: dynamic ends with the Rules block, which follows all data sections', () => {
        const scorecard = computeFinancialsScorecard(EMPTY_FINANCIALS);
        const { stable, dynamic } = buildFinancialsAnalysisPrompt(
            'AAPL',
            EMPTY_FINANCIALS,
            scorecard,
            []
        );
        expect(
            dynamic.endsWith(
                '- overallSentiment must reflect the balance of all 4 axis sentiments.'
            )
        ).toBe(true);
        expect(dynamic.indexOf('## Scorecard Summary')).toBeLessThan(
            dynamic.indexOf('## Output Schema')
        );
        expect(stable).not.toContain('## Output Schema');
        expect(stable).not.toContain('Rules:');
    });

    it('buildNewsAnalysisPrompt: stable is symbol invariant', () => {
        const a = buildNewsAnalysisPrompt('AAPL', [], [], []);
        const b = buildNewsAnalysisPrompt('TSLA', [], [], []);
        expect(a.stable).toBe(b.stable);
        expect(a.stable).not.toContain('AAPL');
        expect(a.stable).not.toContain('TSLA');
    });

    it('buildNewsAnalysisPrompt: dynamic ends with the Rules block, which follows all data sections', () => {
        const { stable, dynamic } = buildNewsAnalysisPrompt('AAPL', [], [], []);
        expect(
            dynamic.endsWith(
                '- overallSentiment reflects the net directional bias of the provided news flow only.'
            )
        ).toBe(true);
        expect(
            dynamic.indexOf('## Upcoming / Recent Earnings Calendar')
        ).toBeLessThan(dynamic.indexOf('## Output Schema'));
        expect(stable).not.toContain('## Output Schema');
        expect(stable).not.toContain('Rules:');
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

    it.each(['ko', 'en'] as const)(
        'buildNewsCardAnalysisPrompt: non-empty stable is identical across symbol/title/content/truncation/source language (%s)',
        locale => {
            const makeItem = (
                symbol: string,
                titleEn: string,
                bodyEn: string | null,
                extra: Partial<NewsItem> = {}
            ): NewsItem => ({
                id: 'n1',
                symbol,
                source: 'Reuters',
                url: 'https://example.com/article',
                publishedAt: '2025-04-28T14:30:00Z',
                titleEn,
                bodyEn,
                ...extra,
            });
            const a = buildNewsCardAnalysisPrompt(
                makeItem('NVDA', 'Nvidia unveils chip', 'Body A'),
                locale
            );
            const b = buildNewsCardAnalysisPrompt(
                makeItem('005930.KS', '삼성전자 실적', '본문 B', {
                    sourceLanguage: 'ko',
                    bodyTruncated: true,
                }),
                locale
            );
            expect(a.stable).not.toBe('');
            expect(a.stable).toBe(b.stable);
            expect(a.dynamic).not.toBe(b.dynamic);
        }
    );

    it('buildMarketNewsDigestPrompt: stable is category-label invariant', () => {
        const a = buildMarketNewsDigestPrompt('미국 암호화폐', [], []);
        const b = buildMarketNewsDigestPrompt('미국 원자재', [], []);
        expect(a.stable).toBe(b.stable);
        expect(a.stable).not.toContain('미국 암호화폐');
        expect(a.stable).not.toContain('미국 원자재');
    });

    it('buildMarketNewsDigestPrompt: dynamic ends with the Rules block, which follows all data sections', () => {
        const { stable, dynamic } = buildMarketNewsDigestPrompt(
            '미국 암호화폐',
            [],
            []
        );
        expect(
            dynamic.endsWith(
                '- overallSentiment reflects the net directional bias of the provided news flow only.'
            )
        ).toBe(true);
        expect(dynamic.indexOf('## Recent News Articles')).toBeLessThan(
            dynamic.indexOf('## Output Schema')
        );
        expect(stable).not.toContain('## Output Schema');
        expect(stable).not.toContain('Rules:');
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

    // Tiny-builder rules-to-tail pin: the Output Schema (the only part of
    // this builder that was ever in `stable`) now lives at the tail of
    // `dynamic`, after all four axis sections, alongside the Rules and
    // Few-Shot blocks that were already there. `stable` carries no
    // catalog-level content for this builder, so it is empty.
    it('buildOverallAnalysisPrompt: stable is empty; Output Schema sits at the tail of dynamic, after axis data', () => {
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
        const { stable, dynamic } = buildOverallAnalysisPrompt(
            'AAPL',
            'Apple Inc.',
            technical,
            fundamental,
            news,
            '1Day'
        );
        expect(stable).toBe('');
        expect(dynamic.indexOf('## Financials Scorecard')).toBeLessThan(
            dynamic.indexOf('## Output Schema')
        );
        expect(dynamic.indexOf('## Output Schema')).toBeLessThan(
            dynamic.indexOf('Rules:')
        );
        expect(dynamic.indexOf('Rules:')).toBeLessThan(
            dynamic.indexOf('## Few-Shot')
        );
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

    it('buildCongressTrendPrompt: dynamic ends with the Rules block, which follows Recent Trades', () => {
        const stats: CongressTradeStats = {
            buyCount: 3,
            sellCount: 1,
            unknownCount: 0,
            direction: 'net_buying',
            uniqueMembers: 2,
            senateCount: 2,
            houseCount: 2,
        };
        const { stable, dynamic } = buildCongressTrendPrompt(
            'AAPL',
            [],
            stats,
            []
        );
        expect(
            dynamic.endsWith(
                'Base overallSentiment on the provided net direction (net_buying), not your own count.'
            )
        ).toBe(true);
        expect(dynamic.indexOf('## Recent Trades')).toBeLessThan(
            dynamic.indexOf('## Output Schema')
        );
        expect(stable).not.toContain('## Output Schema');
        expect(stable).not.toContain('Rules:');
        // Design C: `stable` carries ONLY the Domain Skills (Active) digest
        // section — IMPORTANT Caveats returns to `dynamic`, in its original
        // production position (right after the skill section, before Output
        // Schema).
        expect(stable).toContain('## Domain Skills (Active)');
        expect(stable).not.toContain('## IMPORTANT Caveats');
        expect(dynamic).toContain('## IMPORTANT Caveats');
        expect(dynamic.indexOf('## Recent Trades')).toBeLessThan(
            dynamic.indexOf('## IMPORTANT Caveats')
        );
        expect(dynamic.indexOf('## IMPORTANT Caveats')).toBeLessThan(
            dynamic.indexOf('## Output Schema')
        );
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
        const a = buildMarketBriefingPrompt(
            indicesA,
            sectors,
            BRIEFING_CONTEXT
        );
        const b = buildMarketBriefingPrompt(
            indicesB,
            sectors,
            BRIEFING_CONTEXT
        );
        expect(a.stable).toBe(b.stable);
        expect(a.stable).not.toContain('S&P 500');
        expect(a.stable).not.toContain('Nasdaq 100');
    });

    it('buildMarketBriefingPrompt: dynamic ends with the JSON schema, which follows the index/sector rows', () => {
        const indices: MarketIndexData[] = [
            {
                symbol: 'GSPC',
                fmpSymbol: '^GSPC',
                displayName: 'S&P 500',
                koreanName: '미국 대형주 500',
                price: 5200.5,
                changesPercentage: 0.45,
            },
        ];
        const { stable, dynamic } = buildMarketBriefingPrompt(
            indices,
            [],
            BRIEFING_CONTEXT
        );
        // Design C: this builder has no skills (spec §3.2), so it was fully
        // reverted to the exact v0.31 production order — the JSON schema
        // precedes the index/sector data rows, which sit at the true tail.
        expect(dynamic.indexOf('Schema (')).toBeLessThan(
            dynamic.indexOf('주요 지수:')
        );
        expect(dynamic.indexOf('주요 지수:')).toBeLessThan(
            dynamic.indexOf('섹터 등락률 (rank')
        );
        // Precomputed prompt data (spec 2026-09-18 §2.9): the sector rows are
        // followed by Breadth + Best-worst-spread lines, which are now the
        // true tail (empty sectors here, so the spread line renders N/A).
        expect(
            dynamic.trimEnd().endsWith('Best − worst sector spread: N/A')
        ).toBe(true);
        expect(stable).toBe('');
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

    // No skills, no other catalog-level knowledge (spec §3.2) — `stable` is
    // empty, and the Output Schema + Interpretation Guide sit at the tail of
    // `dynamic`, after the Key Metrics data.
    it('buildOptionsAnalysisPrompt: stable is empty; Output Schema + Interpretation Guide sit at the tail of dynamic', () => {
        const snapshot: OptionsSnapshot = {
            symbol: 'ZZZZ',
            underlyingPrice: 198,
            capturedAt: '2026-05-14T16:00:00Z',
            chains: [],
        };
        const { stable, dynamic } = buildOptionsAnalysisPrompt({
            expirationDate: 'all',
            companyName: 'Acme Corp.',
            snapshot,
        });
        expect(stable).toBe('');
        expect(dynamic.indexOf('== Key Metrics by Expiration ==')).toBeLessThan(
            dynamic.indexOf('== Output Schema ==')
        );
        expect(dynamic.indexOf('== Output Schema ==')).toBeLessThan(
            dynamic.indexOf('== Interpretation Guide ==')
        );
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
        const now = new Date('2026-06-15T00:00:00Z');
        const a = buildMacroBriefingPrompt(snapA, now);
        const b = buildMacroBriefingPrompt(snapB, now);
        expect(a.stable).toBe(b.stable);
        expect(a.stable).not.toContain('Fed Rate Decision');
        expect(a.stable).not.toContain('CPI Release');
    });

    it('buildMacroBriefingPrompt: dynamic ends with the JSON schema, which follows the indicator/calendar data', () => {
        const snap: EconomySnapshot = {
            indicators: [],
            treasury: null,
            calendar: [],
        };
        const { stable, dynamic } = buildMacroBriefingPrompt(
            snap,
            new Date('2026-06-15T00:00:00Z')
        );
        // Design C: this builder has no skills (spec §3.2), so it was fully
        // reverted to the exact v0.31 production order — the JSON schema
        // precedes the indicator/calendar data rows, which sit at the true
        // tail.
        expect(dynamic.indexOf('Schema (')).toBeLessThan(
            dynamic.indexOf('## 경제지표')
        );
        expect(dynamic.indexOf('## 경제지표')).toBeLessThan(
            dynamic.indexOf('임박 경제 이벤트')
        );
        expect(dynamic.trimEnd().endsWith('(없음)')).toBe(true);
        expect(stable).toBe('');
    });

    it('buildEconomicEventAnalysisPrompt: stable is event-name invariant', () => {
        // Note: the static few-shot block hardcodes its own illustrative
        // events ("CPI MoM", "CPI YoY", "10-Year KTB Auction"), so the per-call markers
        // here use different event names to avoid a false collision.
        const base: Omit<EconomicEventAnalysisInput, 'event'> = {
            region: '미국',
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

    it('buildEconomicEventAnalysisPrompt: dynamic ends with the Few-shot examples, which follow the Event Details', () => {
        const { stable, dynamic } = buildEconomicEventAnalysisPrompt({
            region: '미국',
            impact: 'High',
            actual: 0.2,
            estimate: 0.3,
            previous: 0.4,
            unit: '%',
            event: 'Retail Sales MoM',
        });
        expect(dynamic.indexOf('## Event Details')).toBeLessThan(
            dynamic.indexOf('## Output Schema')
        );
        expect(dynamic.indexOf('## Output Schema')).toBeLessThan(
            dynamic.indexOf('## Few-shot examples')
        );
        expect(stable).not.toContain('## Output Schema');
        expect(stable).not.toContain('## Few-shot examples');
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

    it('buildIndicatorTranslationPrompt: dynamic ends with the Few-shot examples, which follow the Indicator Name', () => {
        const { stable, dynamic } = buildIndicatorTranslationPrompt(
            'Producer Price Index'
        );
        expect(dynamic.indexOf('## Indicator Name')).toBeLessThan(
            dynamic.indexOf('## Output Schema')
        );
        expect(dynamic.indexOf('## Output Schema')).toBeLessThan(
            dynamic.indexOf('## Few-shot examples')
        );
        expect(stable).not.toContain('## Output Schema');
        expect(stable).not.toContain('## Few-shot examples');
    });
});
