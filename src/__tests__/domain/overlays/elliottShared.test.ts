import { describe, expect, it } from 'vitest';
import type { PivotPoint } from '@/domain/types';
import {
    classifyAbc,
    mergeShortLegs,
    pivotRuns,
    timeBalance,
} from '@/domain/overlays/elliottShared';
import { pivotsAt } from '@/__tests__/domain/overlays/elliottTestHelpers';

const p = (index: number, price: number, kind: 'high' | 'low'): PivotPoint => ({
    index,
    price,
    kind,
});

describe('mergeShortLegs', () => {
    it('drops a too-soon pivot and keeps the more extreme of two lows', () => {
        expect(
            mergeShortLegs([
                p(0, 100, 'high'),
                p(10, 90, 'low'),
                p(10, 95, 'high'),
                p(11, 89, 'low'),
                p(20, 99, 'high'),
            ])
        ).toEqual([p(0, 100, 'high'), p(11, 89, 'low'), p(20, 99, 'high')]);
    });

    it('keeps the earlier pivot when the later one of its kind is less extreme', () => {
        expect(
            mergeShortLegs([
                p(0, 90, 'low'),
                p(10, 100, 'high'),
                p(11, 98, 'low'),
                p(12, 99, 'high'),
                p(20, 92, 'low'),
            ])
        ).toEqual([p(0, 90, 'low'), p(10, 100, 'high'), p(20, 92, 'low')]);
    });

    it('returns [] for no pivots', () => {
        expect(mergeShortLegs([])).toEqual([]);
    });
});

describe('pivotRuns', () => {
    const { pivots } = pivotsAt([100, 110, 104, 116, 108]);

    it('every alternating run long enough, or only the right-edge run', () => {
        expect(pivotRuns(pivots, 4)).toHaveLength(2);
        expect(pivotRuns(pivots, 4, true)).toEqual([pivots.slice(1)]);
    });

    it('drops runs spanning fewer than EW_MIN_IMPULSE_SPAN_BARS bars', () => {
        expect(pivotRuns(pivots.slice(0, 3), 3)).toEqual([]);
    });
});

describe('timeBalance', () => {
    it('leaves out a still-forming last leg', () => {
        const { pivots } = pivotsAt([100, 110, 104, 112], [0, 4, 8, 9]);
        expect(timeBalance(pivots)).toBe(1 / 4);
        expect(timeBalance(pivots, true)).toBe(1);
    });
});

describe('classifyAbc', () => {
    // A = 10 down from 110; B and C set the type.
    const abc = (b: number, c: number) =>
        pivotsAt([110, 100, 100 + b, 100 + b - c]).pivots;

    it.each([
        ['zigzag', 5, 12, false],
        ['regular flat', 9.5, 10.5, false],
        ['expanded flat', 12, 15, false],
        ['running flat', 12, 10, false],
        // C still forming: the C-dependent conditions wait.
        ['zigzag', 5, 3, true],
        ['regular flat', 9.5, 7, true],
        ['expanded flat', 12, 15, true],
        // A forming C already past A's end only extends: expanded.
        ['expanded flat', 12, 12.5, true],
        ['expanded or running flat', 12, 11, true],
    ] as const)('%s (B %s, C %s, forming %s)', (type, b, c, forming) => {
        expect(classifyAbc(abc(b, c), forming)).toBe(type);
    });

    it.each([
        ['B between the zigzag and flat bands', 8.5, 12],
        ['B far past A’s start', 14, 16],
        ['a zigzag whose C stays inside A', 5, 4],
        ['a regular flat whose C runs far past A', 9.5, 15],
        ['a regular flat whose C falls well short', 9.5, 7],
        ['an expanded/running flat with C at A’s end', 12, 12.5],
    ])('null for %s', (_, b, c) => {
        expect(classifyAbc(abc(b, c), false)).toBeNull();
    });
});
