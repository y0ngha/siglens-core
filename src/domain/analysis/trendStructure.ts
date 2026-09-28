import { MA_DEFAULT_PERIODS } from '@/domain/indicators/constants';
import type {
    EmaStackState,
    IndicatorResult,
    MaStackDirection,
    SwingStructureState,
} from '@/domain/types';

/** Fewest values that can describe a stack order — one point has no order. */
const MIN_STACK_VALUES = 2;

/** Number of trailing swing points compared to classify Dow structure. */
const SWING_COMPARISON_COUNT = 2;

/** @internal Kaufman efficiency ratio over the last `period` closes: |net| / Σ|step|. */
export function efficiencyRatio(
    closes: readonly number[],
    period: number
): number | null {
    if (closes.length < period + 1) return null;
    const window = closes.slice(-(period + 1));
    const net = Math.abs(window[window.length - 1] - window[0]);
    let volatility = 0;
    for (let i = 1; i < window.length; i++) {
        volatility += Math.abs(window[i] - window[i - 1]);
    }
    if (volatility === 0) return null;
    return net / volatility;
}

/** @internal EMA-stack alignment from price + two EMAs (short, long). */
export function classifyEmaStack(
    price: number,
    emaShort: number,
    emaLong: number
): EmaStackState {
    if (price > emaShort && emaShort > emaLong) return 'aligned_up';
    if (price < emaShort && emaShort < emaLong) return 'aligned_down';
    return 'mixed';
}

/**
 * @internal Stack order of `values` given shortest-period first: `'bullish'`
 * when strictly decreasing, `'bearish'` when strictly increasing, `'mixed'`
 * otherwise; `null` when fewer than two values. Shared by
 * {@link classifyMaStack} and the prompt's `MA/EMA stack` line.
 */
export function classifyStackOrder(
    values: readonly number[]
): MaStackDirection | null {
    if (values.length < MIN_STACK_VALUES) return null;
    const decreasing = values.every((v, i) => i === 0 || v < values[i - 1]);
    if (decreasing) return 'bullish';
    const increasing = values.every((v, i) => i === 0 || v > values[i - 1]);
    return increasing ? 'bearish' : 'mixed';
}

/**
 * Moving-average stack direction across all configured MA periods, read from
 * each series' **last element** (the latest bar).
 *
 * - `'bullish'` — the latest values strictly decrease as the period grows
 *   (MA5 > MA20 > MA60 > MA120 > MA200 for the default periods).
 * - `'bearish'` — they strictly increase as the period grows.
 * - `'mixed'` — any other ordering (including ties).
 * - `null` — fewer than two of `periods` have a finite latest value, so there
 *   is no stack to describe.
 *
 * A period whose series is missing, empty, or whose last element is `null` /
 * non-finite (warm-up, `NaN`) is dropped; the remaining periods are compared
 * in the order given. Earlier finite values are NOT used as a fallback — the
 * reading is strictly "as of the latest bar".
 *
 * Differs from the internal `classifyEmaStack`, which compares **price** with
 * exactly **two EMAs** (short, long) and returns `EmaStackState`
 * (`'aligned_up'` | `'aligned_down'` | `'mixed'`, never `null`). This function
 * looks at simple MAs only, excludes price, and spans every configured period.
 * It is the classifier behind the `get_bars_indicators` agent tool's
 * `derived.maStack` field.
 *
 * @param indicators Output of `calculateIndicators`; only `indicators.ma` is read.
 * @param periods MA periods to compare, shortest first. Defaults to `MA_DEFAULT_PERIODS`.
 * @returns The stack direction, or `null` when fewer than two of `periods` have
 *   a finite latest value.
 */
export function classifyMaStack(
    indicators: IndicatorResult,
    periods: readonly number[] = MA_DEFAULT_PERIODS
): MaStackDirection | null {
    const values = periods
        .map(period => indicators.ma[period]?.at(-1) ?? null)
        .filter((v): v is number => v !== null && Number.isFinite(v));
    return classifyStackOrder(values);
}

/** @internal Dow structure from the last two swing highs and lows. */
export function classifySwingStructure(
    swingHighs: readonly number[],
    swingLows: readonly number[]
): SwingStructureState {
    if (
        swingHighs.length < SWING_COMPARISON_COUNT ||
        swingLows.length < SWING_COMPARISON_COUNT
    ) {
        return 'mixed';
    }
    const lastHigh = swingHighs[swingHighs.length - 1];
    const prevHigh = swingHighs[swingHighs.length - SWING_COMPARISON_COUNT];
    const lastLow = swingLows[swingLows.length - 1];
    const prevLow = swingLows[swingLows.length - SWING_COMPARISON_COUNT];
    const hh = lastHigh > prevHigh;
    const hl = lastLow > prevLow;
    const lh = lastHigh < prevHigh;
    const ll = lastLow < prevLow;
    if (hh && hl) return 'HH_HL';
    if (lh && ll) return 'LH_LL';
    return 'mixed';
}
