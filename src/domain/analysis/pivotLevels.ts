import type {
    Bar,
    CamarillaPivotLevels,
    DeMarkPivotLevels,
    FibonacciPivotLevels,
    StandardPivotLevels,
    WoodiePivotLevels,
} from '@/domain/types';
import {
    CAMARILLA_FACTOR,
    CAMARILLA_R3_S3_DIVISOR,
    CAMARILLA_R4_S4_DIVISOR,
} from '@/domain/analysis/marketReferenceConstants';
import { isUsablePrice } from '@/domain/analysis/analysisUtils';

const PIVOT_DIVISOR = 3;
const PIVOT_DOUBLE = 2;

/** @internal Standard-pivot field keys, typed so indexing yields `number` (avoids Object.entries `any`). */
export const STANDARD_PIVOT_KEYS = [
    'pp',
    'r1',
    'r2',
    'r3',
    's1',
    's2',
    's3',
] as const;
/** @internal Camarilla field keys surfaced as reference levels (the four most-watched). */
export const CAMARILLA_LEVEL_KEYS = ['r4', 'r3', 's3', 's4'] as const;
/** @internal Fibonacci-pivot field keys surfaced as reference levels. */
export const FIBONACCI_PIVOT_KEYS = [
    'pp',
    'r1',
    'r2',
    'r3',
    's1',
    's2',
    's3',
] as const;
/** @internal Woodie-pivot field keys surfaced as reference levels. */
export const WOODIE_PIVOT_KEYS = ['pp', 'r1', 'r2', 's1', 's2'] as const;
/** @internal DeMark-pivot field keys surfaced as reference levels. */
export const DEMARK_PIVOT_KEYS = ['pp', 'r1', 's1'] as const;

/** @internal Fibonacci ratios applied to `pp ± ratio * range` (spec 2026-09-18 §A2). */
const FIB_PIVOT_R1_RATIO = 0.382;
const FIB_PIVOT_R2_RATIO = 0.618;
const FIB_PIVOT_R3_RATIO = 1.0;

/** @internal Woodie pivot: weights the most recent close double the high/low. */
const WOODIE_CLOSE_WEIGHT = 2;
const WOODIE_DIVISOR = 4;

/** @internal DeMark "X" divisor — X collapses to `pp * 4`, so `pp = X / 4`. */
const DEMARK_PP_DIVISOR = 4;
const DEMARK_RANGE_DIVISOR = 2;

interface PivotBase {
    pp: number;
    range: number;
}

const resolvePivotBase = (bar: Bar): PivotBase | null => {
    const { high, low, close } = bar;
    if (!isUsablePrice(high) || !isUsablePrice(low) || !isUsablePrice(close)) {
        return null;
    }
    return { pp: (high + low + close) / PIVOT_DIVISOR, range: high - low };
};

/** @internal Standard pivot set from a prior bar, or null on bad OHLC. */
export function computeStandardPivot(bar: Bar): StandardPivotLevels | null {
    const base = resolvePivotBase(bar);
    if (base === null) return null;
    const { pp, range } = base;
    const { high, low } = bar;
    const twicePp = PIVOT_DOUBLE * pp;
    return {
        pp,
        r1: twicePp - low,
        r2: pp + range,
        r3: high + PIVOT_DOUBLE * (pp - low),
        s1: twicePp - high,
        s2: pp - range,
        s3: low - PIVOT_DOUBLE * (high - pp),
    };
}

/** @internal Camarilla R3/R4/S3/S4 pivot set from a prior bar, or null on bad OHLC. */
export function computeCamarillaPivot(bar: Bar): CamarillaPivotLevels | null {
    const base = resolvePivotBase(bar);
    if (base === null) return null;
    const { pp, range } = base;
    const { close } = bar;
    const span = range * CAMARILLA_FACTOR;
    return {
        pp,
        r3: close + span / CAMARILLA_R3_S3_DIVISOR,
        r4: close + span / CAMARILLA_R4_S4_DIVISOR,
        s3: close - span / CAMARILLA_R3_S3_DIVISOR,
        s4: close - span / CAMARILLA_R4_S4_DIVISOR,
    };
}

/**
 * @internal Fibonacci pivot set (PP, R1–R3, S1–S3 = `pp ± 0.382/0.618/1.000
 * × range`) from the same prior bar the Standard/Camarilla levels use, or
 * `null` on bad OHLC (spec 2026-09-18 §A2).
 */
export function computeFibonacciPivot(bar: Bar): FibonacciPivotLevels | null {
    const base = resolvePivotBase(bar);
    if (base === null) return null;
    const { pp, range } = base;
    return {
        pp,
        r1: pp + FIB_PIVOT_R1_RATIO * range,
        r2: pp + FIB_PIVOT_R2_RATIO * range,
        r3: pp + FIB_PIVOT_R3_RATIO * range,
        s1: pp - FIB_PIVOT_R1_RATIO * range,
        s2: pp - FIB_PIVOT_R2_RATIO * range,
        s3: pp - FIB_PIVOT_R3_RATIO * range,
    };
}

/**
 * @internal Woodie pivot set: `pp = (H + L + 2C) / 4`, weighting the prior
 * close double the high/low, or `null` on bad OHLC.
 */
export function computeWoodiePivot(bar: Bar): WoodiePivotLevels | null {
    const { high, low, close } = bar;
    if (!isUsablePrice(high) || !isUsablePrice(low) || !isUsablePrice(close)) {
        return null;
    }
    const pp = (high + low + WOODIE_CLOSE_WEIGHT * close) / WOODIE_DIVISOR;
    const range = high - low;
    return {
        pp,
        r1: PIVOT_DOUBLE * pp - low,
        r2: pp + range,
        s1: PIVOT_DOUBLE * pp - high,
        s2: pp - range,
    };
}

/**
 * @internal DeMark pivot set. The "X" rule weights the prior high/low/close
 * by whether the bar closed up, down, or flat: `close < open → X = H + 2L +
 * C`; `close > open → X = 2H + L + C`; `close === open → X = H + L + 2C`.
 * `pp = X / 4`; `r1 = X/2 − L`; `s1 = X/2 − H`. `null` on bad OHLC.
 */
export function computeDeMarkPivot(bar: Bar): DeMarkPivotLevels | null {
    const { open, high, low, close } = bar;
    if (
        !isUsablePrice(open) ||
        !isUsablePrice(high) ||
        !isUsablePrice(low) ||
        !isUsablePrice(close)
    ) {
        return null;
    }
    const x =
        close < open
            ? high + PIVOT_DOUBLE * low + close
            : close > open
              ? PIVOT_DOUBLE * high + low + close
              : high + low + PIVOT_DOUBLE * close;
    return {
        pp: x / DEMARK_PP_DIVISOR,
        r1: x / DEMARK_RANGE_DIVISOR - low,
        s1: x / DEMARK_RANGE_DIVISOR - high,
    };
}
