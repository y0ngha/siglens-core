import { describe, it, expect } from 'vitest';
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { buildNewsAnalysisPrompt } from '@/domain/analysis/newsPrompt';
import { buildFundamentalAnalysisPrompt } from '@/domain/analysis/fundamentalPrompt';
import { calculateIndicators } from '@/domain/indicators';
import { EMPTY_SMC_RESULT } from '@/domain/indicators/constants';
import type {
    Bar,
    EarningsCalendarItem,
    EnrichedNewsItem,
    FundamentalSnapshot,
    IndicatorResult,
    Skill,
    SkillGating,
} from '@/domain/types';

const TEST_SYMBOL = 'AAPL';
const TEST_COMPANY = 'Apple Inc.';

/** Deterministic ascending bar series long enough to warm every indicator. */
const makeBars = (count: number, startClose = 100): Bar[] =>
    Array.from({ length: count }, (_, i) => {
        const close = startClose + i;
        return {
            time: 1_700_000_000 + i * 86_400,
            open: close - 0.5,
            high: close + 1,
            low: close - 1,
            close,
            volume: 1_000_000 + i * 1000,
        };
    });

const emptyIndicators = (): IndicatorResult => ({
    rsi: [],
    cci: [],
    vwap: [],
    macd: [],
    bollinger: [],
    dmi: [],
    stochastic: [],
    stochRsi: [],
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
});

const makeSkill = (overrides: Partial<Skill>): Skill => ({
    name: 'Skill',
    description: 'desc',
    indicators: [],
    confidenceWeight: 0.8,
    content: '## Body\n- content',
    ...overrides,
});

const alwaysOn: SkillGating = { tier: 'always_on' };
const eventGated = (triggers: string[]): SkillGating => ({
    tier: 'gated',
    signalKind: 'event',
    triggers,
});

const build = (skills: Skill[], bars: Bar[], indicators: IndicatorResult) =>
    buildAnalysisPrompt(
        TEST_SYMBOL,
        TEST_COMPANY,
        bars,
        indicators,
        skills,
        '1Day'
    );

describe('buildAnalysisPrompt gating (chart only)', () => {
    it('always_on skill is injected regardless of context', () => {
        const skill = makeSkill({
            name: 'Always Pattern',
            type: 'pattern',
            gating: alwaysOn,
        });
        const out = build([skill], [], emptyIndicators());
        expect(out).toContain('Always Pattern');
    });

    it('event-gated skill is excluded when its trigger signal is absent', () => {
        const skill = makeSkill({
            name: 'RSI Guide',
            type: 'indicator_guide',
            gating: eventGated(['rsi_oversold']),
        });
        // Flat/empty indicators → no rsi_oversold signal.
        const out = build([skill], [], emptyIndicators());
        expect(out).not.toContain('RSI Guide');
    });

    it('event-gated skill is injected when a real signal fires', () => {
        // Build a downtrend that pushes RSI into oversold so detectSignals fires.
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
        const skill = makeSkill({
            name: 'RSI Guide',
            type: 'indicator_guide',
            gating: eventGated([
                'rsi_oversold',
                'macd_bearish_cross',
                'supertrend_bearish_flip',
                'cci_bearish_cross',
                'dmi_bearish_cross',
            ]),
        });
        const out = build([skill], bars, indicators);
        expect(out).toContain('RSI Guide');
    });

    it('untagged skill fails open (included even at low confidenceWeight)', () => {
        const skill = makeSkill({
            name: 'Legacy Untagged',
            type: 'pattern',
            confidenceWeight: 0.0,
        });
        const out = build([skill], [], emptyIndicators());
        expect(out).toContain('Legacy Untagged');
    });

    it('candle-gated skill loads only when that candle is detected', () => {
        // Construct a clear bullish engulfing as the last formation.
        const base = makeBars(40, 100);
        const bars: Bar[] = [
            ...base.slice(0, 38),
            { ...base[38], open: 120, high: 121, low: 110, close: 111 },
            { ...base[39], open: 110, high: 130, low: 109, close: 129 },
        ];
        const indicators = calculateIndicators(bars);
        const skill = makeSkill({
            name: 'Engulfing Guide',
            type: 'candlestick',
            gating: {
                tier: 'gated',
                signalKind: 'event',
                triggers: ['bullish_engulfing'],
            },
        });
        const out = build([skill], bars, indicators);
        const flat = build(
            [skill],
            makeBars(40, 100),
            calculateIndicators(makeBars(40, 100))
        );
        expect(out).toContain('Engulfing Guide');
        expect(flat).not.toContain('Engulfing Guide');
    });

    it('is deterministic: identical inputs → byte-identical prompt', () => {
        const skills = [
            makeSkill({ name: 'B Pattern', type: 'pattern', gating: alwaysOn }),
            makeSkill({ name: 'A Pattern', type: 'pattern', gating: alwaysOn }),
            makeSkill({
                name: 'RSI Guide',
                type: 'indicator_guide',
                gating: eventGated(['rsi_oversold']),
            }),
        ];
        const bars = makeBars(60, 150);
        const indicators = calculateIndicators(bars);
        const a = build(skills, bars, indicators);
        const b = build([...skills].reverse(), bars, indicators);
        expect(a).toBe(b);
    });
});

