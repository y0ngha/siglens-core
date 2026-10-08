import { describe, expect, it } from 'vitest';
import type { Bar, PatternGeometry, QualifiedPattern } from '@/domain/types';
import { isSpentPattern } from '@/domain/patterns/spentPatterns';

const geometry: PatternGeometry = {
    keyPoints: [],
    breakoutLevel: 10,
    height: 15,
    measuredTarget: -5,
    conservativeTarget: 2.5,
    invalidationLevel: 8,
    invalidationIndex: 0,
    direction: 'up',
};

const bar = (close: number, i: number): Bar => ({
    time: 1_000 + i * 86_400,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
});
const pattern: QualifiedPattern = {
    id: 'double_bottom',
    startIndex: 0,
    endIndex: 2,
    pivots: [],
    shape: { kind: 'extreme', neckline: { index: 1, price: 10, kind: 'high' } },
    touches: 2,
};
const bars = (closes: number[]) => closes.map(bar);

describe('isSpentPattern — a measured target at or below zero', () => {
    it('is never fulfilled: any later bar would reach it if it were checked', () => {
        // Direction up, target −5: every bar's high is past it, so a checked
        // target would spend the pattern at once; the prompt block prints N/A.
        expect(
            isSpentPattern(pattern, geometry, bars([12, 12, 12, 12, 12]), 1)
        ).toBe(false);
    });

    it('still fails below the invalidation', () => {
        expect(
            isSpentPattern(pattern, geometry, bars([12, 12, 12, 7.5]), 1)
        ).toBe(true);
        // Any close under it fails it, even one that came back above.
        expect(
            isSpentPattern(pattern, geometry, bars([12, 12, 7.9, 12]), 1)
        ).toBe(true);
        expect(
            isSpentPattern(pattern, geometry, bars([12, 12, 8, 12]), 1)
        ).toBe(false);
    });
});
