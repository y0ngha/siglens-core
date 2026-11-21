import {
    CANDLE_MIN_SETUP_BODY_ATR,
    candlePriorMove,
} from '@/domain/analysis/candle-context';
import type {
    Bar,
    CandlePattern,
    CandlePriorTrend,
    MultiCandlePattern,
} from '@/domain/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const DOJI_BODY_RATIO = 0.1;
const DOJI_TAIL_RATIO = 0.1;
const LONG_SHADOW_RATIO = 2;
const SHORT_SHADOW_RATIO = 1;
const MARUBOZU_BODY_RATIO = 0.9;
const SPINNING_TOP_BODY_RATIO = 0.4;
const LONG_DAY_BODY_RATIO = 0.6;
const BELT_HOLD_TAIL_RATIO = 0.1;
const NEAR_PRICE_TOLERANCE = 0.002;
const MIN_PRICE_DENOMINATOR = 1e-9;
const IN_NECK_RATIO = 0.05;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const bodyHigh = (bar: Bar): number => Math.max(bar.open, bar.close);
const bodyLow = (bar: Bar): number => Math.min(bar.open, bar.close);
const bodySize = (bar: Bar): number => Math.abs(bar.close - bar.open);
const calcRange = (bar: Bar): number => bar.high - bar.low;
const upperShadow = (bar: Bar): number => bar.high - bodyHigh(bar);
const lowerShadow = (bar: Bar): number => bodyLow(bar) - bar.low;
const isBullishBar = (bar: Bar): boolean => bar.close >= bar.open;
const isBearishBar = (bar: Bar): boolean => bar.close < bar.open;
const isDojiBar = (bar: Bar): boolean => {
    const range = calcRange(bar);
    return range === 0 || bodySize(bar) / range <= DOJI_BODY_RATIO;
};
const isLongBody = (bar: Bar): boolean => {
    const range = calcRange(bar);
    return range > 0 && bodySize(bar) / range >= LONG_DAY_BODY_RATIO;
};
const isInsideBody = (outer: Bar, inner: Bar): boolean =>
    bodyLow(inner) >= bodyLow(outer) && bodyHigh(inner) <= bodyHigh(outer);
const midpoint = (bar: Bar): number => (bar.open + bar.close) / 2;
const hasGapUp = (prev: Bar, curr: Bar): boolean => curr.low > prev.high;
const hasGapDown = (prev: Bar, curr: Bar): boolean => curr.high < prev.low;
const isNearPrice = (a: number, b: number): boolean =>
    Math.abs(a - b) /
        Math.max(Math.abs(a), Math.abs(b), MIN_PRICE_DENOMINATOR) <=
    NEAR_PRICE_TOLERANCE;

// ─── Single Candle Pattern ────────────────────────────────────────────────────

/**
 * @internal Single-bar candle pattern detector.
 *
 * Classify a single OHLCV bar into a {@link CandlePattern}.
 *
 * Pattern selection follows the standard taxonomy: doji / dragonfly /
 * gravestone, marubozu, hammer / inverted hammer, shooting star /
 * hanging man, belt-hold, spinning top, and the catch-all bullish / bearish
 * / flat. Detection thresholds (body-to-range ratios, shadow ratios, etc.)
 * are tuned per the constants at the top of the source file.
 *
 * Four shapes are named by the move that precedes them, never by body colour
 * (`prior`, see `candlePriorMove`): a long lower shadow is a hammer after a
 * decline and a hanging man after an advance; a long upper shadow is an
 * inverted hammer after a decline and a shooting star after an advance. A
 * dragonfly doji needs a decline and a gravestone doji an advance (otherwise
 * a plain doji); a bullish belt-hold needs a decline and a bearish one an
 * advance. Without the move a long-shadow or belt-hold shape falls through to
 * the remaining checks (belt-hold, spinning top, colour). Marubozu, doji,
 * spinning top, flat and the colour fallbacks are shape-only.
 *
 * @param bar - A single OHLCV bar.
 * @param prior - The move before the bar (`'none'` when unknown).
 * @returns The detected single-bar pattern label.
 *
 * @see detectMultiCandlePattern
 * @see getSinglePatternTrend
 * @see getCandlePatternLabel
 */
