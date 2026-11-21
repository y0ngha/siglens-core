import { describe, expect, it } from 'vitest';
import type { Bar, PivotPoint } from '@/domain/types';
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

describe('qualifyTrendlines — the breakout bar is frozen at the first close beyond the breakout line', () => {
    /** A bar closing at `close`, spanning `[low, high]` (a tail bar's own range is irrelevant to the pair). */
    const tailBar = (close: number): [number, number, number] => [
        close + 0.1,
        close - 0.1,
        close,
    ];

    /**
     * `ctxOf` with extra closing bars after the last pivot. `lastPivot` is the
     * last index with a pivot; bars up to it follow `inside`, the tail bars
     * start right after it.
     */
    function ctxWithTail(
        pivots: readonly PivotPoint[],
        inside: [high: number, low: number],
        tail: readonly number[],
        mirror = false,
        closeAt: Readonly<Record<number, number>> = {}
    ): QualifyContext {
        const last = pivots[pivots.length - 1].index;
        const head = makeHLBars(
            Array.from({ length: last + 1 }, (_, i): [number, number] => {
                const pivot = pivots.filter(p => p.index === i);
                const h =
                    pivot.find(p => p.kind === 'high')?.price ?? inside[0];
                const l = pivot.find(p => p.kind === 'low')?.price ?? inside[1];
                return [h, l];
            })
        );
        const tailBars: Bar[] = tail.map((close, k) => {
            const [high, low] = tailBar(close);
            return {
                time: last + 1 + k,
                open: close,
                high,
                low,
                close,
                volume: 1000,
            };
        });
        const bars = [...head, ...tailBars].map((b, i) =>
            closeAt[i] === undefined
                ? b
                : {
                      ...b,
                      close: closeAt[i],
                      high: Math.max(b.high, closeAt[i]),
                  }
        );
        const ctx: QualifyContext = {
            bars,
            pivots,
            atr: 1,
            lastIndex: bars.length - 1,
            minHeightPricePct: 0.03,
        };
        if (!mirror) return ctx;
        const flip = (price: number): number => 220 - price;
        return {
            ...ctx,
            bars: bars.map(b => ({
                ...b,
                open: flip(b.open),
                high: flip(b.low),
                low: flip(b.high),
                close: flip(b.close),
            })),
            pivots: pivots.map(p => ({
                index: p.index,
                price: flip(p.price),
                kind: p.kind === 'high' ? 'low' : 'high',
            })),
        };
    }

    // Flat resistance 110, support rising 0.1/bar from 100 at bar 20: an
    // ascending triangle, last touch at bar 70, so a break is read from bar 71.
    const triangle = [
        piv(20, 100, 'low'),
        piv(30, 110, 'high'),
        piv(40, 102, 'low'),
        piv(50, 110, 'high'),
        piv(60, 104, 'low'),
        piv(70, 110, 'high'),
    ];
    const upTriangle = (tail: number[], mirror = false) => {
        const [q] = qualifyTrendlines(
            ctxWithTail(triangle, [108, 106], tail, mirror)
        );
        return q;
    };
    const breakoutIndex = (q: ReturnType<typeof upTriangle>): number => {
        if (q.shape.kind !== 'trendline') throw new Error('trendline');
        return q.shape.breakoutIndex;
    };

    it('a directed-up pair breaks at the first close above its upper line', () => {
        const q = upTriangle([107, 109, 110.5, 111, 125]);
        expect(q.id).toBe('ascending_triangle');
        expect(q.endIndex).toBe(70);
        expect(breakoutIndex(q)).toBe(73);
    });

    it('a close equal to the upper line is not a break', () => {
        // Bar 72 closes exactly on the flat 110, bar 74 is the first above.
        expect(breakoutIndex(upTriangle([107, 110, 109, 110.01]))).toBe(74);
    });

    it('is the last bar while no close is above the upper line', () => {
        expect(breakoutIndex(upTriangle([107, 109, 110]))).toBe(73);
        expect(breakoutIndex(upTriangle([]))).toBe(70);
    });

    it("a close over the line on the pair's own last bar (inside the containment slack) is not the break", () => {
        // Lows 100 / 102 / 104 at 20 / 40 / 60 under flat highs 110 at 30 / 50:
        // the pair ends on the low at bar 60, whose bar reaches 110.1 and
        // closes there, over the 110 line by less than the 0.25 slack.
        const lowEnd = [
            piv(20, 100, 'low'),
            piv(30, 110, 'high'),
            piv(40, 102, 'low'),
            piv(50, 110, 'high'),
            piv(60, 104, 'low'),
        ];
        const [q] = qualifyTrendlines(
            ctxWithTail(lowEnd, [108, 106], [107, 111], false, { 60: 110.1 })
        );
        expect(q.endIndex).toBe(60);
        expect(breakoutIndex(q)).toBe(62);
    });

    it('a close under the lower line is not the breakout of an up pair', () => {
        // Bar 72 closes far under the rising support; the up break is bar 74.
        expect(breakoutIndex(upTriangle([107, 90, 107, 111]))).toBe(74);
    });

    it('a directed-down pair (the mirror) breaks at the first close below its lower line', () => {
        // The tail is given in the up chart's prices and mirrored with it.
        const q = upTriangle([107, 109, 110.5, 111, 125], true);
        expect(q.id).toBe('descending_triangle');
        expect(breakoutIndex(q)).toBe(73);
        // Equal close: 220 − 110 = 110, exactly on the flat lower line.
        expect(breakoutIndex(upTriangle([107, 110, 109, 110.01], true))).toBe(
            74
        );
    });

    describe('an undirected pair takes the earlier of its two sides', () => {
        // Flat 110 / 100 rectangle with three touches each, last touch at bar 60.
        const rectangle = [
            piv(10, 110, 'high'),
            piv(20, 100, 'low'),
            piv(30, 110, 'high'),
            piv(40, 100, 'low'),
            piv(50, 110, 'high'),
            piv(60, 100, 'low'),
        ];
        const rect = (tail: number[]) => {
            const [q] = qualifyTrendlines(
                ctxWithTail(rectangle, [108, 102], tail)
            );
            return q;
        };

        it('a close below the lower line first', () => {
            const q = rect([105, 99.9, 105, 110.5]);
            expect([q.id, q.shape]).toMatchObject([
                'rectangle',
                { direction: null, breakoutIndex: 62 },
            ]);
        });

        it('a close above the upper line first', () => {
            expect(breakoutIndex(rect([105, 105, 110.5, 99]))).toBe(63);
        });

        it('only one side breaks', () => {
            expect(breakoutIndex(rect([105, 105, 105, 110.5]))).toBe(64);
        });

        it('closes equal to either line are not a break', () => {
            expect(breakoutIndex(rect([100, 110, 105]))).toBe(63);
        });
    });
});
