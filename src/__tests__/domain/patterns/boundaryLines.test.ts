import { describe, expect, it } from 'vitest';
import {
    classifyLineDrift,
    fitBoundaryLine,
    lineValueAt,
    trendlineHeight,
} from '@/domain/patterns/boundaryLines';
import {
    BOUNDARY_CONTAINMENT_ATR,
    FLAT_DRIFT_ATR,
    RECTANGLE_FLAT_DRIFT_PRICE_PCT,
    SLOPED_DRIFT_ATR,
} from '@/domain/patterns/constants';
import { makeHLBars } from '@/__tests__/domain/patterns/helpers';
import type { PatternLine } from '@/domain/types';

const line = (a: [number, number], b: [number, number]): PatternLine => ({
    start: { index: a[0], price: a[1] },
    end: { index: b[0], price: b[1] },
    touches: [],
});

describe('lineValueAt', () => {
    it('extends the line through start and end beyond both', () => {
        const l = line([2, 10], [6, 12]);
        expect(lineValueAt(l, 4)).toBe(11);
        expect(lineValueAt(l, 0)).toBe(9);
        expect(lineValueAt(l, 10)).toBe(14);
    });

    it('is flat at the start price when start and end share a bar', () => {
        expect(lineValueAt(line([3, 7], [3, 9]), 8)).toBe(7);
    });
});

describe('fitBoundaryLine', () => {
    // Highs 10 at bars 0, 4, 8 with lower bars between; one bar (6) at 10.2.
    const bars = makeHLBars([
        [10, 9],
        [9.5, 9],
        [9, 8],
        [9.5, 8.5],
        [10, 9],
        [9.5, 8.5],
        [10.2, 9],
        [9.6, 9],
        [10, 9],
    ]);
    const highs = [0, 4, 8].map(index => ({ index, price: 10 }));

    it('draws through the touches, first to last, when every bar stays within ε', () => {
        const l = fitBoundaryLine(highs, bars, 'upper', 0, 8, 1);
        expect(l).not.toBeNull();
        expect(l!.start).toEqual({ index: 0, price: 10 });
        expect(l!.end).toEqual({ index: 8, price: 10 });
        expect(l!.touches.map(t => t.index)).toEqual([0, 4, 8]);
    });

    it('rejects every line a bar pokes through by more than ε', () => {
        const poked = bars.map((b, i) =>
            i === 6 ? { ...b, high: 10 + BOUNDARY_CONTAINMENT_ATR + 0.01 } : b
        );
        expect(fitBoundaryLine(highs, poked, 'upper', 0, 8, 1)).toBeNull();
    });

    it('accepts a poke of exactly ε', () => {
        const poked = bars.map((b, i) =>
            i === 6 ? { ...b, high: 10 + BOUNDARY_CONTAINMENT_ATR } : b
        );
        expect(fitBoundaryLine(highs, poked, 'upper', 0, 8, 1)).not.toBeNull();
    });

    it('a lower boundary keeps every low at or above line − ε', () => {
        const lows = makeHLBars([
            [12, 10],
            [12, 11],
            [12, 9.6],
            [12, 11],
            [12, 10],
        ]);
        const points = [0, 4].map(index => ({ index, price: 10 }));
        expect(fitBoundaryLine(points, lows, 'lower', 0, 4, 1)).toBeNull();
        expect(
            fitBoundaryLine(points, lows, 'lower', 0, 4, 2)?.touches
        ).toHaveLength(2);
    });

    it('prefers more touches, then the line closest to all points', () => {
        // Points 0:10, 4:10, 8:10 and 2:9 — the flat line touches three; a
        // line through 0 and 2 (falling) would touch two.
        const pts = [
            { index: 0, price: 10 },
            { index: 2, price: 9 },
            { index: 4, price: 10 },
            { index: 8, price: 10 },
        ];
        const flatBars = makeHLBars(
            Array.from({ length: 9 }, (): [number, number] => [9, 8])
        );
        const l = fitBoundaryLine(pts, flatBars, 'upper', 0, 8, 0.5);
        expect(l!.touches.map(t => t.index)).toEqual([0, 4, 8]);
    });

    it('breaks a touch tie by the smaller total distance', () => {
        const pts = [
            { index: 0, price: 10 },
            { index: 4, price: 11 },
            { index: 8, price: 10.5 },
        ];
        const lowBars = makeHLBars(
            Array.from({ length: 9 }, (): [number, number] => [9, 8])
        );
        // Every line touches its own two points. Off-line distance: 0–4
        // misses bar 8 by 1.5, 4–8 misses bar 0 by 1.5, 0–8 misses bar 4 by
        // only 0.75 — so 0–8 wins.
        const l = fitBoundaryLine(pts, lowBars, 'upper', 0, 8, 0.1);
        expect([l!.start.index, l!.end.index]).toEqual([0, 8]);
    });

    it('skips a pair of points on the same bar', () => {
        const pts = [
            { index: 1, price: 10 },
            { index: 1, price: 11 },
        ];
        expect(
            fitBoundaryLine(
                pts,
                makeHLBars([
                    [9, 8],
                    [9, 8],
                ]),
                'upper',
                0,
                1,
                1
            )
        ).toBeNull();
    });
});

describe('classifyLineDrift', () => {
    const atr = 1;
    const price = 1000; // 1% of price (10) never binds: the ATR bound does.

    it('flat up to and including FLAT_DRIFT_ATR·ATR', () => {
        expect(classifyLineDrift(FLAT_DRIFT_ATR, atr, price)).toBe('flat');
        expect(classifyLineDrift(-FLAT_DRIFT_ATR, atr, price)).toBe('flat');
        expect(classifyLineDrift(FLAT_DRIFT_ATR + 0.01, atr, price)).toBe(
            'ambiguous'
        );
    });

    it('rising/falling from exactly SLOPED_DRIFT_ATR·ATR', () => {
        expect(classifyLineDrift(SLOPED_DRIFT_ATR, atr, price)).toBe('rising');
        expect(classifyLineDrift(-SLOPED_DRIFT_ATR, atr, price)).toBe(
            'falling'
        );
        expect(classifyLineDrift(SLOPED_DRIFT_ATR - 0.01, atr, price)).toBe(
            'ambiguous'
        );
    });

    it('the price share binds when it is the smaller bound (1% of 50 = 0.5)', () => {
        expect(classifyLineDrift(0.5, atr, 50)).toBe('flat');
        expect(classifyLineDrift(0.6, atr, 50)).toBe('ambiguous');
    });

    it('the rectangle passes its looser price share', () => {
        expect(
            classifyLineDrift(0.6, atr, 50, RECTANGLE_FLAT_DRIFT_PRICE_PCT)
        ).toBe('flat');
    });
});

describe('trendlineHeight', () => {
    const upper = line([2, 20], [10, 24]);
    const lower = line([4, 10], [12, 6]);

    it('is the width at the first touch for converging or parallel pairs', () => {
        // x = 2 (upper's first touch): upper 20, lower extended back to 11.
        expect(trendlineHeight('rectangle', upper, lower)).toBe(9);
    });

    it('is the width at the last touch for a broadening formation', () => {
        // x = 12: upper 25, lower 6.
        expect(trendlineHeight('broadening_formation', upper, lower)).toBe(19);
    });
});
