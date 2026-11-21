import { describe, expect, it } from 'vitest';
import type {
    Bar,
    PatternGeometry,
    PatternLine,
    QualifiedPattern,
    UndirectedPatternGeometry,
} from '@/domain/types';
import { calculateATR } from '@/domain/indicators/atr';
import {
    dayFlags,
    effectiveAtr,
    forwardOutcome,
    patternBucket,
    patternEventFor,
    repaintCounts,
    transplantLevel,
} from '../../../../scripts/replay/engineEvalPatterns';
import { EVAL_CONSTANTS } from '../../../../scripts/replay/engineEvalTypes';

const BASE = 1_500_000_000;
const DAY = 86_400;

function series(
    count: number,
    patch: Record<number, Partial<Bar>> = {}
): Bar[] {
    return Array.from({ length: count }, (_, i) => ({
        time: BASE + i * DAY,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1000,
        ...patch[i],
    }));
}

const atrOf = (
    bars: readonly Bar[],
    value: number | null = 2
): (number | null)[] => bars.map(() => value);

describe('patternBucket', () => {
    const rise = (change: number) =>
        series(40, { 39: { close: 100 + change } });

    it('reads the 20-bar close change against 2 ATR, inclusive', () => {
        expect(patternBucket(rise(4), atrOf(rise(4)), 39)).toBe('up');
        expect(patternBucket(rise(3.99), atrOf(rise(3.99)), 39)).toBe('none');
        expect(patternBucket(rise(-4), atrOf(rise(-4)), 39)).toBe('down');
        expect(patternBucket(rise(-3.99), atrOf(rise(-3.99)), 39)).toBe('none');
        expect(EVAL_CONSTANTS.patternPriorTrendBars).toBe(20);
        expect(EVAL_CONSTANTS.patternPriorTrendMinAtr).toBe(2);
    });

    it('reads from the first bar when fewer than 20 bars precede', () => {
        const bars = series(10, { 9: { close: 110 } });
        expect(patternBucket(bars, atrOf(bars), 9)).toBe('up');
    });

    it('is none without a usable ATR', () => {
        const bars = rise(20);
        expect(patternBucket(bars, atrOf(bars, null), 39)).toBe('none');
        expect(patternBucket(bars, atrOf(bars, 0), 39)).toBe('none');
        expect(patternBucket(bars, [], 39)).toBe('none');
    });
});

describe('forwardOutcome', () => {
    const bars = (patch: Record<number, Partial<Bar>>) => series(100, patch);

    it('is a hit when a bar reaches the level first, up and down', () => {
        expect(
            forwardOutcome(bars({ 10: { high: 111 } }), 0, true, 110, 90)
        ).toBe('hit');
        expect(
            forwardOutcome(bars({ 10: { low: 89 } }), 0, false, 90, 110)
        ).toBe('hit');
    });

    it('is an invalidation when a close goes beyond it first', () => {
        expect(
            forwardOutcome(
                bars({ 5: { close: 89 }, 10: { high: 111 } }),
                0,
                true,
                110,
                90
            )
        ).toBe('inval');
        expect(
            forwardOutcome(
                bars({ 5: { close: 111 }, 10: { low: 89 } }),
                0,
                false,
                90,
                110
            )
        ).toBe('inval');
    });

    it('counts a bar that does both against the pattern', () => {
        expect(
            forwardOutcome(
                bars({ 7: { high: 111, close: 89 } }),
                0,
                true,
                110,
                90
            )
        ).toBe('inval');
    });

    it('needs a close, not a wick, to invalidate', () => {
        expect(
            forwardOutcome(
                bars({ 5: { low: 80 }, 10: { high: 111 } }),
                0,
                true,
                110,
                90
            )
        ).toBe('hit');
    });

    it('is open when neither happens in the 60 bars; the last bar counts, the next does not', () => {
        expect(forwardOutcome(bars({}), 0, true, 110, 90)).toBe('open');
        expect(
            forwardOutcome(bars({ 60: { high: 111 } }), 0, true, 110, 90)
        ).toBe('hit');
        expect(
            forwardOutcome(bars({ 61: { high: 111 } }), 0, true, 110, 90)
        ).toBe('open');
        expect(EVAL_CONSTANTS.patternForwardBars).toBe(60);
    });
});

