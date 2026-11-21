/**
 * Candle half of the engine evaluation: the detection pass over a bars series, the matched
 * placebo and the G1 violation counters. Pure: bars in, events out.
 *
 * The violation counters recompute the WP-17 definitions from OHLC on the window the
 * detector sees (its own ATR(14) over the production window) and the instrument's own
 * constants; they never call the classifier they check (`detectCandlePatternEntries` and
 * friends are called only to find out WHAT an arm printed). The placebo matching and the
 * outcome scale read the causal full-history ATR instead, which keeps a date's bucket
 * independent of where its window starts.
 */
import {
    CANDLE_PATTERN_DETECTION_BARS,
    detectCandlePatternEntries,
    selectLastCandlePatternEntries,
} from '@/domain/analysis/candle-detection';
import {
    getMultiPatternTrend,
    getSinglePatternTrend,
} from '@/domain/analysis/candle-trend';
import { calculateATR } from '@/domain/indicators/atr';
import type {
    Bar,
    CandlePattern,
    CandlePatternEntry,
    MultiCandlePattern,
} from '@/domain/types';
import {
    CORE_DERIVED,
    EVAL_CONSTANTS,
    HORIZONS,
    MAX_HORIZON_BARS,
    perHorizon,
    type CandleEvent,
    type CandleRobustness,
    type CandleViolation,
    type EvalMarket,
    type PerHorizon,
    type PlaceboSummary,
    type PriorBucket,
} from './engineEvalTypes';
import {
    halfOf,
    isoDate,
    isoWeekKey,
    sampleWithoutReplacement,
    streamForKey,
} from './engineEvalStats';
import { mean } from './stats';

const {
    candlePriorTrendBars,
    candlePriorTrendMinAtr,
    candleSetupBodyAtr,
    dojiBodyRatio,
    minPriorBars,
    placeboCount,
    placeboRadius,
    minPlacebo,
    seed,
    robustPriorMoveAtr,
    robustBodyFloorAtr,
} = EVAL_CONSTANTS;

// ─── Definitions, recomputed from OHLC ────────────────────────────────────────

/**
 * Prior move before bar `s` (a pattern's FIRST bar): the close change over the
 * `candlePriorTrendBars` bars that end on the bar before it, in ATR of that bar. `none`
 * when the lookback does not fit or the ATR is not a positive number.
 */
export function priorBucket(
    bars: readonly Bar[],
    atr: readonly (number | null)[],
    s: number,
    minAtr: number = candlePriorTrendMinAtr
): PriorBucket {
    const end = s - 1;
    const start = end - candlePriorTrendBars;
    const scale = atr[end];
    if (start < 0 || scale === null || scale === undefined) return 'none';
    if (!Number.isFinite(scale) || scale <= 0) return 'none';
    const move = (bars[end].close - bars[start].close) / scale;
    if (move <= -minAtr) return 'decline';
    if (move >= minAtr) return 'advance';
    return 'none';
}

/** Bars each multi pattern spans. Exhaustive: a new union member fails the type check. */
export const MULTI_BAR_COUNT = {
    bullish_engulfing: 2,
    bullish_harami: 2,
    bullish_harami_cross: 2,
    piercing_line: 2,
    bullish_counterattack_line: 2,
    morning_star: 3,
    morning_doji_star: 3,
    bullish_abandoned_baby: 3,
    three_white_soldiers: 3,
    three_inside_up: 3,
    three_outside_up: 3,
    bullish_triple_star: 3,
    ladder_bottom: 3,
    tweezers_bottom: 2,
    downside_gap_two_rabbits: 3,
    above_the_stomach: 2,
    bearish_engulfing: 2,
    bearish_harami: 2,
    bearish_harami_cross: 2,
    dark_cloud_cover: 2,
    bearish_counterattack_line: 2,
    evening_star: 3,
    evening_doji_star: 3,
    bearish_abandoned_baby: 3,
    three_black_crows: 3,
    three_inside_down: 3,
    three_outside_down: 3,
    bearish_triple_star: 3,
    advance_block: 3,
    tweezers_top: 2,
    upside_gap_two_crows: 3,
    below_the_stomach: 2,
    upside_gap_tasuki: 3,
    downside_gap_tasuki: 3,
    on_neck: 2,
    in_neck: 2,
    rising_three_methods: 5,
    falling_three_methods: 5,
    bullish_three_line_strike: 4,
    bearish_three_line_strike: 4,
} as const satisfies Record<MultiCandlePattern, 2 | 3 | 4 | 5>;

