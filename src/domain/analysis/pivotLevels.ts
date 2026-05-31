import type {
    Bar,
    CamarillaPivotLevels,
    StandardPivotLevels,
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
