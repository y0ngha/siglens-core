import { describe, expect, it } from 'vitest';
import { baselineMean, pctChange } from '@/domain/outcomes/windowSeries';

describe('pctChange', () => {
    it('is the percent change from one price to another', () => {
        expect(pctChange(100, 110)).toBeCloseTo(10, 12);
        expect(pctChange(100, 90)).toBeCloseTo(-10, 12);
    });

    it.each([
        ['a zero start', 0, 100],
        ['a negative start', -1, 100],
        ['a non-finite start', Number.NaN, 100],
        ['a non-finite end', 100, Number.POSITIVE_INFINITY],
    ])('is null for %s, never a number', (_name, from, to) => {
        expect(pctChange(from, to)).toBeNull();
    });
});

describe('baselineMean', () => {
    const rising = Array.from({ length: 30 }, (_, i) => 100 + i);

    it('averages the h-bar returns of every start inside the series', () => {
        const { pct, n } = baselineMean(rising, 1);
        const expected =
            rising
                .slice(0, -1)
                .reduce(
                    (sum, from, i) => sum + (rising[i + 1] / from - 1) * 100,
                    0
                ) / 29;
        expect(n).toBe(29);
        expect(pct).toBeCloseTo(expected, 12);
    });

    it('skips a start that has no usable price instead of averaging it as zero', () => {
        const withGap = rising.map((value, i) =>
            i === 3 ? Number.NaN : value
        );
        expect(baselineMean(withGap, 1).n).toBe(27);
    });

    it('reports the count but no mean below the minimum', () => {
        expect(baselineMean(rising, 15)).toEqual({ pct: null, n: 15 });
    });
});