type ContextRule = 'decline' | 'advance';

/** Single shapes whose definition needs a prior move (WP-17 §2.2). */
const SINGLE_RULE: Partial<Record<CandlePattern, ContextRule>> = {
    hammer: 'decline',
    inverted_hammer: 'decline',
    dragonfly_doji: 'decline',
    bullish_belt_hold: 'decline',
    hanging_man: 'advance',
    shooting_star: 'advance',
    gravestone_doji: 'advance',
    bearish_belt_hold: 'advance',
};

/** The prior move every multi pattern needs (WP-17 §2.3). Exhaustive. */
export const MULTI_RULE = {
    bullish_engulfing: 'decline',
    bullish_harami: 'decline',
    bullish_harami_cross: 'decline',
    piercing_line: 'decline',
    bullish_counterattack_line: 'decline',
    morning_star: 'decline',
    morning_doji_star: 'decline',
    bullish_abandoned_baby: 'decline',
    three_white_soldiers: 'decline',
    three_inside_up: 'decline',
    three_outside_up: 'decline',
    bullish_triple_star: 'decline',
    ladder_bottom: 'decline',
    tweezers_bottom: 'decline',
    downside_gap_two_rabbits: 'decline',
    above_the_stomach: 'decline',
    falling_three_methods: 'decline',
    downside_gap_tasuki: 'decline',
    on_neck: 'decline',
    in_neck: 'decline',
    bearish_three_line_strike: 'decline',
    bearish_engulfing: 'advance',
    bearish_harami: 'advance',
    bearish_harami_cross: 'advance',
    dark_cloud_cover: 'advance',
    bearish_counterattack_line: 'advance',
    evening_star: 'advance',
    evening_doji_star: 'advance',
    bearish_abandoned_baby: 'advance',
    three_black_crows: 'advance',
    three_inside_down: 'advance',
    three_outside_down: 'advance',
    bearish_triple_star: 'advance',
    advance_block: 'advance',
    tweezers_top: 'advance',
    upside_gap_two_crows: 'advance',
    below_the_stomach: 'advance',
    rising_three_methods: 'advance',
    upside_gap_tasuki: 'advance',
    bullish_three_line_strike: 'advance',
} as const satisfies Record<MultiCandlePattern, ContextRule>;

/** Two- and three-bar reversals whose first bar needs a body floor (WP-17 §2.3). */
const SETUP_BODY_PATTERNS: ReadonlySet<MultiCandlePattern> = new Set([
    'bullish_engulfing',
    'bearish_engulfing',
    'bullish_harami',
    'bearish_harami',
    'bullish_harami_cross',
    'bearish_harami_cross',
    'piercing_line',
    'dark_cloud_cover',
    'bullish_counterattack_line',
    'bearish_counterattack_line',
    'on_neck',
    'in_neck',
    'above_the_stomach',
    'below_the_stomach',
    'tweezers_bottom',
    'tweezers_top',
    'three_inside_up',
    'three_inside_down',
    'three_outside_up',
    'three_outside_down',
    'morning_star',
    'evening_star',
    'morning_doji_star',
    'evening_doji_star',
    'bullish_abandoned_baby',
    'bearish_abandoned_baby',
]);

/** The setup patterns that also need a non-doji first bar. */
const NON_DOJI_SETUP_PATTERNS: ReadonlySet<MultiCandlePattern> = new Set([
    'bullish_engulfing',
    'bearish_engulfing',
    'three_outside_up',
    'three_outside_down',
    'tweezers_bottom',
    'tweezers_top',
]);

const bodyOf = (bar: Bar): number => Math.abs(bar.close - bar.open);

function isDojiSized(bar: Bar): boolean {
    const range = bar.high - bar.low;
    return range === 0 || bodyOf(bar) / range <= dojiBodyRatio;
}

/** A detected pattern; the union keeps the pattern name tied to its kind. */
export type DetectedCandle =
    | { patternType: 'single'; pattern: CandlePattern }
    | { patternType: 'multi'; pattern: MultiCandlePattern };

/** The two thresholds the robustness variants move. */
export interface CandleParams {
    minAtr: number;
    bodyFloor: number;
}