export function detectCandlePattern(
    bar: Bar,
    prior: CandlePriorTrend
): CandlePattern {
    const range = calcRange(bar);
    if (range === 0) return 'flat';

    const bs = bodySize(bar);
    const bodyRatio = bs / range;
    const upper = upperShadow(bar);
    const lower = lowerShadow(bar);
    const bullish = isBullishBar(bar);

    // Doji 계열
    if (bodyRatio <= DOJI_BODY_RATIO) {
        if (lower <= range * DOJI_TAIL_RATIO && prior === 'advance')
            return 'gravestone_doji';
        if (upper <= range * DOJI_TAIL_RATIO && prior === 'decline')
            return 'dragonfly_doji';
        return 'doji';
    }

    // Marubozu (꼬리 거의 없음)
    if (bodyRatio >= MARUBOZU_BODY_RATIO)
        return bullish ? 'bullish_marubozu' : 'bearish_marubozu';

    // 긴 위꼬리 + 짧은 아래꼬리 — 이름은 직전 움직임이 정한다
    const hasLongUpper = upper >= bs * LONG_SHADOW_RATIO;
    const hasShortLower = lower <= bs * SHORT_SHADOW_RATIO;
    if (hasLongUpper && hasShortLower) {
        if (prior === 'decline') return 'inverted_hammer';
        if (prior === 'advance') return 'shooting_star';
    }

    // 긴 아래꼬리 + 짧은 위꼬리
    const hasLongLower = lower >= bs * LONG_SHADOW_RATIO;
    const hasShortUpper = upper <= bs * SHORT_SHADOW_RATIO;
    if (hasLongLower && hasShortUpper) {
        if (prior === 'decline') return 'hammer';
        if (prior === 'advance') return 'hanging_man';
    }

    // Belt Hold (긴 몸통, 한쪽 꼬리 없음) — range > 0 guaranteed by early return above
    if (bodyRatio >= LONG_DAY_BODY_RATIO) {
        if (
            bullish &&
            prior === 'decline' &&
            lower <= bs * BELT_HOLD_TAIL_RATIO
        )
            return 'bullish_belt_hold';
        if (
            !bullish &&
            prior === 'advance' &&
            upper <= bs * BELT_HOLD_TAIL_RATIO
        )
            return 'bearish_belt_hold';
    }

    // Spinning Top (작은 몸통 + 양쪽 꼬리)
    if (bodyRatio <= SPINNING_TOP_BODY_RATIO && upper > 0 && lower > 0)
        return 'spinning_top';

    return bullish ? 'bullish' : 'bearish';
}

// ─── Multi Candle Pattern Helpers ─────────────────────────────────────────────

function detect2CandlePattern(prev: Bar, curr: Bar): MultiCandlePattern | null {
    const prevBull = isBullishBar(prev);
    const prevBear = isBearishBar(prev);
    const currBull = isBullishBar(curr);
    const currBear = isBearishBar(curr);
    const prevLong = isLongBody(prev);

    // Engulfing
    if (
        prevBear &&
        currBull &&
        curr.open <= prev.close &&
        curr.close >= prev.open
    )
        return 'bullish_engulfing';
    if (
        prevBull &&
        currBear &&
        curr.open >= prev.close &&
        curr.close <= prev.open
    )
        return 'bearish_engulfing';

    // Harami
    if (prevBear && prevLong && isInsideBody(prev, curr)) {
        return isDojiBar(curr) ? 'bullish_harami_cross' : 'bullish_harami';
    }
    if (prevBull && prevLong && isInsideBody(prev, curr)) {
        return isDojiBar(curr) ? 'bearish_harami_cross' : 'bearish_harami';
    }

    // Piercing Line / Dark Cloud Cover
    if (
        prevBear &&
        prevLong &&
        currBull &&
        curr.open < prev.close &&
        curr.close > midpoint(prev) &&
        curr.close < prev.open
    )
        return 'piercing_line';

    if (
        prevBull &&
        prevLong &&
        currBear &&
        curr.open > prev.close &&
        curr.close < midpoint(prev) &&
        curr.close > prev.open
    )
        return 'dark_cloud_cover';

    // Counterattack Line
    if (
        prevBear &&
        prevLong &&
        currBull &&
        isLongBody(curr) &&
        isNearPrice(curr.close, prev.close)
    )
        return 'bullish_counterattack_line';
    if (
        prevBull &&
        prevLong &&
        currBear &&
        isLongBody(curr) &&
        isNearPrice(curr.close, prev.close)
    )
        return 'bearish_counterattack_line';

    // Tweezers
    if (isNearPrice(prev.low, curr.low) && prevBear) return 'tweezers_bottom';
    if (isNearPrice(prev.high, curr.high) && prevBull) return 'tweezers_top';

    // On Neck / In Neck
    if (prevBear && prevLong && currBull && curr.open < prev.low) {
        if (isNearPrice(curr.close, prev.low)) return 'on_neck';
        if (
            curr.close > prev.low &&
            curr.close < prev.close * (1 + IN_NECK_RATIO)
        )
            return 'in_neck';
    }

    // Above / Below the Stomach — checked last, so every pair an older 2-bar
    // label already claims keeps that label; the stomach is a fallback. The
    // prior bar must be a long body, like every other two-bar reversal here:
    // without it the rule matched 12.4% of daily bars (NVDA/TSLA/SPY,
    // 2024-01..2026-09; 2.0% with it) and swallowed the single-bar labels of
    // ordinary pairs. `isLongBody` also rules out a zero-body prior bar, which
    // `isBullishBar` (close >= open) would otherwise count as bullish. Only
    // the open is compared with the prior midpoint: a bullish (bearish) curr
    // that opens at/above (at/below) it closes there too.
    if (prevBear && prevLong && currBull && curr.open >= midpoint(prev))
        return 'above_the_stomach';
    if (prevBull && prevLong && currBear && curr.open <= midpoint(prev))
        return 'below_the_stomach';

    return null;
}

