import { describe, expect, it } from 'vitest';
import type { Bar, QualifiedPattern } from '@/domain/types';
import { buildPatternOverlayCandidates } from '@/domain/overlays/patternOverlays';

const bars: Bar[] = Array.from({ length: 6 }, (_, i) => ({
    time: 1_000 + i * 86_400,
    open: 12,
    high: 14,
    low: 9,
    close: 11,
    volume: 1,
}));
const doubleTop = (
    pivots: QualifiedPattern['pivots'],
    startIndex: number
): QualifiedPattern => ({
    id: 'double_top',
    startIndex,
    endIndex: 4,
    pivots,
    shape: {
        kind: 'extreme',
        neckline: pivots.find(p => p.kind === 'low') ?? pivots[0],
    },
    touches: 2,
});
const top = (peak: number, neck: number): QualifiedPattern =>
    doubleTop(
        [
            { index: 0, price: peak, kind: 'high' },
            { index: 2, price: neck, kind: 'low' },
            { index: 4, price: peak, kind: 'high' },
        ],
        0
    );
const DP2 = { dp: 2, krxTick: null };

describe('buildPatternOverlayCandidates — outcome levels', () => {
    // A measured target at or below zero is not offered by the geometry, so it
    // can only reach the drawing through rounding at the printed precision: a
    // 0.0099 move under a 0.0104 neckline is a positive 0.0005 target, but both
    // levels print at 0.01 and 0.02 on a 2-decimal quote.
    it('leaves out a target that only rounds to zero at the printed precision, as the prompt block prints N/A', () => {
        const [c] = buildPatternOverlayCandidates(
            [top(0.0203, 0.0104)],
            bars,
            0.001,
            DP2
        );
        expect(c.levels.map(l => [l.label, l.price])).toEqual([
            ['breakout', 0.01],
            ['invalidation', 0.02],
        ]);
        // Every level starts at the pattern's first point, like the breakout.
        expect(c.levels.map(l => l.fromTime)).toEqual([
            bars[0].time,
            bars[0].time,
        ]);
    });

    it('keeps the target when it stays positive after rounding (same shape, one cent higher)', () => {
        const [c] = buildPatternOverlayCandidates(
            [top(0.0303, 0.0204)],
            bars,
            0.001,
            DP2
        );
        expect(c.levels.map(l => [l.label, l.price])).toEqual([
            ['breakout', 0.02],
            ['invalidation', 0.03],
            ['target', 0.01],
        ]);
    });

    it('leaves out a zero-length leg between two pivots on one bar, keeping the drawing', () => {
        const [c] = buildPatternOverlayCandidates(
            [
                doubleTop(
                    [
                        { index: 1, price: 14, kind: 'high' },
                        { index: 1, price: 9, kind: 'low' },
                        { index: 4, price: 14, kind: 'high' },
                    ],
                    1
                ),
            ],
            bars,
            1,
            DP2
        );
        expect(c.segments).toHaveLength(1);
        expect(c.segments[0].to.time).toBeGreaterThan(c.segments[0].from.time);
    });
});