export const DEFAULT_CANDLE_PARAMS: CandleParams = {
    minAtr: candlePriorTrendMinAtr,
    bodyFloor: candleSetupBodyAtr,
};

/**
 * The G1 candle violations of one detected pattern ending at `t`, recomputed from OHLC.
 * `context`: the prior move its definition needs is absent (`none` included). `setupBody`:
 * the first bar is below the body floor (an unreadable ATR counts as below). `dojiSetup`: a
 * doji-sized first bar where the definition forbids one. `tweezersClose`: no confirming close.
 */
export function candleViolations(
    bars: readonly Bar[],
    atr: readonly (number | null)[],
    detected: DetectedCandle,
    t: number,
    params: CandleParams = DEFAULT_CANDLE_PARAMS
): CandleViolation[] {
    const multi = detected.patternType === 'multi' ? detected.pattern : null;
    const barCount = multi === null ? 1 : MULTI_BAR_COUNT[multi];
    const s = t - barCount + 1;
    const rule =
        detected.patternType === 'multi'
            ? MULTI_RULE[detected.pattern]
            : SINGLE_RULE[detected.pattern];
    const context =
        rule !== undefined && priorBucket(bars, atr, s, params.minAtr) !== rule;
    const scale = s >= 1 ? atr[s - 1] : null;
    const bodyOk =
        scale !== null &&
        scale !== undefined &&
        scale > 0 &&
        bodyOf(bars[s]) >= params.bodyFloor * scale;
    const tweezersBottom = multi === 'tweezers_bottom';
    const tweezersTop = multi === 'tweezers_top';
    const closeOk = tweezersBottom
        ? bars[t].close > bars[t - 1].close
        : bars[t].close < bars[t - 1].close;
    const checks: readonly [boolean, CandleViolation][] = [
        [context, 'context'],
        [
            multi !== null && SETUP_BODY_PATTERNS.has(multi) && !bodyOk,
            'setupBody',
        ],
        [
            multi !== null &&
                NON_DOJI_SETUP_PATTERNS.has(multi) &&
                isDojiSized(bars[s]),
            'dojiSetup',
        ],
        [(tweezersTop || tweezersBottom) && !closeOk, 'tweezersClose'],
    ];
    return checks.filter(([violated]) => violated).map(([, code]) => code);
}

// ─── Entries ending at a bar ──────────────────────────────────────────────────

function directionOf(entry: CandlePatternEntry): 1 | -1 | 0 {
    const trend =
        entry.patternType === 'single'
            ? getSinglePatternTrend(entry.singlePattern)
            : getMultiPatternTrend(entry.multiPattern);
    if (trend === 'bullish') return 1;
    return trend === 'bearish' ? -1 : 0;
}

function detectedOf(entry: CandlePatternEntry): DetectedCandle {
    return entry.patternType === 'single'
        ? { patternType: 'single', pattern: entry.singlePattern }
        : { patternType: 'multi', pattern: entry.multiPattern };
}

/** The production window ending at `t`, as `runAnalysis` slices it. */
export function windowEndingAt(bars: readonly Bar[], t: number): Bar[] {
    return bars.slice(Math.max(0, t - CORE_DERIVED.windowBars + 1), t + 1);
}

/** The entries an arm detects on `window` whose last bar is the window's last bar. */
function entriesOfWindow(window: readonly Bar[]): CandlePatternEntry[] {
    const lastIndex =
        Math.min(CANDLE_PATTERN_DETECTION_BARS, window.length) - 1;
    return detectCandlePatternEntries([...window]).filter(
        entry => entry.barIndex === lastIndex
    );
}

/**
 * The entries an arm detects on the production window ending at `t` whose last bar is `t`.
 * Called with the bars only, so every arm is judged through the signature it ships.
 */
export function entriesEndingAt(
    bars: readonly Bar[],
    t: number
): CandlePatternEntry[] {
    return entriesOfWindow(windowEndingAt(bars, t));
}

// ─── Placebo ──────────────────────────────────────────────────────────────────

/** Bars at which an event or a placebo date can be measured. */
export function measurable(
    atr: readonly (number | null)[],
    barCount: number,
    t: number,
    forwardBars: number
): boolean {
    const scale = atr[t];
    return (
        t >= minPriorBars &&
        t + forwardBars <= barCount - 1 &&
        scale !== null &&
        scale !== undefined &&
        scale > 0
    );
}

