import { describe, expect, it } from 'vitest';
import type { PivotPoint } from '@/domain/types';
import type { QualifyContext } from '@/domain/patterns/qualify/context';
import { qualifyCup, qualifyRounding } from '@/domain/patterns/qualify/curves';
import { fitQuadratic } from '@/domain/patterns/classifiers';
import {
    CURVATURE_VERTEX_MID_HI,
    CURVATURE_VERTEX_MID_LO,
} from '@/domain/patterns/constants';
import { arbitrate } from '@/domain/patterns/qualify/arbitrate';
import { makeHLBars } from '@/__tests__/domain/patterns/helpers';

const piv = (
    index: number,
    price: number,
    kind: 'high' | 'low'
): PivotPoint => ({ index, price, kind });

/**
 * A U-shaped cup given by its pivots: rims 120 (bar 10) and 119.5 (bar 70),
 * bottom 100 at bar 40, handle low 116 at bar 78 — then one more swing
 * high (h84) that belongs to whatever forms after the cup. It is only three
 * bars before the last bar, too recent to be a right rim itself.
 */
const PIVOTS = [
    piv(10, 120, 'high'),
    piv(40, 100, 'low'),
    piv(70, 119.5, 'high'),
    piv(78, 116, 'low'),
    piv(84, 118.5, 'high'),
];
const U = (i: number): number => 100 + 20 * ((i - 40) / 30) ** 2;

function cupCtx(): QualifyContext {
    const bars = makeHLBars(
        Array.from({ length: 88 }, (_, i): [number, number] => {
            const pivot = PIVOTS.filter(p => p.index === i);
            const high = pivot.find(p => p.kind === 'high')?.price;
            const low = pivot.find(p => p.kind === 'low')?.price;
            const base = i <= 70 ? U(i) : 117.5;
            return [high ?? Math.min(base + 0.5, 119), low ?? base];
        })
    );
    return {
        bars,
        pivots: PIVOTS,
        atr: 1,
        lastIndex: 87,
        minHeightPricePct: 0.03,
    };
}

describe('qualifyCup — pivots are the cup structure only', () => {
    const [cup] = qualifyCup(cupCtx());

    it('lists the pivots from the left rim to the handle low, not the swing after the handle', () => {
        expect(cup.id).toBe('cup_and_handle');
        expect(cup.pivots.map(p => p.index)).toEqual([10, 40, 70, 78]);
    });

    it('a pattern built on the swing after the handle survives arbitration next to the cup', () => {
        const later = {
            pattern: {
                ...cup,
                id: 'bull_flag' as const,
                startIndex: 84,
                endIndex: 87,
                pivots: [PIVOTS[4]],
            },
            direction: 'up' as const,
        };
        expect(
            arbitrate([{ pattern: cup, direction: 'up' }, later]).map(
                c => c.pattern.id
            )
        ).toEqual(['cup_and_handle', 'bull_flag']);
    });
});

describe('qualifyCup — the right rim stays once the cup qualifies', () => {
    // The same cup, two bars later: a second high 119.8 at bar 84 (over the
    // first right rim) is now five bars back, so it could be a right rim too,
    // while bar 70 is still within the handle window. The cup keeps bar 70.
    const pivots = [
        ...PIVOTS.slice(0, 4),
        piv(84, 119.8, 'high'),
        piv(88, 116.5, 'low'),
    ];
    const ctx: QualifyContext = {
        ...cupCtx(),
        bars: makeHLBars(
            Array.from({ length: 90 }, (_, i): [number, number] => {
                const pivot = pivots.filter(p => p.index === i);
                const high = pivot.find(p => p.kind === 'high')?.price;
                const low = pivot.find(p => p.kind === 'low')?.price;
                const base = i <= 70 ? U(i) : 117.5;
                return [high ?? Math.min(base + 0.5, 119), low ?? base];
            })
        ),
        pivots,
        lastIndex: 89,
    };

    it('keeps the earliest right rim in the handle window', () => {
        const [cup] = qualifyCup(ctx);
        if (cup.shape.kind !== 'cup') throw new Error('not a cup');
        expect(cup.shape.rightRim.index).toBe(70);
    });
});

