import { describe, expect, it } from 'vitest';
import { buildTriangleCandidates } from '@/domain/overlays/elliottTriangle';
import { FMT, pivotsAt } from '@/__tests__/domain/overlays/elliottTestHelpers';

// Contracting triangle, A down: lows 100 → 104 on a rising A–C line, highs
// 116 → 113 on a falling B–D line; E stops 0.5 above the A–C line (108 at E).
const TRIANGLE = [120, 100, 116, 104, 113, 107.5, 111];
const triangles = (prices: number[], at?: number[]) => {
    const { pivots, bars } = pivotsAt(prices, at);
    return buildTriangleCandidates(pivots, bars, 1, FMT).map(c => c.candidate);
};
const triangleFrom0 = (prices: number[], at?: number[]) =>
    triangles(prices, at).find(c => c.id === 'ew:down:0:tri');

describe('buildTriangleCandidates', () => {
    it('a complete triangle: 5 legs, both boundaries to E, labels A–E', () => {
        const tri = triangleFrom0(TRIANGLE);
        expect(tri?.promptLine).toMatch(
            /^triangle \(contracting\), A down; complete; 0 /
        );
        expect(tri?.labels.map(l => l.text)).toEqual(['A', 'B', 'C', 'D', 'E']);
        expect(tri?.segments.map(s => s.role)).toEqual([
            'wave_A',
            'wave_B',
            'wave_C',
            'wave_D',
            'wave_E',
            'boundary_ac',
            'boundary_bd',
        ]);
        expect(tri?.segments[5].to).toEqual({ time: 20, price: 108 });
        expect(tri?.segments[6].to).toEqual({ time: 20, price: 111.5 });
    });

    it('states the invalidation per state and, once complete, the thrust target', () => {
        // Complete: E may not pass C's end (104); widest width = A's end (100)
        // to the B–D line there (117.5) = 17.5, projected up from E (107.5).
        expect(triangleFrom0(TRIANGLE)?.promptLine).toContain(
            '; invalidation 104.00; thrust target 125.00; score '
        );
        expect(
            triangleFrom0([120, 100, 116, 104, 113, 108.5])?.promptLine
        ).toContain('; invalidation 104.00; score ');
        // D forming: D may not pass B's end.
        expect(triangleFrom0([120, 100, 116, 104, 113])?.promptLine).toContain(
            '; invalidation 116.00; score '
        );
    });

    it('a barrier E edging past C (within EW_TRI_LEG_TOLERANCE) moves the invalidation to E', () => {
        // Flat lower side: C ends 100.2, E 100.1.
        expect(
            triangleFrom0([120, 100, 116, 100.2, 112, 100.1, 104])?.promptLine
        ).toContain('; invalidation 100.10; thrust target 118.10; score ');
    });

    it('E forming at the right edge, and D forming with E next', () => {
        expect(
            triangleFrom0([120, 100, 116, 104, 113, 108.5])?.promptLine
        ).toContain('; E in progress; ');
        const d = triangleFrom0([120, 100, 116, 104, 113]);
        expect(d?.promptLine).toContain('; D forming, E next; ');
        expect(d?.labels.map(l => l.text)).toEqual(['A', 'B', 'C', 'D']);
    });

    it('rejects a leg not shorter than the one two back (C ≥ A)', () => {
        // A 14.4 < C 14.5; with A 14.6 the same box-like shape passes.
        expect(
            triangleFrom0([114.4, 100, 115, 100.5, 115.2, 105, 108])
        ).toBeUndefined();
        expect(
            triangleFrom0([114.6, 100, 115, 100.5, 115.2, 105, 108])
        ).toBeDefined();
    });

    it('rejects a leg retracing under half the leg before it', () => {
        // B = 9 of A = 20; with B = 11 the same shape passes.
        expect(
            triangleFrom0([120, 100, 109, 101.5, 107.5, 103, 106])
        ).toBeUndefined();
        expect(
            triangleFrom0([120, 100, 111, 101.5, 107.5, 103, 106])
        ).toBeDefined();
    });

    it('rejects E running more than EW_TRI_E_OVERSHOOT ATR past the A–C line', () => {
        expect(
            triangleFrom0([120, 100, 116, 104, 113, 106, 111])
        ).toBeUndefined();
    });

    it('rejects a complete E stopping well short of the A–C line', () => {
        // Near-flat A–C line at ~101: E covers 5 of the 9 from D to it.
        expect(
            triangleFrom0([123, 100, 116, 100.5, 110, 105, 108])
        ).toBeUndefined();
    });

    it('rejects wave A starting inside the B–D line', () => {
        expect(
            triangleFrom0([117.5, 100, 116, 104, 113, 107.5, 111])
        ).toBeUndefined();
    });

    it('rejects legs of very unequal duration', () => {
        // C takes 13 bars, every other leg 4.
        expect(
            triangleFrom0(TRIANGLE, [0, 4, 8, 21, 25, 29, 33])
        ).toBeUndefined();
    });
});