/**
 * Measurable dates within the radius of `t` that pass `accept`, leaving out every date
 * within `forwardBars` of the event: a placebo whose forward window overlaps the event's
 * would share its outcome (arm-independent; an approved deviation from the brief).
 */
export function eligiblePlaceboDates(
    atr: readonly (number | null)[],
    barCount: number,
    t: number,
    forwardBars: number,
    accept: (candidate: number) => boolean
): number[] {
    const first = Math.max(minPriorBars, t - placeboRadius);
    const last = Math.min(barCount - 1 - forwardBars, t + placeboRadius);
    return Array.from(
        { length: Math.max(0, last - first + 1) },
        (_, i) => first + i
    )
        .filter(
            candidate =>
                Math.abs(candidate - t) > forwardBars &&
                measurable(atr, barCount, candidate, forwardBars)
        )
        .filter(accept);
}

/** Direction-signed outcomes at `t`: ATR units and percent. */
export function outcomesAt(
    bars: readonly Bar[],
    atr: readonly (number | null)[],
    t: number,
    direction: 1 | -1
): { y: PerHorizon<number>; pct: PerHorizon<number> } {
    const scale = atr[t] ?? Number.NaN;
    const move = (h: number): number => bars[t + h].close - bars[t].close;
    return {
        y: perHorizon(key => (direction * move(HORIZONS[key])) / scale),
        pct: perHorizon(
            key => (direction * move(HORIZONS[key]) * 100) / bars[t].close
        ),
    };
}

/** The placebo summary over `dates`, or `null` for none. */
export function placeboSummary(
    bars: readonly Bar[],
    atr: readonly (number | null)[],
    direction: 1 | -1,
    dates: readonly number[]
): PlaceboSummary | null {
    if (dates.length === 0) return null;
    const outcomes = dates.map(date => outcomesAt(bars, atr, date, direction));
    const avg = (read: (o: (typeof outcomes)[number]) => number): number =>
        mean(outcomes.map(read)) ?? Number.NaN;
    return {
        n: dates.length,
        y: perHorizon(key => avg(o => o.y[key])),
        pct: perHorizon(key => avg(o => o.pct[key])),
        hit: perHorizon(key => avg(o => (o.y[key] > 0 ? 1 : 0))),
    };
}

// ─── The detection pass ───────────────────────────────────────────────────────

interface Draw {
    bars: readonly Bar[];
    atr: readonly (number | null)[];
    t: number;
    /** Bars between the pattern's first and last bar. */
    offset: number;
    key: string;
}

/** The matched placebo dates of an event under a prior-move threshold (20 at most). */
function matchedDates(draw: Draw, minAtr: number, stream: string): number[] {
    const { bars, atr, t, offset } = draw;
    const bucket = priorBucket(bars, atr, t - offset, minAtr);
    return sampleWithoutReplacement(
        eligiblePlaceboDates(
            atr,
            bars.length,
            t,
            MAX_HORIZON_BARS,
            candidate =>
                priorBucket(bars, atr, candidate - offset, minAtr) === bucket
        ),
        placeboCount,
        streamForKey(seed, `${draw.key}|${stream}`)
    );
}

function robustnessOf(
    window: readonly Bar[],
    windowAtr: readonly (number | null)[],
    detected: DetectedCandle,
    direction: 1 | -1 | 0,
    draw: Draw
): CandleRobustness {
    const [a05, a15] = robustPriorMoveAtr;
    const [f01, f05] = robustBodyFloorAtr;
    const end = window.length - 1;
    const violated = (params: CandleParams, code: CandleViolation): boolean =>
        candleViolations(window, windowAtr, detected, end, params).includes(
            code
        );
    const variantPlacebo = (minAtr: number, stream: string) => {
        if (direction === 0) return null;
        const dates = matchedDates(draw, minAtr, stream);
        return dates.length < minPlacebo
            ? null
            : placeboSummary(draw.bars, draw.atr, direction, dates);
    };
    return {
        contextViolation: {
            a05: violated({ ...DEFAULT_CANDLE_PARAMS, minAtr: a05 }, 'context'),
            a15: violated({ ...DEFAULT_CANDLE_PARAMS, minAtr: a15 }, 'context'),
        },
        setupBodyViolation: {
            f01: violated(
                { ...DEFAULT_CANDLE_PARAMS, bodyFloor: f01 },
                'setupBody'
            ),
            f05: violated(
                { ...DEFAULT_CANDLE_PARAMS, bodyFloor: f05 },
                'setupBody'
            ),
        },
        matched: {
            a05: variantPlacebo(a05, 'matched|a05'),
            a15: variantPlacebo(a15, 'matched|a15'),
        },
    };
}

