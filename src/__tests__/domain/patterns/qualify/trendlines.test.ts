import { describe, expect, it } from 'vitest';
import type { PivotPoint } from '@/domain/types';
import type { QualifyContext } from '@/domain/patterns/qualify/context';
import { qualifyTrendlines } from '@/domain/patterns/qualify/trendlines';
import { makeHLBars } from '@/__tests__/domain/patterns/helpers';

/**
 * Window growth and the parallel channel construction in isolation. The
 * pivots are given directly and every other bar sits well inside the lines,
 * so each case controls exactly which lines contain the bars — the scenario
 * suite's calm series cannot place a non-swing bar between two lows.
 */
const BAR_COUNT = 72;

const piv = (
    index: number,
    price: number,
    kind: 'high' | 'low'
): PivotPoint => ({
    index,
    price,
    kind,
});

/** Bars at the given pivot prices; every other bar spans `[low(i), high(i)]`. */
function ctxOf(
    pivots: readonly PivotPoint[],
    inside: (i: number) => [high: number, low: number],
    overrides: Readonly<Record<number, number>> = {}
): QualifyContext {
    const bars = makeHLBars(
        Array.from({ length: BAR_COUNT }, (_, i): [number, number] => {
            const [high, low] = inside(i);
            const pivot = pivots.filter(p => p.index === i);
            const h = pivot.find(p => p.kind === 'high')?.price ?? high;
            const l = pivot.find(p => p.kind === 'low')?.price ?? low;
            return [h, overrides[i] ?? l];
        })
    );
    return {
        bars,
        pivots,
        atr: 1,
        lastIndex: BAR_COUNT - 1,
        minHeightPricePct: 0.03,
    };
}

describe('qualifyTrendlines — growing the window back', () => {
    // Flat resistance 110 at 30/50/70 over support 98.5 → 104 (+0.1/bar,
    // lows at 5/20/40/60). The six-pivot window [l20..h70] has the best
    // ratio — every pivot touches. Growing it back, h10 at 110.6 pokes over
    // the flat line, so the resistance refits as h10–h70 and loses the h30
    // touch — growth stops there, although the next window (with l5, on the
    // support) would have one touch more.
    const pivots = [
        piv(5, 98.5, 'low'),
        piv(10, 110.6, 'high'),
        piv(20, 100, 'low'),
        piv(30, 110, 'high'),
        piv(40, 102, 'low'),
        piv(50, 110, 'high'),
        piv(60, 104, 'low'),
        piv(70, 110, 'high'),
    ];
    const ctx = ctxOf(pivots, () => [108, 106]);

    it('draws the six-pivot window whose every pivot touches', () => {
        const [q] = qualifyTrendlines(ctx);
        expect(q.id).toBe('ascending_triangle');
        if (q.shape.kind !== 'trendline') throw new Error('trendline');
        expect(q.shape.lower.touches.map(t => t.index)).toEqual([20, 40, 60]);
        expect(q.startIndex).toBe(20);
    });

    it('stops at the first longer window that drops a touch, even if a later one has more touches', () => {
        const [q] = qualifyTrendlines(ctx);
        if (q.shape.kind !== 'trendline') throw new Error('trendline');
        expect(q.shape.upper.touches.map(t => t.index)).toEqual([30, 50, 70]);
    });
});

describe('qualifyTrendlines — channel drawn parallel to its better-touched line', () => {
    it('keeps the independent fit when it qualifies, even with no more touches than the parallel', () => {
        // Upper 112.5 + 0.25/bar through four highs; lows 105 / 110.3 /
        // 115.25 sit 0 / 0.3 / 0.25 above the parallel through the first.
        // Fitted on its own, the lower line runs l20–l60 (slope 0.25625),
        // with three touches; the parallel through l20 would also have three
        // and end at 115.0. The parallel only rescues a pair that fails.
        const up = (i: number): number => 110 + 0.25 * i;
        const pivots = [
            piv(10, up(10), 'high'),
            piv(20, 105, 'low'),
            piv(30, up(30), 'high'),
            piv(40, 110.3, 'low'),
            piv(50, up(50), 'high'),
            piv(60, 115.25, 'low'),
            piv(70, up(70), 'high'),
        ];
        const ctx = ctxOf(pivots, i => [up(i) - 1, up(i) - 9]);
        const [q] = qualifyTrendlines(ctx);
        expect(q.id).toBe('ascending_channel');
        if (q.shape.kind !== 'trendline') throw new Error('trendline');
        expect(q.shape.lower.touches.map(t => t.index)).toEqual([20, 40, 60]);
        expect(q.shape.lower.end.price).toBeCloseTo(115.25, 10);
    });

    it('never turns two flat parallels into a rectangle the independent fit rejects', () => {
        // Flat highs 110 ×4; lows 100.3 / 100.0 / 100.3. A non-swing bar next
        // to each outer low (100.0 at bars 22 and 58) pokes 0.27 under both
        // two-low lines, and l40 sits 0.3 under the l20–l60 line, so no
        // independent lower line holds. The flat parallel through l40 does,
        // touching all three lows — a rectangle by touches, but a parallel
        // only ever yields a channel.
        const pivots = [
            piv(10, 110, 'high'),
            piv(20, 100.3, 'low'),
            piv(30, 110, 'high'),
            piv(40, 100, 'low'),
            piv(50, 110, 'high'),
            piv(60, 100.3, 'low'),
            piv(70, 110, 'high'),
        ];
        const ctx = ctxOf(pivots, () => [108, 105], { 22: 100, 58: 100 });
        expect(qualifyTrendlines(ctx)).toEqual([]);
    });
});