function detect3CandlePattern(
    a: Bar,
    b: Bar,
    c: Bar
): MultiCandlePattern | null {
    const aBull = isBullishBar(a);
    const aBear = isBearishBar(a);
    const bBull = isBullishBar(b);
    const bBear = isBearishBar(b);
    const cBull = isBullishBar(c);
    const cBear = isBearishBar(c);
    const aLong = isLongBody(a);
    const bLong = isLongBody(b);
    const cLong = isLongBody(c);

    // Three White Soldiers
    if (
        aBull &&
        bBull &&
        cBull &&
        aLong &&
        bLong &&
        cLong &&
        b.open > a.open &&
        b.open < a.close &&
        c.open > b.open &&
        c.open < b.close
    )
        return 'three_white_soldiers';

    // Three Black Crows
    if (
        aBear &&
        bBear &&
        cBear &&
        aLong &&
        bLong &&
        cLong &&
        b.open < a.open &&
        b.open > a.close &&
        c.open < b.open &&
        c.open > b.close
    )
        return 'three_black_crows';

    // Morning Star / Morning Doji Star
    if (
        aBear &&
        aLong &&
        cBull &&
        bodyHigh(b) < bodyLow(a) &&
        c.close > midpoint(a)
    ) {
        return isDojiBar(b) ? 'morning_doji_star' : 'morning_star';
    }

    // Evening Star / Evening Doji Star
    if (
        aBull &&
        aLong &&
        cBear &&
        bodyLow(b) > bodyHigh(a) &&
        c.close < midpoint(a)
    ) {
        return isDojiBar(b) ? 'evening_doji_star' : 'evening_star';
    }

    // Bullish Abandoned Baby
    if (
        aBear &&
        aLong &&
        isDojiBar(b) &&
        cBull &&
        hasGapDown(a, b) &&
        hasGapUp(b, c)
    )
        return 'bullish_abandoned_baby';

    // Bearish Abandoned Baby
    if (
        aBull &&
        aLong &&
        isDojiBar(b) &&
        cBear &&
        hasGapUp(a, b) &&
        hasGapDown(b, c)
    )
        return 'bearish_abandoned_baby';

    // Three Inside Up
    if (
        aBear &&
        aLong &&
        bBull &&
        isInsideBody(a, b) &&
        cBull &&
        c.close > a.open
    )
        return 'three_inside_up';

    // Three Inside Down
    if (
        aBull &&
        aLong &&
        bBear &&
        isInsideBody(a, b) &&
        cBear &&
        c.close < a.open
    )
        return 'three_inside_down';

    // Three Outside Up
    if (
        aBear &&
        bBull &&
        b.close >= a.open &&
        b.open <= a.close &&
        cBull &&
        c.close > b.close
    )
        return 'three_outside_up';

    // Three Outside Down
    if (
        aBull &&
        bBear &&
        b.close <= a.open &&
        b.open >= a.close &&
        cBear &&
        c.close < b.close
    )
        return 'three_outside_down';

    // Bullish Triple Star
    if (
        isDojiBar(a) &&
        isDojiBar(b) &&
        isDojiBar(c) &&
        hasGapDown(a, b) &&
        cBull
    )
        return 'bullish_triple_star';

    // Bearish Triple Star
    if (isDojiBar(a) && isDojiBar(b) && isDojiBar(c) && hasGapUp(a, b) && cBear)
        return 'bearish_triple_star';

    // Upside Gap Two Crows
    if (
        aBull &&
        aLong &&
        bBear &&
        cBear &&
        bodyLow(b) > bodyHigh(a) &&
        c.open <= b.open &&
        c.close <= b.close &&
        c.open > bodyHigh(a)
    )
        return 'upside_gap_two_crows';

    // Downside Gap Two Rabbits
    if (
        aBear &&
        aLong &&
        bBull &&
        cBull &&
        bodyHigh(b) < bodyLow(a) &&
        c.open >= b.open &&
        c.close >= b.close &&
        c.open < bodyLow(a)
    )
        return 'downside_gap_two_rabbits';

    // Advance Block
    if (
        aBull &&
        bBull &&
        cBull &&
        aLong &&
        bodySize(b) < bodySize(a) &&
        bodySize(c) < bodySize(b) &&
        upperShadow(b) > upperShadow(a) &&
        upperShadow(c) > upperShadow(b)
    )
        return 'advance_block';

    // Upside Gap Tasuki
    if (
        aBull &&
        bBull &&
        cBear &&
        b.low > a.high &&
        c.open < b.close &&
        c.close > a.high
    )
        return 'upside_gap_tasuki';

    // Downside Gap Tasuki
    if (
        aBear &&
        bBear &&
        cBull &&
        b.high < a.low &&
        c.open > b.close &&
        c.close < a.low
    )
        return 'downside_gap_tasuki';

    // Ladder Bottom
    if (
        aBear &&
        bBear &&
        cBull &&
        bLong &&
        b.open < a.open &&
        b.open > a.close &&
        c.open > b.open &&
        c.close > a.open
    )
        return 'ladder_bottom';

    return null;
}