function eventOf(
    symbol: string,
    market: EvalMarket,
    bars: readonly Bar[],
    atr: readonly (number | null)[],
    t: number,
    entry: CandlePatternEntry,
    window: readonly Bar[],
    windowAtr: readonly (number | null)[]
): CandleEvent {
    const detected = detectedOf(entry);
    const barCount =
        detected.patternType === 'multi'
            ? MULTI_BAR_COUNT[detected.pattern]
            : 1;
    const offset = barCount - 1;
    const direction = directionOf(entry);
    const time = bars[t].time;
    const draw: Draw = {
        bars,
        atr,
        t,
        offset,
        key: `${symbol}|${t}|${detected.pattern}`,
    };
    const base = {
        kind: 'candle' as const,
        symbol,
        market,
        index: t,
        date: isoDate(time),
        week: isoWeekKey(time),
        half: halfOf(time),
        pattern: detected.pattern,
        patternType: detected.patternType,
        barCount,
        direction,
        bucket: priorBucket(bars, atr, t - offset),
        violations: candleViolations(
            window,
            windowAtr,
            detected,
            window.length - 1
        ),
        robust: robustnessOf(window, windowAtr, detected, direction, draw),
    };
    const untested = (status: 'neutral' | 'dropped'): CandleEvent => ({
        ...base,
        status,
        y: null,
        pct: null,
        matched: null,
        unmatched: null,
    });
    if (direction === 0) return untested('neutral');
    const dates = matchedDates(draw, candlePriorTrendMinAtr, 'matched');
    if (dates.length < minPlacebo) return untested('dropped');
    const unmatched = sampleWithoutReplacement(
        eligiblePlaceboDates(atr, bars.length, t, MAX_HORIZON_BARS, () => true),
        placeboCount,
        streamForKey(seed, `${draw.key}|unmatched`)
    );
    return {
        ...base,
        status: 'tested',
        ...outcomesAt(bars, atr, t, direction),
        matched: placeboSummary(bars, atr, direction, dates),
        unmatched: placeboSummary(bars, atr, direction, unmatched),
    };
}

/**
 * Every candle event of one symbol: each measurable bar `t`, the entries an arm detects on
 * the production window ending there. Directional entries are tested against a matched
 * placebo (same symbol, the same prior-move bucket read at the same offset before the
 * placebo date) and against an unmatched one; an entry with fewer than `minPlacebo`
 * matched dates is `dropped`; neutral entries are kept for counts only.
 */
export function candleEventsForSymbol(
    symbol: string,
    market: EvalMarket,
    bars: readonly Bar[]
): CandleEvent[] {
    const atr = calculateATR([...bars]);
    const lastT = bars.length - 1 - MAX_HORIZON_BARS;
    const days = Array.from(
        { length: Math.max(0, lastT - minPriorBars + 1) },
        (_, i) => minPriorBars + i
    ).filter(t => measurable(atr, bars.length, t, MAX_HORIZON_BARS));
    return days.flatMap(t => {
        const window = windowEndingAt(bars, t);
        const entries = entriesOfWindow(window);
        if (entries.length === 0) return [];
        const windowAtr = calculateATR(window);
        return entries.map(entry =>
            eventOf(symbol, market, bars, atr, t, entry, window, windowAtr)
        );
    });
}

// ─── Secondary: what a case's prompt would carry ──────────────────────────────

export interface CaseCandleLines {
    lines: number;
    bullish: boolean;
    bearish: boolean;
}

/**
 * The candle lines an analysis made at bar `t` prints: the last multi and the last single
 * entry of the production window (`selectLastCandlePatternEntries`), with their direction.
 */
export function caseCandleLines(
    bars: readonly Bar[],
    t: number
): CaseCandleLines {
    const selected = selectLastCandlePatternEntries(
        detectCandlePatternEntries(windowEndingAt(bars, t))
    );
    const directions = selected.map(directionOf);
    return {
        lines: selected.length,
        bullish: directions.includes(1),
        bearish: directions.includes(-1),
    };
}
