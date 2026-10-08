import { describe, expect, it } from 'vitest';
import type {
    Bar,
    PatternGeometry,
    QualifiedPattern,
    UndirectedPatternGeometry,
} from '@/domain/types';
import { qualifyPatterns } from '@/domain/patterns/qualify/qualifyPatterns';
import { computeCandidateGeometry } from '@/domain/patterns/patternGeometry';
import { isSpentPattern } from '@/domain/patterns/spentPatterns';
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { calculateIndicators } from '@/domain/indicators/index';
import doubleTop from '@/__tests__/domain/patterns/fixtures/double-top.json';
import ascendingTriangle from '@/__tests__/domain/patterns/fixtures/ascending-triangle.json';

// Double top ending at bar 49: invalidation 110.73 (peak 2, bar 49), target
// 95.29, direction down; the fixture's last bar (64) closes at ~106.
const f = doubleTop as { atr: number; bars: Bar[] };
const withTail = (base: readonly Bar[], closes: number[]): Bar[] => {
    const last = base[base.length - 1];
    return [
        ...base,
        ...closes.map((c, i) => ({
            time: last.time + i + 1,
            open: c,
            high: c + 0.1,
            low: c - 0.1,
            close: c,
            volume: 1_000_000,
        })),
    ];
};
const qualifiedOf = (
    bars: readonly Bar[],
    atr: number,
    id: QualifiedPattern['id']
): QualifiedPattern => {
    const found = qualifyPatterns([], bars, atr, '1Day').qualified.find(
        q => q.id === id
    );
    if (!found) throw new Error(`fixture no longer qualifies ${id}`);
    return found;
};
const spent = (
    pattern: QualifiedPattern,
    bars: readonly Bar[],
    atr: number
): boolean => {
    const geometry = computeCandidateGeometry(pattern, bars, atr);
    if (geometry === null) throw new Error('no geometry');
    return isSpentPattern(pattern, geometry, bars, atr);
};
const dt = qualifiedOf(f.bars, f.atr, 'double_top');

