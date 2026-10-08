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

    it('hits sharing three pivots overlap even when their spans barely do', () => {
        const shared: PivotPoint[] = [
            { index: 18, price: 1, kind: 'high' },
            { index: 19, price: 1, kind: 'low' },
            { index: 20, price: 1, kind: 'high' },
        ];
        expect(
            ids(
                arbitrate([
                    contender('ascending_triangle', 0, 20, 'up', shared),
                    contender('double_bottom', 18, 60, 'up', shared),
                ])
            )
        ).toEqual(['ascending_triangle']);
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