describe('transplantLevel', () => {
    it('keeps the level distance in ATR percent', () => {
        // +10% from the event close at 2% ATR, placed on a 4% ATR date at 50: +20% = 60.
        expect(transplantLevel(110, 100, 0.02, 50, 0.04)).toBeCloseTo(60, 12);
        expect(transplantLevel(100, 100, 0.02, 50, 0.04)).toBeCloseTo(50, 12);
    });
});

describe('repaintCounts', () => {
    const pivot = (kind: string, price: number) => ({ kind, price });

    it('checks nothing on the first window', () => {
        expect(repaintCounts(null, new Map(), 0)).toEqual({
            checks: 0,
            repaints: 0,
        });
    });

    it('accepts unchanged pivots, flags a missing, a re-kinded and a re-priced one', () => {
        const previous = new Map([
            [10, pivot('high', 5)],
            [20, pivot('low', 3)],
            [30, pivot('high', 7)],
            [40, pivot('low', 1)],
        ]);
        const current = new Map([
            [10, pivot('high', 5)],
            [20, pivot('high', 3)],
            [30, pivot('high', 7.5)],
        ]);
        expect(repaintCounts(previous, current, 0)).toEqual({
            checks: 4,
            repaints: 3,
        });
    });

    it('ignores previous pivots that left the lookback', () => {
        const previous = new Map([
            [10, pivot('high', 5)],
            [20, pivot('low', 3)],
        ]);
        expect(repaintCounts(previous, new Map(), 20)).toEqual({
            checks: 1,
            repaints: 1,
        });
        expect(repaintCounts(previous, new Map(), 21)).toEqual({
            checks: 0,
            repaints: 0,
        });
    });
});

// ─── dayFlags ────────────────────────────────────────────────────────────────

/** The day's flags at an ATR of 2, the scale of the flat test series. */
const flagsOf = (
    pattern: QualifiedPattern,
    geometry: PatternGeometry | UndirectedPatternGeometry,
    bars: Bar[]
) => dayFlags(pattern, geometry, bars, 2);

const line = (i0: number, p0: number, i1: number, p1: number): PatternLine => ({
    start: { index: i0, price: p0 },
    end: { index: i1, price: p1 },
    touches: [
        { index: i0, price: p0 },
        { index: i1, price: p1 },
    ],
});

const flatUpper = line(0, 105, 10, 105);
const flatLower = line(0, 95, 10, 95);
const risingUpper = line(0, 100, 10, 110); // 1 per bar: 115 at bar 15, 129 at bar 29
const fallingLower = line(0, 100, 10, 90); // -1 per bar: 85 at bar 15, 71 at bar 29

function trendline(
    upper: PatternLine,
    lower: PatternLine,
    direction: 'up' | 'down' | null
): QualifiedPattern {
    return {
        id: 'ascending_triangle',
        startIndex: 0,
        endIndex: 10,
        pivots: [],
        shape: { kind: 'trendline', upper, lower, direction },
        touches: 4,
    };
}

const directed = (
    direction: 'up' | 'down',
    o: Partial<PatternGeometry> = {}
): PatternGeometry => ({
    keyPoints: [],
    breakoutLevel: direction === 'up' ? 105 : 95,
    height: 10,
    measuredTarget: direction === 'up' ? 115 : 85,
    conservativeTarget: direction === 'up' ? 110 : 90,
    invalidationLevel: direction === 'up' ? 95 : 105,
    invalidationIndex: 0,
    direction,
    ...o,
});

const undirected = (
    upperLevel: number,
    lowerLevel: number
): UndirectedPatternGeometry => ({
    keyPoints: [],
    height: 10,
    upperLevel,
    lowerLevel,
    direction: null,
});

