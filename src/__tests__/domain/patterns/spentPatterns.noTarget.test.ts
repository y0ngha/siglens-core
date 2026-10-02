import { describe, expect, it, vi } from 'vitest';
import type { Bar, PatternCandidate, PatternGeometry } from '@/domain/types';
import { isSpentPattern } from '@/domain/patterns/spentPatterns';

// vi.mock is hoisted above the imports; vi.hoisted keeps the geometry in reach.
const geometry: PatternGeometry = vi.hoisted(() => ({
    keyPoints: [],
    breakoutLevel: 10,
    height: 15,
    measuredTarget: -5,
    conservativeTarget: 2.5,
    invalidationLevel: 8,
    direction: 'up' as const,
}));

vi.mock('@/domain/patterns/patternGeometry', async importOriginal => ({
    ...(await importOriginal<
        typeof import('@/domain/patterns/patternGeometry')
    >()),
    computeCandidateGeometry: () => geometry,
}));

const bar = (close: number, i: number): Bar => ({
    time: 1_000 + i * 86_400,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
});
const candidate: PatternCandidate = {
    id: 'double_top',
    startIndex: 0,
    endIndex: 2,
};
const bars = (closes: number[]) => closes.map(bar);

describe('isSpentPattern — a measured target at or below zero', () => {
    it('is never fulfilled: any later bar would reach it if it were checked', () => {
        // Direction up, target −5: every bar's high is past it, so a checked
        // target would spend the pattern at once; the prompt block prints N/A.
        expect(isSpentPattern(candidate, bars([12, 12, 12, 12, 12]), 1)).toBe(
            false
        );
    });

    it('still fails below the invalidation', () => {
        expect(isSpentPattern(candidate, bars([12, 12, 12, 7.5]), 1)).toBe(
            true
        );
        expect(isSpentPattern(candidate, bars([12, 12, 12, 7.9]), 1)).toBe(
            false
        );
    });
});
