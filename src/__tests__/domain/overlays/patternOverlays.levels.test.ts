import { describe, expect, it, vi } from 'vitest';
import type { Bar, PatternGeometry } from '@/domain/types';
import { buildPatternOverlayCandidates } from '@/domain/overlays/patternOverlays';

// vi.mock is hoisted above the imports; vi.hoisted keeps the geometry in reach.
const geometry: PatternGeometry = vi.hoisted(() => ({
    keyPoints: [],
    breakoutLevel: 10,
    height: 15,
    measuredTarget: -5,
    conservativeTarget: 2.5,
    invalidationLevel: 14,
    direction: 'down' as const,
}));

vi.mock('@/domain/patterns/patternGeometry', async importOriginal => ({
    ...(await importOriginal<
        typeof import('@/domain/patterns/patternGeometry')
    >()),
    computeCandidateGeometry: () => geometry,
}));

const bars: Bar[] = Array.from({ length: 6 }, (_, i) => ({
    time: 1_000 + i * 86_400,
    open: 12,
    high: 14,
    low: 9,
    close: 11,
    volume: 1,
}));

describe('buildPatternOverlayCandidates — outcome levels', () => {
    it('leaves out a target at or below zero, as the prompt block prints N/A', () => {
        const [c] = buildPatternOverlayCandidates(
            [
                {
                    id: 'double_top',
                    startIndex: 0,
                    endIndex: 4,
                    pivots: [
                        { index: 0, price: 14, kind: 'high' },
                        { index: 2, price: 9, kind: 'low' },
                        { index: 4, price: 14, kind: 'high' },
                    ],
                },
            ],
            bars,
            1,
            2
        );
        expect(c.levels.map(l => [l.label, l.price])).toEqual([
            ['breakout', 10],
            ['invalidation', 14],
        ]);
        // Every level starts at the pattern's first pivot, like the breakout.
        expect(c.levels.map(l => l.fromTime)).toEqual([
            bars[0].time,
            bars[0].time,
        ]);
    });

    it('leaves out a zero-length leg between two pivots on one bar, keeping the drawing', () => {
        const [c] = buildPatternOverlayCandidates(
            [
                {
                    id: 'double_top',
                    startIndex: 1,
                    endIndex: 4,
                    pivots: [
                        { index: 1, price: 14, kind: 'high' },
                        { index: 1, price: 9, kind: 'low' },
                        { index: 4, price: 14, kind: 'high' },
                    ],
                },
            ],
            bars,
            1,
            2
        );
        expect(c.segments).toHaveLength(1);
        expect(c.segments[0].to.time).toBeGreaterThan(c.segments[0].from.time);
    });
});