describe('dayFlags: directed pairs', () => {
    const noBreak = series(30);

    it('reports a quiet day as clean', () => {
        expect(
            flagsOf(
                trendline(flatUpper, flatLower, 'up'),
                directed('up'),
                noBreak
            )
        ).toEqual({
            directed: true,
            wrongSide: false,
            nonPositive: false,
            postBreak: false,
            moving: false,
            printedBroken: false,
            frozenBroken: false,
            failedDisagree: false,
        });
    });

    it('flags a breakout line that kept sliding after the break, and not one frozen at the break bar', () => {
        const bars = series(30, { 15: { close: 120 }, 29: { close: 120 } });
        const pattern = trendline(risingUpper, flatLower, 'up');
        const sliding = flagsOf(
            pattern,
            directed('up', { breakoutLevel: 129 }),
            bars
        );
        expect(sliding).toMatchObject({
            postBreak: true,
            moving: true,
            printedBroken: false,
            frozenBroken: true,
        });
        const frozen = flagsOf(
            pattern,
            directed('up', { breakoutLevel: 115 }),
            bars
        );
        expect(frozen).toMatchObject({
            postBreak: true,
            moving: false,
            printedBroken: true,
            frozenBroken: true,
        });
    });

    it('does not call a break on the last bar post-break', () => {
        const bars = series(30, { 29: { close: 130 } });
        const flags = flagsOf(
            trendline(risingUpper, flatLower, 'up'),
            directed('up', { breakoutLevel: 129 }),
            bars
        );
        expect(flags.postBreak).toBe(false);
        expect(flags.moving).toBe(false);
        expect(flags.frozenBroken).toBe(true);
    });

    it('needs a close strictly beyond the line to break', () => {
        const bars = series(30, { 15: { close: 115 } });
        const flags = flagsOf(
            trendline(risingUpper, flatLower, 'up'),
            directed('up', { breakoutLevel: 129 }),
            bars
        );
        expect(flags.postBreak).toBe(false);
        expect(flags.moving).toBe(false);
    });

    it('ignores closes at or before the pattern end', () => {
        const bars = series(30, { 10: { close: 200 } });
        expect(
            flagsOf(trendline(flatUpper, flatLower, 'up'), directed('up'), bars)
                .postBreak
        ).toBe(false);
    });

    it('mirrors for a downward breakout', () => {
        const bars = series(30, { 15: { close: 70 }, 29: { close: 75 } });
        const pattern = trendline(flatUpper, fallingLower, 'down');
        expect(
            flagsOf(
                pattern,
                directed('down', { breakoutLevel: 71, invalidationLevel: 105 }),
                bars
            )
        ).toMatchObject({
            postBreak: true,
            moving: true,
            frozenBroken: true,
            printedBroken: false,
        });
        expect(
            flagsOf(
                pattern,
                directed('down', { breakoutLevel: 85, invalidationLevel: 105 }),
                bars
            )
        ).toMatchObject({ moving: false, printedBroken: true });
    });

    it('flags a breakout on the wrong side of the invalidation, boundary included', () => {
        const pattern = trendline(flatUpper, flatLower, 'up');
        const wrong = (level: number) =>
            flagsOf(
                pattern,
                directed('up', { invalidationLevel: level }),
                noBreak
            ).wrongSide;
        expect(wrong(105)).toBe(true);
        expect(wrong(110)).toBe(true);
        expect(wrong(104.9)).toBe(false);
        const down = trendline(flatUpper, flatLower, 'down');
        const wrongDown = (level: number) =>
            flagsOf(
                down,
                directed('down', { invalidationLevel: level }),
                noBreak
            ).wrongSide;
        expect(wrongDown(95)).toBe(true);
        expect(wrongDown(90)).toBe(true);
        expect(wrongDown(95.1)).toBe(false);
    });

    it('flags any printed level or target that is not positive', () => {
        const pattern = trendline(flatUpper, flatLower, 'up');
        const flagged = (o: Partial<PatternGeometry>) =>
            flagsOf(pattern, directed('up', o), noBreak).nonPositive;
        expect(flagged({})).toBe(false);
        expect(flagged({ breakoutLevel: 0, invalidationLevel: -1 })).toBe(true);
        expect(flagged({ measuredTarget: 0 })).toBe(true);
        expect(flagged({ conservativeTarget: -1 })).toBe(true);
        expect(flagged({ measuredTarget: Number.NaN })).toBe(true);
    });
});

