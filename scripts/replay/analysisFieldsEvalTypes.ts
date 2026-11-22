/**
 * Shapes and pre-registered constants of the analysis-fields evaluation
 * (`analysisFieldsEval.ts`, WP-15): the measurement of the three fields a consumer reads as
 * conclusions (`trend`, the plan state with its stop and `entryRecommendation`, and the
 * skills a tier's prompt carries).
 *
 * Every definition below is the instrument's own copy of the design's rule (EMA(20) move in
 * ATR(14), zone tolerances, the stop band). The instrument recomputes them from OHLC and
 * from the fields a stored result carries; it never calls the function it checks and never
 * reads the field under test as its own reference. The one thing it reads from core is what
 * the engine fixes by construction and the evaluation must follow: the calendar lookback
 * of the bars a daily analysis is given.
 */
import { TIMEFRAME_LOOKBACK_DAYS } from '@/domain/constants/market';
import type { ReplayRegime } from './types';

/** Slack for comparing a ratio of counts with a threshold written as a decimal. */
export const EPS = 1e-12;

export type TrendLabel = 'bullish' | 'bearish' | 'neutral';
export const TREND_LABELS: readonly TrendLabel[] = [
    'bullish',
    'bearish',
    'neutral',
];

export const EVAL_MODES = [
    'trend',
    'skills',
    'plan',
    'gating',
    'output',
] as const;
export type EvalMode = (typeof EVAL_MODES)[number];

export type EvalMarket = 'us' | 'kr';

/** The rules and thresholds the instrument measures with. Recorded in `run.json`. */
export const FIELDS_EVAL_CONSTANTS = {
    /** WP-15 §2.1: EMA period, look-back and slope threshold (ATR units) of the trend rule. */
    trendEmaPeriod: 20,
    trendSlopeLookback: 20,
    trendSlopeMinAtr: 1,
    atrPeriod: 14,
    /** Decimal places the slope is rounded to (half away from zero) before it is classified. */
    slopeDecimals: 2,
    /** The audit's 3-line rule (R1) and the existing percent rule (R3), kept as references. */
    auditRuleSmaFast: 5,
    auditRuleSmaSlow: 20,
    auditRuleSlopeBars: 5,
    percentRuleSlopeMin: 0.03,
    /** Sizing of the all-days statistics: first bar index measured. */
    allDaysFromBar: 300,
    /** Prior move the "prior-N-day sign" measure looks at. */
    priorSignBars: 10,
    /** A stored label needs this many bars before it can be compared with the rule. */
    minBarsForStoredLabel: 60,
    /** Stored labels further apart than this many bars are not a "day to day" pair. */
    maxPairGapBars: 5,
    /** WP-15 §3.2-3.3: stop band, spacing and the zone tolerances. */
    planMinAtrSpacing: 1,
    stopMaxAtrFromMid: 5,
    /** Fallback stop distance below the zone low (ATR) when no printed support lies in the band. */
    stopFallbackAtr: 1.5,
    zoneTolerance: 0.01,
    /** Sessions forward the volatility-grade check looks at. */
    forwardSessions: 10,
    /** Within this many sessions of entry a stop hit counts as "early" (P5, reported). */
    earlyStopSessions: 2,
    /** S6: a free level within this many ATR of a member level counts as shared. */
    levelOverlapAtr: 0.25,
    /** Pre-registered gate thresholds (WP-15 §7.3). */
    gates: {
        trendMaxDayChange: 0.15,
        trendMaxHardFlip: 0.005,
        trendMaxOpposite: 0.01,
        trendMinLabelShare: 0.15,
        trendMaxLabelShare: 0.6,
        trendMaxOppositeWords: 0.02,
        planMaxPositionShare: 0.7,
        planNoSetupMin: 0.02,
        planNoSetupMax: 0.35,
        planMaxAtrBasisShare: 0.4,
        planMinTargetRoomGainPp: 0.15,
        planMinNoRegressionPp: -0.05,
        planSideEffectMinPp: 0.01,
        planMaxOutputTokenGrowth: 0.1,
        skillsFreeGatedPerGroup: 3,
        skillsMaxUncachedInputGrowth: 1.5,
        skillsMaxLatencyGrowth: 0.2,
        /** WP-16 §9.3 (pre-registered). */
        cardTrendMinN: 30,
        cardTrendMaxOpposite: 0.05,
        outputMaxRatioMember: 0.75,
        outputMaxRatioFree: 0.8,
        outputCiHighMember: 0.8,
        outputCiHighFree: 0.85,
        latencyMaxRatio: 0.8,
        msPerTokenBand: 0.1,
        rateMarginPp: 0.01,
        /** Share of the cases a gate needs paired measurements for; below it the gate is undecided. */
        minPairedShare: 0.9,
        levelMargin: -0.03,
        positionMargin: -0.05,
        summaryRatioMin: 0.85,
        summaryRatioMax: 1.25,
        strategyEntryRatioMin: 0.85,
        candidateCoverageMargin: 0.02,
        detectedCandidateMargin: -0.03,
        panelItemsMargin: 0.1,
    },
    /** WP-16 card rules the instrument recomputes from the printed lines (WP-16 §3.3, §4). */
    cards: {
        adxTrending: 25,
        adxWeak: 20,
        stochasticOverbought: 80,
        stochasticOversold: 20,
        stochRsiOverbought: 0.8,
        stochRsiOversold: 0.2,
        williamsROverbought: -20,
        williamsROversold: -80,
        buySellBullish: 0.65,
        buySellBearish: 0.35,
        /** Bars of stage history a cycle reading looks back over. */
        cycleLookbackBars: 120,
        maCyclePeriods: [5, 20, 60],
        macdCycleEmaPeriods: [9, 21, 60],
    },
    /** Bootstrap of the paired comparisons of the `output` mode. */
    bootstrap: { replicates: 2000, seed: 20261122 },
    /** 95% interval of a paired mean (normal approximation). */
    ciZ: 1.96,
    /** Cases per position in the P7 reading sample. */
    p7SamplePerPosition: 10,
} as const;

