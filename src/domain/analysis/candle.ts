import type { Bar, CandlePattern, MultiCandlePattern } from '@/domain/types';

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
 * @param bar - A single OHLCV bar.
 * @returns The detected single-bar pattern label.
 *
 * @see detectMultiCandlePattern
 * @see getSinglePatternTrend
 * @see getCandlePatternLabel
 */
export function detectCandlePattern(bar: Bar): CandlePattern {
    const range = calcRange(bar);
    if (range === 0) return 'flat';

    const bs = bodySize(bar);
    const bodyRatio = bs / range;
    const upper = upperShadow(bar);
    const lower = lowerShadow(bar);
    const bullish = isBullishBar(bar);

    // Doji 계열
    if (bodyRatio <= DOJI_BODY_RATIO) {
        if (lower <= range * DOJI_TAIL_RATIO) return 'gravestone_doji';
        if (upper <= range * DOJI_TAIL_RATIO) return 'dragonfly_doji';
        return 'doji';
    }

    // Marubozu (꼬리 거의 없음)
    if (bodyRatio >= MARUBOZU_BODY_RATIO)
        return bullish ? 'bullish_marubozu' : 'bearish_marubozu';

    // 긴 위꼬리 + 짧은 아래꼬리
    const hasLongUpper = upper >= bs * LONG_SHADOW_RATIO;
    const hasShortLower = lower <= bs * SHORT_SHADOW_RATIO;
    if (hasLongUpper && hasShortLower)
        return bullish ? 'inverted_hammer' : 'shooting_star';

    // 긴 아래꼬리 + 짧은 위꼬리
    const hasLongLower = lower >= bs * LONG_SHADOW_RATIO;
    const hasShortUpper = upper <= bs * SHORT_SHADOW_RATIO;
    if (hasLongLower && hasShortUpper)
        return bullish ? 'hammer' : 'hanging_man';

    // Belt Hold (긴 몸통, 한쪽 꼬리 없음) — range > 0 guaranteed by early return above
    if (bodyRatio >= LONG_DAY_BODY_RATIO) {
        if (bullish && lower <= bs * BELT_HOLD_TAIL_RATIO)
            return 'bullish_belt_hold';
        if (!bullish && upper <= bs * BELT_HOLD_TAIL_RATIO)
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

// ─── Multi Candle Pattern ─────────────────────────────────────────────────────

/**
 * @internal Multi-bar candle pattern detector.
 *
 * Detect a 2- to 5-bar {@link MultiCandlePattern} ending at the last bar.
 *
 * Examines the final 5 bars (fewer when fewer are available) and returns the
 * first matching pattern, longest formation first: 5-bar (rising / falling
 * three methods), then 4-bar (three-line strike), then 3-bar (morning star,
 * evening star, three white soldiers, three inside / outside, abandoned
 * baby, etc.), then 2-bar (engulfing, harami, piercing line, dark cloud
 * cover, tweezers, on-neck, in-neck, and above / below the stomach as the
 * last fallback). Returns `null` when no pattern matches or when fewer than
 * 2 bars are provided.
 *
 * @param bars - OHLCV bars sorted oldest-first; only the last 5 are read.
 * @returns The detected multi-bar pattern label, or `null` if none.
 *
 * @see detectCandlePattern
 * @see detectCandlePatternEntries
 * @see getMultiPatternTrend
 */
export function detectMultiCandlePattern(
    bars: Bar[]
): MultiCandlePattern | null {
    const n = bars.length;
    if (n < 2) return null;

    const last = bars[n - 1];
    const prev = bars[n - 2];

    if (n >= 5) {
        const result = detect5CandlePattern(
            bars[n - 5],
            bars[n - 4],
            bars[n - 3],
            prev,
            last
        );
        if (result !== null) return result;
    }

    if (n >= 4) {
        const result = detect4CandlePattern(
            bars[n - 4],
            bars[n - 3],
            prev,
            last
        );
        if (result !== null) return result;
    }

    if (n >= 3) {
        const prev2 = bars[n - 3];
        const result = detect3CandlePattern(prev2, prev, last);
        if (result !== null) return result;
    }

    return detect2CandlePattern(prev, last);
}
