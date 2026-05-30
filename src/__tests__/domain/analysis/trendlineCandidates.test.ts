import { describe, it, expect } from 'vitest';
import { computeTrendlineCandidates } from '@/domain/analysis/trendlineCandidates';
import { EMPTY_SMC_RESULT } from '@/domain/indicators/constants';
import type { Bar, SMCResult, SMCSwingPoint } from '@/domain/types';

const BASE_TIME = 1_700_000_000;
const TIME_STEP = 100;

/** Build `count` bars whose times are evenly spaced from BASE_TIME. */
const makeBars = (count: number): Bar[] =>
    Array.from({ length: count }, (_, i) => ({
        time: BASE_TIME + i * TIME_STEP,
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1000,
    }));

const swing = (
    index: number,
    price: number,
    type: SMCSwingPoint['type']
): SMCSwingPoint => ({ index, price, type });

const makeSmc = (overrides: Partial<SMCResult>): SMCResult => ({
    ...EMPTY_SMC_RESULT,
    ...overrides,
});

describe('computeTrendlineCandidates', () => {
    it('returns [] when there are no bars', () => {
        const smc = makeSmc({
            swingHighs: [swing(0, 130, 'high'), swing(5, 120, 'high')],
        });
        expect(computeTrendlineCandidates([], smc)).toEqual([]);
    });

    it('returns [] when bars exist but there are no swings', () => {
        expect(
            computeTrendlineCandidates(makeBars(11), EMPTY_SMC_RESULT)
        ).toEqual([]);
    });

    it('builds one descending resistance line from 3 collinear swing highs', () => {
        const bars = makeBars(11);
        // Collinear descending: price 130, 120, 110 at indices 0, 5, 10.
        const smc = makeSmc({
            swingHighs: [
                swing(0, 130, 'high'),
                swing(5, 120, 'high'),
                swing(10, 110, 'high'),
            ],
        });

        const result = computeTrendlineCandidates(bars, smc);

        expect(result).toHaveLength(1);
        const [line] = result;
        expect(line.direction).toBe('descending');
        // Earliest-by-time endpoint = index 0, latest = index 10.
        expect(line.start).toEqual({ time: bars[0].time, price: 130 });
        expect(line.end).toEqual({ time: bars[10].time, price: 110 });
    });

    it('builds one ascending support line from 3 collinear swing lows', () => {
        const bars = makeBars(11);
        const smc = makeSmc({
            swingLows: [
                swing(0, 90, 'low'),
                swing(5, 95, 'low'),
                swing(10, 100, 'low'),
            ],
        });

        const result = computeTrendlineCandidates(bars, smc);

        expect(result).toHaveLength(1);
        const [line] = result;
        expect(line.direction).toBe('ascending');
        expect(line.start).toEqual({ time: bars[0].time, price: 90 });
        expect(line.end).toEqual({ time: bars[10].time, price: 100 });
    });

    it('does not count an off-line swing (beyond tolerance) as a touch', () => {
        const bars = makeBars(16);
        // Three collinear highs (indices 0, 5, 10) plus one far off-line high at
        // index 15. The off-line swing must NOT raise the best line's touches.
        const smc = makeSmc({
            swingHighs: [
                swing(0, 130, 'high'),
                swing(5, 120, 'high'),
                swing(10, 110, 'high'),
                swing(15, 200, 'high'), // ~100% above the line's expected ~100
            ],
        });

        const result = computeTrendlineCandidates(bars, smc);

        // The 0/5/10 collinear line wins (it has the most touches). Because the
        // index-15 swing sits far off that line, it is NOT counted as a 4th
        // touch — proven by the winning line's endpoints being 0 and 10 (not 15)
        // and never the off-line price of 200.
        const best = result[0];
        expect(best.direction).toBe('descending');
        expect(best.start).toEqual({ time: bars[0].time, price: 130 });
        expect(best.end).toEqual({ time: bars[10].time, price: 110 });
        expect(best.start.price).not.toBe(200);
        expect(best.end.price).not.toBe(200);
    });

    it('skips swings whose index is out of bar range', () => {
        const bars = makeBars(6);
        // Only index 0 and 5 are in range; index 50 is out of range and skipped,
        // leaving exactly the two in-range swings to form one line.
        const smc = makeSmc({
            swingLows: [
                swing(0, 90, 'low'),
                swing(5, 100, 'low'),
                swing(50, 999, 'low'),
            ],
        });

        const result = computeTrendlineCandidates(bars, smc);

        expect(result).toHaveLength(1);
        expect(result[0].start).toEqual({ time: bars[0].time, price: 90 });
        expect(result[0].end).toEqual({ time: bars[5].time, price: 100 });
    });

    it('skips a negative swing index', () => {
        const bars = makeBars(6);
        const smc = makeSmc({
            swingHighs: [
                swing(-1, 999, 'high'),
                swing(0, 130, 'high'),
                swing(5, 120, 'high'),
            ],
        });

        const result = computeTrendlineCandidates(bars, smc);

        expect(result).toHaveLength(1);
        expect(result[0].start).toEqual({ time: bars[0].time, price: 130 });
        expect(result[0].end).toEqual({ time: bars[5].time, price: 120 });
    });

    it('skips swings with a non-finite or non-positive price', () => {
        const bars = makeBars(11);
        const smc = makeSmc({
            swingHighs: [
                swing(0, Number.NaN, 'high'),
                swing(2, -5, 'high'),
                swing(5, 120, 'high'),
                swing(10, 110, 'high'),
            ],
        });

        const result = computeTrendlineCandidates(bars, smc);

        // Only the two valid swings (indices 5 and 10) survive to form one line.
        expect(result).toHaveLength(1);
        expect(result[0].start).toEqual({ time: bars[5].time, price: 120 });
        expect(result[0].end).toEqual({ time: bars[10].time, price: 110 });
    });

    it('reports a flat line (equal endpoint prices) as ascending', () => {
        const bars = makeBars(11);
        const smc = makeSmc({
            swingHighs: [swing(0, 100, 'high'), swing(10, 100, 'high')],
        });

        const result = computeTrendlineCandidates(bars, smc);

        expect(result).toHaveLength(1);
        expect(result[0].direction).toBe('ascending');
    });

    it('caps the combined output at MAX_TRENDLINE_CANDIDATES (3)', () => {
        const bars = makeBars(40);
        // Two well-separated descending clusters of highs and two ascending
        // clusters of lows would otherwise yield 4 candidates (2 per side); the
        // overall cap must trim to 3.
        const smc = makeSmc({
            swingHighs: [
                swing(0, 200, 'high'),
                swing(2, 190, 'high'),
                swing(4, 180, 'high'),
                swing(20, 160, 'high'),
                swing(22, 150, 'high'),
                swing(24, 140, 'high'),
            ],
            swingLows: [
                swing(1, 50, 'low'),
                swing(3, 55, 'low'),
                swing(5, 60, 'low'),
                swing(21, 70, 'low'),
                swing(23, 75, 'low'),
                swing(25, 80, 'low'),
            ],
        });

        const result = computeTrendlineCandidates(bars, smc);

        expect(result.length).toBeLessThanOrEqual(3);
        expect(result.length).toBeGreaterThan(0);
    });

    it('skips a degenerate pair whose two swings share a bar time', () => {
        const bars = makeBars(11);
        // Two highs at the SAME index (same time) plus a third at index 10.
        // The same-time pair is degenerate and skipped; the surviving pairs still
        // form one collinear-enough line.
        const smc = makeSmc({
            swingHighs: [
                swing(0, 130, 'high'),
                swing(0, 130, 'high'),
                swing(10, 110, 'high'),
            ],
        });

        const result = computeTrendlineCandidates(bars, smc);

        expect(result).toHaveLength(1);
        expect(result[0].start).toEqual({ time: bars[0].time, price: 130 });
        expect(result[0].end).toEqual({ time: bars[10].time, price: 110 });
    });

    it('breaks rank ties by end-time recency then span', () => {
        const bars = makeBars(11);
        // Two equally-strong (2-touch) resistance lines that share the same end
        // time but different spans, exercising the end-time and span tiebreakers.
        const smc = makeSmc({
            swingHighs: [
                swing(0, 100, 'high'),
                swing(4, 100, 'high'),
                swing(8, 100, 'high'),
            ],
        });

        const result = computeTrendlineCandidates(bars, smc);

        expect(result.length).toBeGreaterThan(0);
        // Most-recent end time wins; longest span among equal-end lines wins.
        expect(result[0].end.time).toBe(bars[8].time);
        expect(result[0].start.time).toBe(bars[0].time);
    });

    it('orders endpoints by time even when swings are not sorted by index', () => {
        const bars = makeBars(11);
        // Later-index swing listed FIRST: the function must still place the
        // earlier-by-time swing as `start` and the later one as `end`.
        const smc = makeSmc({
            swingLows: [swing(10, 100, 'low'), swing(0, 90, 'low')],
        });

        const result = computeTrendlineCandidates(bars, smc);

        expect(result).toHaveLength(1);
        expect(result[0].start).toEqual({ time: bars[0].time, price: 90 });
        expect(result[0].end).toEqual({ time: bars[10].time, price: 100 });
        expect(result[0].direction).toBe('ascending');
    });

    it('does not mutate the input bars or smc', () => {
        const bars = makeBars(11);
        const smc = makeSmc({
            swingHighs: [
                swing(0, 130, 'high'),
                swing(5, 120, 'high'),
                swing(10, 110, 'high'),
            ],
        });
        const barsSnapshot = JSON.stringify(bars);
        const smcSnapshot = JSON.stringify(smc);

        computeTrendlineCandidates(bars, smc);

        expect(JSON.stringify(bars)).toBe(barsSnapshot);
        expect(JSON.stringify(smc)).toBe(smcSnapshot);
    });
});