describe('dayFlags: undirected pairs', () => {
    const pattern = trendline(risingUpper, fallingLower, null);

    it('is quiet before any close beyond a boundary', () => {
        const flags = flagsOf(
            trendline(flatUpper, flatLower, null),
            undirected(105, 95),
            series(30)
        );
        expect(flags).toEqual({
            directed: false,
            wrongSide: false,
            nonPositive: false,
            postBreak: false,
            moving: false,
            printedBroken: false,
            frozenBroken: false,
            failedDisagree: false,
        });
    });

    it('freezes both boundaries at the first close beyond either', () => {
        const up = series(30, { 15: { close: 120 }, 29: { close: 120 } });
        const sliding = flagsOf(pattern, undirected(129, 71), up);
        expect(sliding).toMatchObject({
            postBreak: true,
            moving: true,
            frozenBroken: true,
        });
        expect(sliding.printedBroken).toBe(false);
        const frozen = flagsOf(pattern, undirected(115, 85), up);
        expect(frozen).toMatchObject({
            postBreak: true,
            moving: false,
            printedBroken: true,
        });
    });

    it('breaks below the lower boundary too, and takes the earlier of the two', () => {
        const down = series(30, { 15: { close: 80 }, 29: { close: 80 } });
        expect(flagsOf(pattern, undirected(129, 71), down)).toMatchObject({
            postBreak: true,
            moving: true,
            frozenBroken: true,
        });
        const both = series(30, {
            14: { close: 70 },
            16: { close: 130 },
            29: { close: 100 },
        });
        // Lower broke first (bar 14): frozen at bar 14, upper 114 / lower 86.
        expect(flagsOf(pattern, undirected(114, 86), both).moving).toBe(false);
        expect(flagsOf(pattern, undirected(116, 84), both).moving).toBe(true);
    });

    it('flags a non-positive boundary', () => {
        expect(
            flagsOf(
                trendline(flatUpper, flatLower, null),
                undirected(105, 0),
                series(30)
            ).nonPositive
        ).toBe(true);
        expect(
            flagsOf(
                trendline(flatUpper, flatLower, null),
                undirected(0, -1),
                series(30)
            ).nonPositive
        ).toBe(true);
    });
});

describe('dayFlags: other families', () => {
    it('reads breaks for flags from their channel lines', () => {
        const flag: QualifiedPattern = {
            id: 'bull_flag',
            startIndex: 0,
            endIndex: 10,
            pivots: [],
            shape: {
                kind: 'flag',
                direction: 'up',
                poleBase: { index: 0, price: 90, kind: 'low' },
                poleTop: { index: 5, price: 110, kind: 'high' },
                upper: risingUpper,
                lower: flatLower,
                flagExtreme: { index: 8, price: 95 },
            },
            touches: 4,
        };
        const bars = series(30, { 15: { close: 120 }, 29: { close: 120 } });
        expect(
            flagsOf(flag, directed('up', { breakoutLevel: 129 }), bars)
        ).toMatchObject({
            postBreak: true,
            moving: true,
        });
    });

    it('does not read lines for the families that have none', () => {
        const extreme: QualifiedPattern = {
            id: 'double_top',
            startIndex: 0,
            endIndex: 10,
            pivots: [],
            shape: {
                kind: 'extreme',
                neckline: { index: 5, price: 95, kind: 'low' },
            },
            touches: 3,
        };
        const flags = flagsOf(extreme, directed('down'), series(30));
        expect(flags).toMatchObject({
            postBreak: false,
            moving: false,
            printedBroken: null,
            frozenBroken: null,
            failedDisagree: null,
        });
    });
});

describe('dayFlags: failed-breakout status against the frozen level', () => {
    // The upper line rises 1 per bar (115 at bar 15). A close of 120 at bar 15 breaks it.
    const pattern = trendline(risingUpper, flatLower, 'up');

    it('catches a status that reads the sliding line: back "inside" the line only because it moved away', () => {
        const bars = series(30, { 15: { close: 120 }, 29: { close: 120 } });
        // On the sliding line the last close (120 against 129) is back inside after a break, so
        // the engine's test says failed; on the line frozen at 115 it is still beyond.
        expect(
            flagsOf(pattern, directed('up', { breakoutLevel: 115 }), bars)
                .failedDisagree
        ).toBe(true);
    });

    it('agrees when the close really returned under the frozen level', () => {
        const bars = series(30, { 15: { close: 120 }, 29: { close: 100 } });
        expect(
            flagsOf(pattern, directed('up', { breakoutLevel: 115 }), bars)
                .failedDisagree
        ).toBe(false);
    });

    it('is false before any break', () => {
        expect(
            flagsOf(pattern, directed('up'), series(30)).failedDisagree
        ).toBe(false);
    });

    it('mirrors for the lower line and checks both lines of an undirected pair', () => {
        const down = trendline(flatUpper, fallingLower, 'down');
        const bars = series(30, { 15: { close: 80 }, 29: { close: 80 } });
        expect(
            flagsOf(
                down,
                directed('down', { breakoutLevel: 85, invalidationLevel: 105 }),
                bars
            ).failedDisagree
        ).toBe(true);
        const both = trendline(risingUpper, fallingLower, null);
        expect(
            flagsOf(
                both,
                undirected(115, 85),
                series(30, { 15: { close: 80 }, 29: { close: 80 } })
            ).failedDisagree
        ).toBe(true);
        expect(
            flagsOf(
                both,
                undirected(115, 85),
                series(30, { 15: { close: 120 }, 29: { close: 120 } })
            ).failedDisagree
        ).toBe(true);
        expect(
            flagsOf(both, undirected(115, 85), series(30)).failedDisagree
        ).toBe(false);
    });
});