/** What the engine itself fixes and the instrument follows; recorded beside the constants. */
export const FIELDS_EVAL_CORE_DERIVED = {
    /**
     * Calendar days of daily bars an analysis reads (`TIMEFRAME_LOOKBACK_DAYS['1Day']`). The
     * stored provider of a replay cuts by this date and ignores the bar-count limit, so a
     * replay prompt sees 485 to 506 bars, not the 500 of `TIMEFRAME_BARS_LIMIT`.
     */
    lookbackDays: TIMEFRAME_LOOKBACK_DAYS['1Day'],
} as const;

// ─── Inputs ───────────────────────────────────────────────────────────────────

/** One stored trend label to compare the rule against, located on a symbol's bars. */
export interface StoredTrendRow {
    symbol: string;
    market: EvalMarket;
    /** `YYYY-MM-DD` of the bar the label describes. */
    date: string;
    stored: TrendLabel;
    regime: ReplayRegime | null;
    /** The result's own `trendBasis.slopeAtr`, when it carries one. */
    trendBasisSlope: number | null;
    /** The result's summary text, when it carries one (for the summary-words check). */
    summary: string | null;
}

export interface SymbolBars {
    symbol: string;
    market: EvalMarket;
    bars: readonly {
        time: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
    }[];
}

// ─── Trend summary ────────────────────────────────────────────────────────────

export interface Share {
    count: number;
    n: number;
    /** `count / n`, `null` for `n = 0`. */
    share: number | null;
}

export interface SeriesStats {
    /** Days with a measurable label. */
    n: number;
    distribution: Record<TrendLabel, Share>;
    /** Consecutive measurable days whose label differs. */
    dayToDayChange: Share;
    /** Consecutive days that went bullish to bearish or back. */
    hardFlip: Share;
    /** Directional days whose label matches the sign of the prior-N-day move. */
    priorSignMatch: Share;
}

export interface AgreementStats {
    n: number;
    agree: Share;
    opposite: Share;
    /** `${stored}>${rule}` to count. */
    confusion: Record<string, number>;
}

export interface RuleVsStored extends AgreementStats {
    byRegime: Record<string, AgreementStats>;
    byMarket: Record<string, AgreementStats>;
    /** Day-to-day change of the rule on the same consecutive stored-label dates. */
    ruleDayToDayChange: Share;
    /** Bullish-to-bearish flips of the rule on the same pairs. */
    ruleHardFlip: Share;
}

export interface StoredLabelStats {
    n: number;
    /** Rows left out because the rule could not be measured there. */
    unmeasured: number;
    distribution: Record<TrendLabel, Share>;
    /** Consecutive stored labels (per symbol, by date) that differ. */
    dayToDayChange: Share;
    hardFlip: Share;
    rules: Record<RuleName, RuleVsStored>;
}

export const RULE_NAMES = ['R4', 'R1', 'R3'] as const;
export type RuleName = (typeof RULE_NAMES)[number];

/** `R4` is the shipped rule; `R1` and `R3` are the references the design compared it with. */
export const RULE_DESCRIPTIONS: Record<RuleName, string> = {
    R4: 'EMA20 move over 20 bars in ATR(14) >= 1.00 (2 dp) and close beyond EMA20',
    R1: 'audit rule: close, SMA5 and SMA20 on one side and SMA20 moving over 5 bars',
    R3: 'EMA20 move over 20 bars >= 3% and close beyond EMA20 (classifyTrend)',
};

export interface TrendPlumbing {
    /** Every first-repeat result of the run, failed or without a trend included. */
    total: number;
    /** Results carrying a trend that could be located on bars and measured. */
    n: number;
    equal: number;
    mismatches: readonly {
        caseId: string;
        stored: TrendLabel;
        rule: TrendLabel;
    }[];
    /** Results with a `trendBasis` and how many of them match the recomputed slope. */
    basis: { present: number; slopeMatches: number };
}

export interface OppositeWords {
    /** Results with a summary and a stored label. */
    n: number;
    /** First paragraph uses only the opposite direction's words. */
    opposite: Share;
}

export interface TrendSummary {
    allDays: {
        fromBar: number;
        rules: Record<RuleName, SeriesStats>;
    };
    stored: StoredLabelStats | null;
    plumbing: TrendPlumbing | null;
    oppositeWords: OppositeWords | null;
}

// ─── Gates ────────────────────────────────────────────────────────────────────

/** One pre-registered gate: `pass` is `null` when the input cannot decide it. */
export interface GateResult {
    id: string;
    description: string;
    pass: boolean | null;
    value: number | string | null;
    threshold: string;
}

export interface Interval {
    n: number;
    mean: number | null;
    low: number | null;
    high: number | null;
}