describe('ATR-extreme sizing note', () => {
    const sizingMatcher = /ATR|sizing|volatil/i;

    it('appends the always-on sizing note when ATR% is extreme on 1Day', () => {
        // High-volatility series: ATR/price well above the 6% daily threshold.
        const bars: Bar[] = Array.from({ length: 60 }, (_, i) => {
            const mid = 100 + (i % 2 === 0 ? 0 : 1);
            return {
                time: 1_700_000_000 + i * 86_400,
                open: mid,
                high: mid + 20,
                low: mid - 20,
                close: mid,
                volume: 1_000_000,
            };
        });
        const indicators = calculateIndicators(bars);
        const out = buildAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY,
            bars,
            indicators,
            [],
            '1Day'
        );
        expect(out).toMatch(/Volatility|position sizing/i);
        expect(sizingMatcher.test(out)).toBe(true);
    });

    it('does not append the sizing note when ATR% is low', () => {
        const bars = makeBars(60, 1000); // tiny ATR relative to ~1000 price
        const indicators = calculateIndicators(bars);
        const out = buildAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY,
            bars,
            indicators,
            [],
            '1Day'
        );
        expect(out).not.toMatch(/Extreme Volatility/i);
    });
});

describe('news / fundamental prompt builders are unaffected by gating', () => {
    // Both carry a gated tag that the CHART selector would EXCLUDE (no signal
    // fires). The news/fundamental builders filter by `category`, never by
    // `gating`, so these must still appear.
    const newsSkill = makeSkill({
        name: 'event-driven',
        type: 'strategy',
        category: 'news',
        confidenceWeight: 0.8,
        gating: eventGated(['rsi_oversold']),
    });
    const fundamentalSkill = makeSkill({
        name: 'value-investing',
        type: 'strategy',
        category: 'fundamental',
        confidenceWeight: 0.8,
        gating: eventGated(['macd_bullish_cross']),
    });

    const NEWS: EnrichedNewsItem = {
        id: 'n1',
        symbol: 'AAPL',
        source: 'Reuters',
        url: 'https://example.com/a',
        publishedAt: '2026-05-30T12:00:00Z',
        titleEn: 'Apple beats earnings',
        bodyEn: 'Apple Inc. reported a strong quarter.',
        card: {
            titleKo: '애플 호실적',
            bodyKo: '애플이 강한 실적을 기록했습니다.',
            summaryKo: '실적 호조',
            sentiment: 'bullish',
            category: 'earnings',
            priceImpact: 'high',
        },
    };
    const CALENDAR: EarningsCalendarItem = {
        symbol: 'AAPL',
        earningsDate: '2026-07-30',
        epsActual: null,
        epsEstimated: 1.42,
        revenueActual: null,
        revenueEstimated: 94_000_000_000,
        lastUpdated: '2026-05-30',
    };
    const SNAPSHOT: FundamentalSnapshot = {
        profile: {
            symbol: 'AAPL',
            companyName: 'Apple Inc.',
            sector: 'Technology',
            industry: 'Consumer Electronics',
            marketCap: 3_000_000_000_000,
            ceo: 'Tim Cook',
            website: 'https://apple.com',
            description: 'Designs and markets consumer electronics.',
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
            nextEarningsAt: '2026-07-30',
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
            priceTargetSummary: {
                month1Avg: 210,
                month3Avg: 208,
                year1Avg: 200,
            },
        },
        sectorDirection: { todayChangePct: 1.2, historical: [] },
    };

    it('news prompt includes its category skill despite the gated tag', () => {
        const out = buildNewsAnalysisPrompt(
            TEST_SYMBOL,
            TEST_COMPANY,
            [NEWS],
            [CALENDAR],
            [newsSkill, fundamentalSkill]
        );
        expect(out).toContain('event-driven');
    });

    it('fundamental prompt includes its category skill despite the gated tag', () => {
        const out = buildFundamentalAnalysisPrompt(TEST_SYMBOL, SNAPSHOT, [
            newsSkill,
            fundamentalSkill,
        ]);
        expect(out).toContain('value-investing');
    });
});
