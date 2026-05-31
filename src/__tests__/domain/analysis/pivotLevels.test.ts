import { describe, expect, it } from 'vitest';
import {
    computeStandardPivot,
    computeCamarillaPivot,
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
});