/**
 * Three-line strike: three same-colour bars with consecutively extending
 * closes, then a fourth bar that opens beyond the third close and closes
 * beyond the first open, wiping out the run. The fourth bar's colour is
 * implied by those two bounds, so it is not checked separately.
 */
function detect4CandlePattern(
    b1: Bar,
    b2: Bar,
    b3: Bar,
    b4: Bar
): MultiCandlePattern | null {
    if (
        isBullishBar(b1) &&
        isBullishBar(b2) &&
        isBullishBar(b3) &&
        b2.close > b1.close &&
        b3.close > b2.close &&
        b4.open >= b3.close &&
        b4.close < b1.open
    )
        return 'bullish_three_line_strike';

    if (
        isBearishBar(b1) &&
        isBearishBar(b2) &&
        isBearishBar(b3) &&
        b2.close < b1.close &&
        b3.close < b2.close &&
        b4.open <= b3.close &&
        b4.close > b1.open
    )
        return 'bearish_three_line_strike';

    return null;
}

/**
 * Rising / falling three methods: a long first bar, three non-long bars held
 * inside its high–low range, then a long bar in the first bar's direction
 * that closes beyond the first close.
 */
function detect5CandlePattern(
    b1: Bar,
    b2: Bar,
    b3: Bar,
    b4: Bar,
    b5: Bar
): MultiCandlePattern | null {
    if (!isLongBody(b1) || !isLongBody(b5)) return null;
    const heldInside = [b2, b3, b4].every(
        bar => !isLongBody(bar) && bar.high <= b1.high && bar.low >= b1.low
    );
    if (!heldInside) return null;

    if (isBullishBar(b1) && isBullishBar(b5) && b5.close > b1.close)
        return 'rising_three_methods';
    if (isBearishBar(b1) && isBearishBar(b5) && b5.close < b1.close)
        return 'falling_three_methods';

    return null;
}

// ─── Multi Candle Pattern Context ─────────────────────────────────────────────

/**
 * What a multi-bar pattern needs besides its geometry.
 *
 * - `prior`: the move before the pattern's first bar (`candlePriorMove`).
 * - `setupBody`: `'floor'` = the first bar's body is at least
 *   `CANDLE_MIN_SETUP_BODY_ATR` ATR (read at the bar before it);
 *   `'floorNonDoji'` adds that the first bar is not a doji (engulfing, three
 *   outside and tweezers have no long-body test of their own); `'none'` = the
 *   pattern carries its own move (soldiers, crows, gaps, three methods).
 * - `confirmClose`: the last bar closes strictly `above` / `below` the close
 *   of the bar before it (tweezers: a matching extreme alone is not a reversal).
 */
