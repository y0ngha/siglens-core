import { describe, expect, it } from 'vitest';
import type { Bar, PatternGeometry, QualifiedPattern } from '@/domain/types';
import { isSpentPattern } from '@/domain/patterns/spentPatterns';
import { computeCandidateGeometry } from '@/domain/patterns/patternGeometry';
import { qualifyPatterns } from '@/domain/patterns/qualify/qualifyPatterns';
import { calculateATR } from '@/domain/indicators/atr';
import { chartFixture } from '@/__tests__/domain/patterns/fixtures/chartFixture';
import pennantBelowZeroFile from '@/__tests__/domain/patterns/fixtures/charts/daily-pennant-target-below-zero.json';

const bar = (close: number, i: number): Bar => ({
    time: 1_000 + i * 86_400,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
});
const bars = (closes: number[]) => closes.map(bar);

// A double top whose peaks (25) stand 15 above its neckline (10): the measured
// move runs to −5, which is not a price.
const tallDoubleTop: QualifiedPattern = {
    id: 'double_top',
    startIndex: 1,
    endIndex: 3,
    pivots: [
        { index: 1, price: 25, kind: 'high' },
        { index: 2, price: 10, kind: 'low' },
        { index: 3, price: 25, kind: 'high' },
    ],
    shape: { kind: 'extreme', neckline: { index: 2, price: 10, kind: 'low' } },
    touches: 2,
};

// The same pattern one unit shorter: the target is positive, so it is offered.
const shorterDoubleTop: QualifiedPattern = {
    ...tallDoubleTop,
    pivots: [
        { index: 1, price: 18, kind: 'high' },
        { index: 2, price: 10, kind: 'low' },
        { index: 3, price: 18, kind: 'high' },
    ],
};

describe('a measured target at or below zero', () => {
    const series = bars([20, 25, 10, 25, 20]);

    it('has no geometry', () => {
        expect(computeCandidateGeometry(tallDoubleTop, series, 1)).toBeNull();
    });

    it('is therefore never qualified, so it never reaches isSpentPattern (a real pennant whose pole is taller than its breakout)', () => {
        const chart = chartFixture(pennantBelowZeroFile);
        const atrSeries = calculateATR(chart.bars);
        const atr = atrSeries[atrSeries.length - 1];
        if (atr === null || atr === undefined) throw new Error('ATR not ready');
        expect(
            qualifyPatterns([], chart.bars, atr, '1Day', atrSeries).qualified
        ).toEqual([]);
    });

    it('a positive target of the same family is offered', () => {
        expect(
            computeCandidateGeometry(shorterDoubleTop, series, 1)
        ).toMatchObject({
            direction: 'down',
            breakoutLevel: 10,
            height: 8,
            measuredTarget: 2,
        });
    });
});

describe('isSpentPattern — the invalidation still fails a pattern whose target is positive', () => {
    const geometry: PatternGeometry = {
        keyPoints: [],
        breakoutLevel: 10,
        height: 5,
        measuredTarget: 15,
        conservativeTarget: 12.5,
        invalidationLevel: 8,
        invalidationIndex: 0,
        direction: 'up',
    };
    const pattern: QualifiedPattern = {
        id: 'double_bottom',
        startIndex: 0,
        endIndex: 2,
        pivots: [],
        shape: {
            kind: 'extreme',
            neckline: { index: 1, price: 10, kind: 'high' },
        },
        touches: 2,
    };

    it('fails below the invalidation, even for a close that came back above it', () => {
        expect(
            isSpentPattern(pattern, geometry, bars([12, 12, 12, 7.5]), 1)
        ).toBe(true);
        expect(
            isSpentPattern(pattern, geometry, bars([12, 12, 7.9, 12]), 1)
        ).toBe(true);
        expect(
            isSpentPattern(pattern, geometry, bars([12, 12, 8, 12]), 1)
        ).toBe(false);
    });
});
