import { describe, expect, it } from 'vitest';
import type {
    ChartPatternId,
    PatternBreakoutDirection,
    PivotPoint,
    QualifiedPattern,
} from '@/domain/types';
import { type Contender, arbitrate } from '@/domain/patterns/qualify/arbitrate';

const contender = (
    id: ChartPatternId,
    startIndex: number,
    endIndex: number,
    direction: PatternBreakoutDirection | null,
    pivots: readonly PivotPoint[] = [],
    touches = 4
): Contender => ({
    pattern: {
        id,
        startIndex,
        endIndex,
        pivots,
        shape: {
            kind: 'extreme',
            neckline: { index: startIndex, price: 1, kind: 'low' },
        },
        touches,
    } satisfies QualifiedPattern,
    direction,
});
const ids = (kept: readonly Contender[]): ChartPatternId[] =>
    kept.map(c => c.pattern.id);

describe('arbitrate (spec 2026-10-07 §2.5)', () => {
    // The shorter span is 20 bars in every case below.
    const triangle = contender('ascending_triangle', 0, 20, 'up');

    it('keeps one of two same-direction hits whose spans overlap by more than half of the shorter one', () => {
        // Overlap 11 of 20 bars (55%).
        expect(
            ids(arbitrate([contender('double_bottom', 9, 29, 'up'), triangle]))
        ).toEqual(['ascending_triangle']);
    });

    it('keeps both when the overlap is exactly half (the bound is exclusive)', () => {
        expect(
            ids(arbitrate([triangle, contender('double_bottom', 10, 30, 'up')]))
        ).toEqual(['ascending_triangle', 'double_bottom']);
    });

    it('keeps both same-direction hits whose spans overlap by less than half', () => {
        expect(
            ids(arbitrate([triangle, contender('double_bottom', 11, 31, 'up')]))
        ).toEqual(['ascending_triangle', 'double_bottom']);
    });

    it('never keeps two opposite-direction hits that share any bars', () => {
        expect(
            ids(arbitrate([contender('double_top', 19, 39, 'down'), triangle]))
        ).toEqual(['ascending_triangle']);
    });

    it('an undirected hit is not "opposite" to anything', () => {
        expect(
            ids(arbitrate([triangle, contender('rectangle', 15, 35, null)]))
        ).toEqual(['ascending_triangle', 'rectangle']);
    });

    it('a later hit that reuses one pivot of an earlier one overlaps it even though their spans only touch at that bar', () => {
        // H&S [h27, l35, h45, l55, h63] and a double top whose first peak is
        // the H&S right shoulder (h63): spans 27–63 and 63–87 share one bar.
        const rightShoulder: PivotPoint = {
            index: 63,
            price: 110,
            kind: 'high',
        };
        const hs = contender('head_and_shoulders', 27, 63, 'down', [
            { index: 27, price: 110, kind: 'high' },
            { index: 35, price: 104, kind: 'low' },
            { index: 45, price: 115, kind: 'high' },
            { index: 55, price: 105, kind: 'low' },
            rightShoulder,
        ]);
        const doubleTop = contender('double_top', 63, 87, 'down', [
            rightShoulder,
            { index: 75, price: 103, kind: 'low' },
            { index: 87, price: 110, kind: 'high' },
        ]);
        expect(ids(arbitrate([doubleTop, hs]))).toEqual(['head_and_shoulders']);
    });

    it('keeps both when spans only touch at one bar and no pivot is shared', () => {
        expect(
            ids(
                arbitrate([
                    contender('ascending_triangle', 0, 20, 'up', [
                        { index: 20, price: 1, kind: 'high' },
                    ]),
                    contender('double_bottom', 20, 60, 'up', [
                        { index: 20, price: 1, kind: 'low' },
                    ]),
                ])
            )
        ).toEqual(['ascending_triangle', 'double_bottom']);
    });

    it('within one rank, more touches win, then the more recent end', () => {
        expect(
            ids(
                arbitrate([
                    contender('ascending_wedge', 0, 20, 'down', [], 6),
                    contender('descending_triangle', 2, 22, 'down', [], 7),
                ])
            )
        ).toEqual(['descending_triangle']);
        expect(
            ids(
                arbitrate([
                    contender('ascending_wedge', 0, 20, 'down'),
                    contender('descending_triangle', 2, 22, 'down'),
                ])
            )
        ).toEqual(['descending_triangle']);
    });
});