interface CandleContextRule {
    prior: Exclude<CandlePriorTrend, 'none'>;
    setupBody: 'none' | 'floor' | 'floorNonDoji';
    confirmClose?: 'above' | 'below';
}

const AFTER_DECLINE = {
    prior: 'decline',
    setupBody: 'none',
} as const satisfies CandleContextRule;
const AFTER_ADVANCE = {
    prior: 'advance',
    setupBody: 'none',
} as const satisfies CandleContextRule;
const DECLINE_REVERSAL = {
    prior: 'decline',
    setupBody: 'floor',
} as const satisfies CandleContextRule;
const ADVANCE_REVERSAL = {
    prior: 'advance',
    setupBody: 'floor',
} as const satisfies CandleContextRule;
const DECLINE_REVERSAL_NON_DOJI = {
    prior: 'decline',
    setupBody: 'floorNonDoji',
} as const satisfies CandleContextRule;
const ADVANCE_REVERSAL_NON_DOJI = {
    prior: 'advance',
    setupBody: 'floorNonDoji',
} as const satisfies CandleContextRule;

/**
 * One context rule per multi-bar pattern: the single table the detector reads
 * (an exhaustive `satisfies Record`, so a new pattern cannot ship without a
 * rule). Continuations are gated on the move they continue; the three-line
 * strike pair follows its traditional name (a bearish strike is three falling
 * bars in a decline), independent of the measured direction `getMultiPatternTrend`
 * reports.
 */
const MULTI_CANDLE_CONTEXT_RULES = {
    // 상승 반전: 하락 뒤
    bullish_engulfing: DECLINE_REVERSAL_NON_DOJI,
    bullish_harami: DECLINE_REVERSAL,
    bullish_harami_cross: DECLINE_REVERSAL,
    piercing_line: DECLINE_REVERSAL,
    bullish_counterattack_line: DECLINE_REVERSAL,
    morning_star: DECLINE_REVERSAL,
    morning_doji_star: DECLINE_REVERSAL,
    bullish_abandoned_baby: DECLINE_REVERSAL,
    three_white_soldiers: AFTER_DECLINE,
    three_inside_up: DECLINE_REVERSAL,
    three_outside_up: DECLINE_REVERSAL_NON_DOJI,
    bullish_triple_star: AFTER_DECLINE,
    ladder_bottom: AFTER_DECLINE,
    tweezers_bottom: {
        prior: 'decline',
        setupBody: 'floorNonDoji',
        confirmClose: 'above',
    },
    downside_gap_two_rabbits: AFTER_DECLINE,
    above_the_stomach: DECLINE_REVERSAL,
    // 하락 반전: 상승 뒤
    bearish_engulfing: ADVANCE_REVERSAL_NON_DOJI,
    bearish_harami: ADVANCE_REVERSAL,
    bearish_harami_cross: ADVANCE_REVERSAL,
    dark_cloud_cover: ADVANCE_REVERSAL,
    bearish_counterattack_line: ADVANCE_REVERSAL,
    evening_star: ADVANCE_REVERSAL,
    evening_doji_star: ADVANCE_REVERSAL,
    bearish_abandoned_baby: ADVANCE_REVERSAL,
    three_black_crows: AFTER_ADVANCE,
    three_inside_down: ADVANCE_REVERSAL,
    three_outside_down: ADVANCE_REVERSAL_NON_DOJI,
    bearish_triple_star: AFTER_ADVANCE,
    advance_block: AFTER_ADVANCE,
    tweezers_top: {
        prior: 'advance',
        setupBody: 'floorNonDoji',
        confirmClose: 'below',
    },
    upside_gap_two_crows: AFTER_ADVANCE,
    below_the_stomach: ADVANCE_REVERSAL,
    // 지속: 이어가는 방향의 움직임 뒤
    upside_gap_tasuki: AFTER_ADVANCE,
    downside_gap_tasuki: AFTER_DECLINE,
    on_neck: DECLINE_REVERSAL,
    in_neck: DECLINE_REVERSAL,
    rising_three_methods: AFTER_ADVANCE,
    falling_three_methods: AFTER_DECLINE,
    // 3선 타격: 전통 명칭 기준 (상승 3선 뒤의 타격은 상승 뒤)
    bullish_three_line_strike: AFTER_ADVANCE,
    bearish_three_line_strike: AFTER_DECLINE,
} as const satisfies Record<MultiCandlePattern, CandleContextRule>;