describe('effectiveAtr', () => {
    it('carries the last usable reading forward and lets the first one fill the warm-up', () => {
        expect(
            effectiveAtr([null, null, 2, null, Number.NaN, 0, 3, null])
        ).toEqual([2, 2, 2, 2, 2, 2, 3, 3]);
    });

    it('is all null when no reading is usable, and empty for no bars', () => {
        expect(effectiveAtr([null, 0, Number.NaN])).toEqual([null, null, null]);
        expect(effectiveAtr([])).toEqual([]);
    });
});

// ─── patternEventFor ─────────────────────────────────────────────────────────

describe('patternEventFor', () => {
    const geometry = (direction: 'up' | 'down'): PatternGeometry =>
        directed(direction, {
            breakoutLevel: direction === 'up' ? 101 : 99,
            measuredTarget: direction === 'up' ? 110 : 90,
            conservativeTarget: direction === 'up' ? 105 : 95,
            invalidationLevel: direction === 'up' ? 90 : 110,
            height: 9,
        });
    const input = (
        bars: Bar[],
        direction: 'up' | 'down' = 'up',
        startTime = BASE + 350 * DAY
    ) => ({
        symbol: 'AAA',
        market: 'us' as const,
        bars,
        atr: calculateATR(bars),
        t: 400,
        id: 'bull_flag',
        startTime,
        geometry: geometry(direction),
    });

    it('measures the event against level-transplanted placebo dates', () => {
        // Placebo dates 260..339 (80 dates, 20 drawn): bars 340..400 share the event's
        // forward window and are left out; the spike at 460 is beyond every placebo horizon.
        const bars = series(461, { 460: { high: 120 } });
        const event = patternEventFor(input(bars));
        expect(event).toMatchObject({
            kind: 'pattern',
            symbol: 'AAA',
            market: 'us',
            index: 400,
            id: 'bull_flag',
            direction: 'up',
            bucket: 'none',
            half: 'early',
            close: 100,
            breakout: 101,
            target: 110,
            conservativeTarget: 105,
            invalidation: 90,
            target60: 'hit',
            cons60: 'hit',
            placeboTargetHit: 0,
            placeboConsHit: 0,
            placeboN: EVAL_CONSTANTS.placeboCount,
        });
        expect(event?.date).toBe(
            new Date((BASE + 400 * DAY) * 1000).toISOString().slice(0, 10)
        );
        expect(event?.label20.outcome).toBe('no_breakout');
        expect(event?.label20.skipReason).toBeNull();
    });

    it('gives a placebo hit share between 0 and 1 when some dates reach the level', () => {
        // The spike at 330 is inside the horizon of many placebo dates, not of the event.
        const bars = series(461, { 330: { high: 120 } });
        const event = patternEventFor(input(bars));
        expect(event?.target60).toBe('open');
        expect(event?.placeboTargetHit).toBeGreaterThan(0);
        expect(event?.placeboTargetHit).toBeLessThan(1);
    });

    it('draws different placebo dates for an instance with a different start time', () => {
        const bars = series(461, { 330: { high: 120 } });
        const a = patternEventFor(input(bars, 'up', BASE + 350 * DAY));
        const same = patternEventFor(input(bars, 'up', BASE + 350 * DAY));
        const other = patternEventFor(input(bars, 'up', BASE + 351 * DAY));
        expect(same).toEqual(a);
        expect(other?.placeboTargetHit).not.toBe(a?.placeboTargetHit);
    });

    it('handles a downward pattern', () => {
        const bars = series(461, { 460: { low: 80 } });
        const event = patternEventFor(input(bars, 'down'));
        expect(event).toMatchObject({
            direction: 'down',
            target60: 'hit',
            placeboTargetHit: 0,
        });
    });

    it('is null when fewer than minPlacebo dates share the prior-trend bucket', () => {
        const bars = series(461, { 400: { close: 110 } });
        expect(patternEventFor(input(bars))).toBeNull();
    });
});
