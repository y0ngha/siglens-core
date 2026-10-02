import { describe, expect, it } from 'vitest';
import type { Bar } from '@/domain/types';
import { screenChartPatterns } from '@/domain/patterns/screenChartPatterns';
import { isSpentPattern } from '@/domain/patterns/spentPatterns';
import { buildAnalysisPrompt } from '@/domain/analysis/prompt';
import { calculateIndicators } from '@/domain/indicators/index';
import doubleTop from '@/__tests__/domain/patterns/fixtures/double-top.json';

// Double top ending at bar 49: invalidation 110.73 (peak 2), target 95.29,
// direction down; the fixture's last bar (64) closes at ~106.
const f = doubleTop as { atr: number; bars: Bar[] };
const withTail = (closes: number[]): Bar[] => {
    const last = f.bars[f.bars.length - 1];
    return [
        ...f.bars,
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
const dt = (bars: Bar[]) =>
    screenChartPatterns(bars, f.atr).find(c => c.id === 'double_top')!;

describe('isSpentPattern', () => {
    it('keeps a pattern the price has neither failed nor fulfilled', () => {
        expect(isSpentPattern(dt(f.bars), f.bars, f.atr)).toBe(false);
    });

    it('a close past the invalidation by more than the slack fails it; within the slack does not', () => {
        // ATR 1 → slack 0.25 above 110.73.
        const near = withTail([110.9]);
        const past = withTail([111.1]);
        expect(isSpentPattern(dt(f.bars), near, f.atr)).toBe(false);
        expect(isSpentPattern(dt(f.bars), past, f.atr)).toBe(true);
    });

    it('a bar reaching the measured target within the slack fulfils it', () => {
        // Target 95.29 (slack 0.25): lows are close − 0.1.
        const short = withTail([96]); // low 95.9 — 0.61 short
        const reached = withTail([95.6]); // low 95.5 — within 0.25
        expect(isSpentPattern(dt(f.bars), short, f.atr)).toBe(false);
        expect(isSpentPattern(dt(f.bars), reached, f.atr)).toBe(true);
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
        const db = (bars: Bar[]) =>
            screenChartPatterns(bars, f.atr).find(
                c => c.id === 'double_bottom'
            )!;
        const base = flip(f.bars);
        const tail = (closes: number[]) =>
            flip(withTail(closes.map(c => K - c)));
        expect(isSpentPattern(db(base), base, f.atr)).toBe(false);
        // Closes 109.1 (within the 0.25 slack) / 108.9 (past it).
        expect(isSpentPattern(db(base), tail([109.1]), f.atr)).toBe(false);
        expect(isSpentPattern(db(base), tail([108.9]), f.atr)).toBe(true);
        // Highs are close + 0.1: 124 → 124.1 (short), 124.4 → 124.5 (within).
        expect(isSpentPattern(db(base), tail([124]), f.atr)).toBe(false);
        expect(isSpentPattern(db(base), tail([124.4]), f.atr)).toBe(true);
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
        // reaching it drops it. (A failed double top is not reachable here:
        // a close above peak 2 makes a new peak and the screener re-counts.)
        const slide = (to: number) =>
            Array.from(
                { length: 8 },
                (_, i) => 106 + ((to - 106) * (i + 1)) / 8
            );
        expect(ids(withTail(slide(97))).some(isDoubleTop)).toBe(true);
        expect(ids(withTail(slide(95.4))).some(isDoubleTop)).toBe(false);
    });
});