const hasSetupBody = (
    first: Bar,
    atrBeforeFirst: number,
    setupBody: CandleContextRule['setupBody']
): boolean => {
    if (setupBody === 'none') return true;
    if (bodySize(first) < CANDLE_MIN_SETUP_BODY_ATR * atrBeforeFirst)
        return false;
    return setupBody === 'floor' || !isDojiBar(first);
};

/**
 * Whether a geometric multi-bar match also satisfies its context rule.
 * `bars` ends at the pattern's last bar; `length` is the pattern's bar count.
 */
function satisfiesContextRule(
    pattern: MultiCandlePattern,
    bars: readonly Bar[],
    atr: readonly (number | null)[],
    length: number
): boolean {
    const rule: CandleContextRule = MULTI_CANDLE_CONTEXT_RULES[pattern];
    const first = bars.length - length;
    const prior = candlePriorMove(bars, first, atr);
    if (prior.trend !== rule.prior) return false;

    // A measured prior move implies a finite positive ATR at `first - 1`.
    const atrBeforeFirst = atr[first - 1] ?? 0;
    if (!hasSetupBody(bars[first], atrBeforeFirst, rule.setupBody))
        return false;

    const last = bars[bars.length - 1].close;
    const before = bars[bars.length - 2].close;
    if (rule.confirmClose === 'above') return last > before;
    if (rule.confirmClose === 'below') return last < before;
    return true;
}

// ─── Multi Candle Pattern ─────────────────────────────────────────────────────

/** Geometric match of the last `length` bars (no context rule applied). */
function detectGeometry(
    bars: readonly Bar[],
    length: number
): MultiCandlePattern | null {
    const n = bars.length;
    switch (length) {
        case 5:
            return detect5CandlePattern(
                bars[n - 5],
                bars[n - 4],
                bars[n - 3],
                bars[n - 2],
                bars[n - 1]
            );
        case 4:
            return detect4CandlePattern(
                bars[n - 4],
                bars[n - 3],
                bars[n - 2],
                bars[n - 1]
            );
        case 3:
            return detect3CandlePattern(bars[n - 3], bars[n - 2], bars[n - 1]);
        default:
            return detect2CandlePattern(bars[n - 2], bars[n - 1]);
    }
}

/** Pattern lengths in precedence order, longest formation first. */
const PATTERN_LENGTHS_LONGEST_FIRST = [5, 4, 3, 2] as const;

/**
 * @internal Multi-bar candle pattern detector.
 *
 * Detect a 2- to 5-bar {@link MultiCandlePattern} ending at the last bar.
 *
 * For each length, longest first (5-bar rising / falling three methods, then
 * 4-bar three-line strike, then 3-bar morning star, evening star, three white
 * soldiers, three inside / outside, abandoned baby, etc., then 2-bar
 * engulfing, harami, piercing line, dark cloud cover, tweezers, on-neck,
 * in-neck, and above / below the stomach as the last fallback) the geometric
 * detector returns its first match. The match is kept only when its context
 * rule holds: the move before the pattern's first bar (10 bars, at least 1
 * ATR, see `candlePriorMove`), a first-bar body of at least 0.25 ATR on the
 * two- and three-bar reversals (and a non-doji first bar for engulfing, three
 * outside and tweezers), and a confirming close for tweezers. When a match
 * fails its rule **that length yields nothing** and the next shorter length is
 * tried; there is no fallback to a lower-precedence label of the same length.
 * Returns `null` when nothing passes or when fewer than 2 bars are provided.
 *
 * @param bars - OHLCV bars sorted oldest-first, ending at the pattern's last
 *   bar. The pattern's bars and the 11 bars before them are read
 *   (the prior move), so fewer than 15 bars before the pattern's first
 *   bar leaves every pattern unmeasured and therefore undetected.
 * @param atr - ATR series aligned with `bars`.
 * @returns The detected multi-bar pattern label, or `null` if none.
 *
 * @see detectCandlePattern
 * @see detectCandlePatternEntries
 * @see getMultiPatternTrend
 */
export function detectMultiCandlePattern(
    bars: readonly Bar[],
    atr: readonly (number | null)[]
): MultiCandlePattern | null {
    return PATTERN_LENGTHS_LONGEST_FIRST.reduce<MultiCandlePattern | null>(
        (found, length) => {
            if (found !== null || bars.length < length) return found;
            const match = detectGeometry(bars, length);
            return match !== null &&
                satisfiesContextRule(match, bars, atr, length)
                ? match
                : null;
        },
        null
    );
}