describe('qualifyCup — both sides deep enough', () => {
    // Bottom 100 at bar 40, right rim 103.7 at bar 70, handle low 102.5 at
    // bar 78; the height floor is 3.09 (3% of 103). The left rim sets the
    // shallower side.
    const shallowCtx = (leftRim: number): QualifyContext => {
        const pivots = [
            piv(10, leftRim, 'high'),
            piv(40, 100, 'low'),
            piv(70, 103.7, 'high'),
            piv(78, 102.5, 'low'),
        ];
        const base = (i: number): number => 100 + 3 * ((i - 40) / 30) ** 2;
        return {
            bars: makeHLBars(
                Array.from({ length: 88 }, (_, i): [number, number] => {
                    const pivot = pivots.filter(p => p.index === i);
                    const high = pivot.find(p => p.kind === 'high')?.price;
                    const low = pivot.find(p => p.kind === 'low')?.price;
                    const b = i < 10 ? 101 : i <= 70 ? base(i) : 103;
                    return [high ?? b + 0.2, low ?? b];
                })
            ),
            pivots,
            atr: 1,
            lastIndex: 87,
            minHeightPricePct: 0.03,
        };
    };

    it('draws the cup when the left side is 3.2 deep', () => {
        expect(qualifyCup(shallowCtx(103.2)).map(q => q.id)).toEqual([
            'cup_and_handle',
        ]);
    });

    it('does not when the left side is 3.0 deep, under the floor, although the right side is 3.7', () => {
        expect(qualifyCup(shallowCtx(103))).toEqual([]);
    });
});

/**
 * A saucer whose closes (= lows here) run 3 under the rim highs: rims 120
 * (bar 10) and 119.5 (bar 70), lows on 100 + 17·((i − 40)/30)², bottom 100
 * at bar 40. The quadratic fitted on the closes starts and ends near 117.
 */
function saucerCtx(bottomAt = 40): QualifyContext {
    const U = (i: number): number => 100 + 17 * ((i - bottomAt) / 30) ** 2;
    const bars = makeHLBars(
        Array.from({ length: 76 }, (_, i): [number, number] => {
            if (i < 10) return [111, 110];
            if (i === 10) return [120, U(i)];
            if (i === 70) return [119.5, U(i)];
            if (i > 70) return [117.5, 117];
            return [U(i) + 0.5, U(i)];
        })
    );
    return {
        bars,
        pivots: [
            piv(10, 120, 'high'),
            piv(bottomAt, 100, 'low'),
            piv(70, 119.5, 'high'),
        ],
        atr: 1,
        lastIndex: 75,
        minHeightPricePct: 0.03,
    };
}

describe('qualifyRounding — the drawn arc runs through the printed points', () => {
    const [rounding] = qualifyRounding(saucerCtx(), 'bottom');
    const arc = rounding?.shape.kind === 'rounding' ? rounding.shape.arc : [];

    it('qualifies', () => {
        expect(rounding?.id).toBe('rounding_bottom');
    });

    it('starts on the left rim, ends on the right rim and bottoms at the extreme bar', () => {
        expect(arc[0]).toEqual({ index: 10, price: 120 });
        expect(arc.at(-1)).toEqual({ index: 70, price: 119.5 });
        expect(arc).toContainEqual({ index: 40, price: 100 });
        expect(Math.min(...arc.map(p => p.price))).toBe(100);
    });

    it('falls to the extreme and rises after it', () => {
        const left = arc.filter(p => p.index <= 40);
        const right = arc.filter(p => p.index >= 40);
        left.slice(1).forEach((p, i) =>
            expect(p.price).toBeLessThan(left[i].price)
        );
        right
            .slice(1)
            .forEach((p, i) => expect(p.price).toBeGreaterThan(right[i].price));
    });
});

describe('qualifyRounding — the extreme bar sits in the middle half of the span', () => {
    // Span 10..70: the middle half is bars 25..55.
    it.each([
        [25, true],
        [55, true],
        [24, false],
        [56, false],
    ])('bottom at bar %i → qualifies: %s', (bottomAt, ok) => {
        const ctx = saucerCtx(40);
        // Move only the extreme bar; the fit (closes) keeps its centred vertex.
        const bars = ctx.bars.map((b, i) =>
            i === bottomAt ? { ...b, low: 99, close: b.close } : b
        );
        const out = qualifyRounding(
            {
                ...ctx,
                bars,
                pivots: [
                    piv(10, 120, 'high'),
                    piv(bottomAt, 99, 'low'),
                    piv(70, 119.5, 'high'),
                ],
            },
            'bottom'
        );
        // Only the extreme bar moves: the closes the quadratic is fitted on
        // are unchanged, so the fitted-vertex check passes in every case and
        // the outcome is the extreme-bar check alone.
        const fit = fitQuadratic(
            bars.slice(10, 71).map((b, x) => ({ x, y: b.close }))
        );
        if (fit === null) throw new Error('no fit');
        const vertex = -fit.b / (2 * fit.a);
        expect(vertex).toBeGreaterThanOrEqual(60 * CURVATURE_VERTEX_MID_LO);
        expect(vertex).toBeLessThanOrEqual(60 * CURVATURE_VERTEX_MID_HI);
        expect(out.length === 1).toBe(ok);
    });
});