describe('isSpentPattern', () => {
    it('keeps a pattern the price has neither failed nor fulfilled', () => {
        expect(spent(dt, f.bars, f.atr)).toBe(false);
    });

    it('any close past the fixed invalidation fails it with no slack — even one that came back', () => {
        // Invalidation 110.73; the last close (106) is back under it.
        expect(spent(dt, withTail(f.bars, [110.7, 106]), f.atr)).toBe(false);
        expect(spent(dt, withTail(f.bars, [110.73, 106]), f.atr)).toBe(false);
        expect(spent(dt, withTail(f.bars, [110.8, 106]), f.atr)).toBe(true);
    });

    it('a bar reaching the measured target within the slack fulfils it', () => {
        // Target 95.29 (slack 0.25): lows are close − 0.1.
        expect(spent(dt, withTail(f.bars, [96]), f.atr)).toBe(false);
        expect(spent(dt, withTail(f.bars, [95.6]), f.atr)).toBe(true);
    });

    it('mirrored (a double bottom, direction up): fails below the invalidation, fulfils at the target', () => {
        // Flip every price around K = 220: invalidation 109.27, target 124.71.
        const K = 220;
        const flip = (bars: Bar[]): Bar[] =>
            bars.map(b => ({
                ...b,
                open: K - b.open,
                high: K - b.low,
                low: K - b.high,
                close: K - b.close,
            }));
        const base = flip(f.bars);
        const db = qualifiedOf(base, f.atr, 'double_bottom');
        const tail = (closes: number[]) =>
            flip(
                withTail(
                    f.bars,
                    closes.map(c => K - c)
                )
            );
        expect(spent(db, base, f.atr)).toBe(false);
        expect(spent(db, tail([109.3, 114]), f.atr)).toBe(false);
        expect(spent(db, tail([109.2, 114]), f.atr)).toBe(true);
        expect(spent(db, tail([109.3]), f.atr)).toBe(false);
        expect(spent(db, tail([109.2]), f.atr)).toBe(true);
        expect(spent(db, tail([124]), f.atr)).toBe(false);
        expect(spent(db, tail([124.4]), f.atr)).toBe(true);
    });

    it('counts the invalidation only from the bar that set it — a rising support’s earlier, lower lows do not fail the triangle', () => {
        const t = ascendingTriangle as { atr: number; bars: Bar[] };
        const triangle = qualifiedOf(t.bars, t.atr, 'ascending_triangle');
        const g = computeCandidateGeometry(triangle, t.bars, t.atr);
        if (g === null || g.direction !== 'up') throw new Error('not up');
        // Invalidation = the last support touch; the first support touch
        // (bar 7, ~100) closes far below it and still does not spend it.
        expect(g.invalidationIndex).toBeGreaterThan(triangle.startIndex);
        expect(
            t.bars
                .slice(triangle.startIndex)
                .some(b => b.close < g.invalidationLevel)
        ).toBe(true);
        expect(spent(triangle, t.bars, t.atr)).toBe(false);
    });

    it('counts the target only after the pattern’s last structural point — a converging pattern’s own earlier range does not fulfil it', () => {
        const bars: Bar[] = [12, 12, 4, 12, 12, 12, 3.8].map((c, i) => ({
            time: i,
            open: c,
            high: c,
            low: c,
            close: c,
            volume: 1,
        }));
        const pattern: QualifiedPattern = {
            id: 'double_top',
            startIndex: 0,
            endIndex: 4,
            pivots: [],
            shape: {
                kind: 'extreme',
                neckline: { index: 2, price: 8, kind: 'low' },
            },
            touches: 2,
        };
        const geometry: PatternGeometry = {
            keyPoints: [],
            breakoutLevel: 8,
            height: 4,
            measuredTarget: 4,
            conservativeTarget: 6,
            invalidationLevel: 20,
            invalidationIndex: 4,
            direction: 'down',
        };
        // Bar 2 (low 4) sits inside the pattern: not fulfilled.
        expect(isSpentPattern(pattern, geometry, bars.slice(0, 6), 1)).toBe(
            false
        );
        // Bar 6, after the last pivot, reaches it.
        expect(isSpentPattern(pattern, geometry, bars, 1)).toBe(true);
    });

    it('an undirected pattern is spent once a bar after its last touch travels a full height beyond a boundary', () => {
        const bars: Bar[] = [10, 10, 10, 10, 14.8, 15.1].map((c, i) => ({
            time: i,
            open: c,
            high: c,
            low: c,
            close: c,
            volume: 1,
        }));
        const pattern: QualifiedPattern = {
            id: 'rectangle',
            startIndex: 0,
            endIndex: 3,
            pivots: [],
            shape: {
                kind: 'trendline',
                upper: {
                    start: { index: 0, price: 11 },
                    end: { index: 3, price: 11 },
                    touches: [],
                },
                lower: {
                    start: { index: 0, price: 9 },
                    end: { index: 3, price: 9 },
                    touches: [],
                },
                direction: null,
            },
            touches: 4,
        };
        const geometry: UndirectedPatternGeometry = {
            keyPoints: [],
            height: 4,
            upperLevel: 11,
            lowerLevel: 9,
            direction: null,
        };
        // 11 + 4 = 15, slack 0.25 → 14.75 reached at bar 4.
        expect(isSpentPattern(pattern, geometry, bars.slice(0, 4), 1)).toBe(
            false
        );
        expect(isSpentPattern(pattern, geometry, bars.slice(0, 5), 1)).toBe(
            true
        );
        // Mirrored: a full height below the lower boundary.
        const down = bars.map(b => ({
            ...b,
            high: 20 - b.high,
            low: 20 - b.low,
            close: 20 - b.close,
        }));
        expect(isSpentPattern(pattern, geometry, down.slice(0, 5), 1)).toBe(
            true
        );
    });

    it('the prompt leaves a fulfilled pattern out of its candidates and overlays', () => {
        const ids = (bars: Bar[]) =>
            buildAnalysisPrompt(
                'T',
                'T',
                bars,
                calculateIndicators(bars),
                [],
                '1Day'
            ).overlayCandidates.map(c => c.id);
        const isDoubleTop = (id: string) =>
            id.startsWith('pattern:double_top:');
        // A slide from ~106: stopping short of the target keeps the pattern;
        // reaching it drops it. Five bars keep the last peak (bar 49) inside
        // the recency window (20 bars).
        const slide = (to: number) =>
            Array.from(
                { length: 5 },
                (_, i) => 106 + ((to - 106) * (i + 1)) / 5
            );
        expect(ids(withTail(f.bars, slide(97))).some(isDoubleTop)).toBe(true);
        expect(ids(withTail(f.bars, slide(95.4))).some(isDoubleTop)).toBe(
            false
        );
    });
});
