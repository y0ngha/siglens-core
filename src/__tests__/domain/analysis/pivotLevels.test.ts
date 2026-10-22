import { describe, expect, it } from 'vitest';
import {
    computeStandardPivot,
    computeCamarillaPivot,
    computeFibonacciPivot,
    computeWoodiePivot,
    computeDeMarkPivot,
} from '@/domain/analysis/pivotLevels';
import type { Bar } from '@/domain/types';

const bar: Bar = {
    time: 1,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1000,
};

describe('pivotLevels', () => {
    it('computes the standard central pivot', () => {
        expect(computeStandardPivot(bar)?.pp).toBeCloseTo(
            (110 + 90 + 105) / 3,
            6
        );
    });

    it('computes Camarilla R3/R4/S3/S4 around close', () => {
        const cam = computeCamarillaPivot(bar);
        const range = 110 - 90;
        expect(cam?.r3).toBeCloseTo(105 + (range * 1.1) / 4, 6);
        expect(cam?.r4).toBeCloseTo(105 + (range * 1.1) / 2, 6);
        expect(cam?.s3).toBeCloseTo(105 - (range * 1.1) / 4, 6);
        expect(cam?.s4).toBeCloseTo(105 - (range * 1.1) / 2, 6);
    });

    it('returns null on non-finite OHLC', () => {
        expect(computeCamarillaPivot({ ...bar, high: NaN })).toBeNull();
    });

    it('computeStandardPivot returns null on non-positive OHLC', () => {
        expect(computeStandardPivot({ ...bar, low: 0 })).toBeNull();
    });

    it('computeStandardPivot derives r1/s1 around the pivot', () => {
        const sp = computeStandardPivot(bar);
        const pp = (110 + 90 + 105) / 3;
        expect(sp?.r1).toBeCloseTo(2 * pp - 90, 6);
        expect(sp?.s1).toBeCloseTo(2 * pp - 110, 6);
    });

    it('computeCamarillaPivot returns null on non-positive close', () => {
        expect(computeCamarillaPivot({ ...bar, close: -1 })).toBeNull();
    });
});

describe('computeFibonacciPivot', () => {
    const pp = (110 + 90 + 105) / 3;
    const range = 110 - 90;

    it('computes pp ± 0.382/0.618/1.000 × range', () => {
        const fib = computeFibonacciPivot(bar);
        expect(fib?.pp).toBeCloseTo(pp, 6);
        expect(fib?.r1).toBeCloseTo(pp + 0.382 * range, 6);
        expect(fib?.r2).toBeCloseTo(pp + 0.618 * range, 6);
        expect(fib?.r3).toBeCloseTo(pp + 1.0 * range, 6);
        expect(fib?.s1).toBeCloseTo(pp - 0.382 * range, 6);
        expect(fib?.s2).toBeCloseTo(pp - 0.618 * range, 6);
        expect(fib?.s3).toBeCloseTo(pp - 1.0 * range, 6);
    });

    it('returns null on non-finite OHLC', () => {
        expect(computeFibonacciPivot({ ...bar, high: NaN })).toBeNull();
    });

    it('returns null on non-positive OHLC', () => {
        expect(computeFibonacciPivot({ ...bar, low: 0 })).toBeNull();
    });
});

describe('computeWoodiePivot', () => {
    it('weights the close double: pp = (H + L + 2C) / 4', () => {
        const woodie = computeWoodiePivot(bar);
        const pp = (110 + 90 + 2 * 105) / 4;
        expect(woodie?.pp).toBeCloseTo(pp, 6);
        expect(woodie?.r1).toBeCloseTo(2 * pp - 90, 6);
        expect(woodie?.r2).toBeCloseTo(pp + (110 - 90), 6);
        expect(woodie?.s1).toBeCloseTo(2 * pp - 110, 6);
        expect(woodie?.s2).toBeCloseTo(pp - (110 - 90), 6);
    });

    it('returns null on non-finite OHLC', () => {
        expect(computeWoodiePivot({ ...bar, close: NaN })).toBeNull();
    });

    it('returns null on non-positive OHLC', () => {
        expect(computeWoodiePivot({ ...bar, high: 0 })).toBeNull();
    });
});

describe('computeDeMarkPivot', () => {
    it('close < open -> X = H + 2L + C', () => {
        const b: Bar = {
            time: 1,
            open: 108,
            high: 110,
            low: 90,
            close: 105,
            volume: 1,
        };
        const demark = computeDeMarkPivot(b);
        const x = 110 + 2 * 90 + 105;
        expect(demark?.pp).toBeCloseTo(x / 4, 6);
        expect(demark?.r1).toBeCloseTo(x / 2 - 90, 6);
        expect(demark?.s1).toBeCloseTo(x / 2 - 110, 6);
    });

    it('close > open -> X = 2H + L + C', () => {
        const b: Bar = {
            time: 1,
            open: 95,
            high: 110,
            low: 90,
            close: 105,
            volume: 1,
        };
        const demark = computeDeMarkPivot(b);
        const x = 2 * 110 + 90 + 105;
        expect(demark?.pp).toBeCloseTo(x / 4, 6);
    });

    it('close === open -> X = H + L + 2C', () => {
        const b: Bar = {
            time: 1,
            open: 105,
            high: 110,
            low: 90,
            close: 105,
            volume: 1,
        };
        const demark = computeDeMarkPivot(b);
        const x = 110 + 90 + 2 * 105;
        expect(demark?.pp).toBeCloseTo(x / 4, 6);
    });

    it('returns null on non-finite OHLC', () => {
        expect(computeDeMarkPivot({ ...bar, open: Number.NaN })).toBeNull();
    });

    it('returns null on non-positive OHLC', () => {
        expect(computeDeMarkPivot({ ...bar, close: -1 })).toBeNull();
    });
});
