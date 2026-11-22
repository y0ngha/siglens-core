import { describe, expect, it } from 'vitest';
import {
    mulberry32,
    quantile,
    resampleMultiplicities,
    resampledMean,
} from '@/domain/outcomes/weekClusterBootstrap';

const draw = (rand: () => number, n: number): number[] =>
    Array.from({ length: n }, () => rand());

describe('mulberry32', () => {
    it('is deterministic for a seed and stays in [0, 1)', () => {
        const a = draw(mulberry32(20261121), 50);
        expect(draw(mulberry32(20261121), 50)).toEqual(a);
        expect(a.every(v => v >= 0 && v < 1)).toBe(true);
    });

    it('reproduces the first outputs of the pre-move implementation (scripts/replay/engineEvalStats.ts at origin/main)', () => {
        expect(draw(mulberry32(1), 5)).toEqual([
            0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
            0.9810509674716741, 0.9683778982143849,
        ]);
        expect(draw(mulberry32(20261121), 5)).toEqual([
            0.6913962827529758, 0.3520768517628312, 0.5383691973984241,
            0.9816739014349878, 0.5909753520973027,
        ]);
    });

    it('differs between seeds', () => {
        expect(draw(mulberry32(1), 5)).not.toEqual(draw(mulberry32(2), 5));
    });
});

describe('resampling', () => {
    it('draws weekCount weeks per replicate, deterministically', () => {
        const m = resampleMultiplicities(6, 40, mulberry32(9));
        expect(m).toHaveLength(40);
        expect(m.every(row => row.length === 6)).toBe(true);
        expect(m.every(row => row.reduce((a, b) => a + b, 0) === 6)).toBe(true);
        expect(resampleMultiplicities(6, 40, mulberry32(9))).toEqual(m);
    });

    it('takes the mean of the resampled weeks, null when none carries an observation', () => {
        const aggregate = { sums: [4, 0], counts: [2, 0] };
        expect(resampledMean(aggregate, [3, 5])).toBe(2);
        expect(resampledMean(aggregate, [0, 5])).toBeNull();
    });
});

describe('quantile', () => {
    it('interpolates between ranks', () => {
        expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
        expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(
            9.1,
            12
        );
    });

    it('does not depend on the input order', () => {
        expect(quantile([9, 1, 5], 0.5)).toBe(5);
    });

    it('returns the endpoints at 0 and 1', () => {
        expect(quantile([3, 1, 2], 0)).toBe(1);
        expect(quantile([3, 1, 2], 1)).toBe(3);
    });

    it('is null for no values', () => {
        expect(quantile([], 0.5)).toBeNull();
    });
});
