import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    Bar,
    PatternGeometry,
    PatternLine,
    PivotPoint,
    QualifiedPattern,
} from '@/domain/types';
import { lineValueAt } from '@/domain/patterns/boundaryLines';
import {
    patternWalkForSymbol,
    pivotCounts,
} from '../../../../scripts/replay/engineEvalPatterns';

const mocks = vi.hoisted(() => ({
    extractPivots: vi.fn(),
    qualifyPatterns: vi.fn(),
    screenChartPatterns: vi.fn(),
    computeCandidateGeometry: vi.fn(),
}));

vi.mock('@/domain/patterns/pivots', () => ({
    extractPivots: mocks.extractPivots,
}));
vi.mock('@/domain/patterns/qualify/qualifyPatterns', () => ({
    qualifyPatterns: mocks.qualifyPatterns,
}));
vi.mock('@/domain/patterns/screenChartPatterns', () => ({
    screenChartPatterns: mocks.screenChartPatterns,
}));
vi.mock('@/domain/patterns/patternGeometry', () => ({
    computeCandidateGeometry: mocks.computeCandidateGeometry,
}));

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

const pivot = (
    index: number,
    kind: 'high' | 'low',
    price = 100
): PivotPoint => ({
    index,
    kind,
    price,
});

describe('pivotCounts', () => {
    // Full series: four pivots. Prefixes ending at a pivot bar list that pivot only when it
    // is confirmed by its own bar (index 10, 25 and 30 here; 20 needs a later bar).
    const plan = new Map<number, PivotPoint[]>([
        [
            40,
            [
                pivot(10, 'high'),
                pivot(20, 'low'),
                pivot(25, 'low'),
                pivot(30, 'high'),
            ],
        ],
        [11, [pivot(10, 'high')]],
        [21, []],
        [26, [pivot(25, 'low')]],
        [31, [pivot(30, 'high')]],
    ]);
    const bars = series(40, {
        10: { high: 110 }, // close 100: 10 above, proves a 3-ATR-wide reversal
        25: { low: 90 }, // close 100: 10 below
        30: { high: 101 }, // close 100: only 1 above
    });

    beforeEach(() => {
        mocks.extractPivots.mockReset();
        mocks.extractPivots.mockImplementation(
            (b: Bar[]) => plan.get(b.length) ?? []
        );
    });

    it('counts pivots, the ones their own bar confirms, and those the close does not prove', () => {
        expect(
            pivotCounts(
                bars,
                bars.map(() => 2)
            )
        ).toEqual({
            pivots: 4,
            selfConfirmed: 3,
            selfNotCloseProven: 1,
        });
    });

    it("measures against the engine's effective ATR: a hole carries the last reading forward", () => {
        const atr = bars.map((_, i) => (i === 10 ? null : 2));
        expect(pivotCounts(bars, atr).selfNotCloseProven).toBe(1);
        const warmup = bars.map((_, i) => (i <= 10 ? null : 2));
        expect(pivotCounts(bars, warmup).selfNotCloseProven).toBe(1);
    });

    it('cannot prove a pivot at all when no ATR reading is usable', () => {
        const none = pivotCounts(
            bars,
            bars.map(() => null)
        );
        expect(none.selfConfirmed).toBe(3);
        expect(none.selfNotCloseProven).toBe(3);
    });

    it('needs the full reversal threshold, inclusive', () => {
        const exact = series(40, { 30: { high: 103 } }); // 3 = 1.5 x 2
        expect(
            pivotCounts(
                exact,
                exact.map(() => 2)
            ).selfNotCloseProven
        ).toBe(2);
        const just = series(40, { 30: { high: 102.99 } });
        expect(
            pivotCounts(
                just,
                just.map(() => 2)
            ).selfNotCloseProven
        ).toBe(3);
    });
});

describe('patternWalkForSymbol', () => {
    const upper = (offset: number): PatternLine => ({
        start: { index: 460 - offset, price: 100 },
        end: { index: 470 - offset, price: 110 },
        touches: [
            { index: 460 - offset, price: 100 },
            { index: 470 - offset, price: 110 },
        ],
    });
    const lower = (offset: number): PatternLine => ({
        start: { index: 460 - offset, price: 95 },
        end: { index: 470 - offset, price: 95 },
        touches: [
            { index: 460 - offset, price: 95 },
            { index: 470 - offset, price: 95 },
        ],
    });
    const offsetOf = (window: Bar[]): number => (window[0].time - BASE) / DAY;

    const pivotMode = { value: 'stable' as 'stable' | 'moving' };

    beforeEach(() => {
        pivotMode.value = 'stable';
        Object.values(mocks).forEach(fn => fn.mockReset());
        mocks.screenChartPatterns.mockReturnValue([]);
        mocks.extractPivots.mockImplementation((window: Bar[]) => {
            if (window.length !== 500) return [];
            const offset = offsetOf(window);
            return [
                pivot(
                    480 - offset,
                    'high',
                    pivotMode.value === 'stable'
                        ? 100
                        : window[window.length - 1].close
                ),
            ];
        });
        mocks.qualifyPatterns.mockImplementation(
            (_c: unknown, window: Bar[]) => {
                const offset = offsetOf(window);
                const pattern: QualifiedPattern = {
                    id: 'ascending_triangle',
                    startIndex: 450 - offset,
                    endIndex: 470 - offset,
                    pivots: [],
                    shape: {
                        kind: 'trendline',
                        upper: upper(offset),
                        lower: lower(offset),
                        direction: 'up',
                        breakoutIndex: window.length - 1,
                    },
                    touches: 4,
                };
                return {
                    qualified: [pattern],
                    shapeHints: [],
                    arbitrationDropped: [],
                };
            }
        );
        // The sliding reading: the upper line at the last bar (the pre-freeze behaviour).
        mocks.computeCandidateGeometry.mockImplementation(
            (
                pattern: QualifiedPattern,
                window: Bar[]
            ): PatternGeometry | null => {
                if (pattern.shape.kind !== 'trendline') return null;
                const level = lineValueAt(
                    pattern.shape.upper,
                    window.length - 1
                );
                return {
                    keyPoints: [],
                    breakoutLevel: level,
                    height: 10,
                    measuredTarget: level + 10,
                    conservativeTarget: level + 5,
                    invalidationLevel: 90,
                    invalidationIndex: 0,
                    direction: 'up',
                };
            }
        );
    });

    // Flat 100 until bar 480, then a close at 135 (the upper line is 120 at bar 480).
    const bars = series(570, {
        ...Object.fromEntries(
            Array.from({ length: 90 }, (_, i): [number, Partial<Bar>] => [
                480 + i,
                { close: 135, high: 136 },
            ])
        ),
        510: { close: 160, high: 161 },
        511: { close: 135, high: 136 },
        514: { close: 160, high: 161 },
        515: { close: 110, high: 126 },
    });

    it('counts the G1 days of a line that keeps sliding after the break', () => {
        const { counters } = patternWalkForSymbol('AAA', 'us', bars);
        expect(counters).toMatchObject({
            days: 70,
            candidateDays: 70,
            directedDays: 70,
            postBreakDays: 70,
            movingPostBreakDays: 70,
            statusPairs: 69,
            statusFlips: 4,
            unexplainedStatusFlips: 3,
            // 70 days minus the two where the sliding and the frozen reading agree: bar 510
            // (close 160, beyond both lines) and bar 515 (close 110, back under both).
            failedBreakoutDisagreeDays: 68,
            instances: 1,
            'candidateDays:ascending_triangle': 70,
            'instances:ascending_triangle': 1,
            pivots: 0,
            selfConfirmedPivots: 0,
            selfConfirmedNotCloseProvenPivots: 0,
        });
        expect(counters.wrongSideDays).toBeUndefined();
        expect(counters.nonPositiveDays).toBeUndefined();
    });

    it('turns the first appearance of a directed instance into one event with a placebo', () => {
        const { events } = patternWalkForSymbol('AAA', 'us', bars);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            kind: 'pattern',
            id: 'ascending_triangle',
            index: 500,
            direction: 'up',
            bucket: 'none',
            // Upper line at bar 500 is 140; target 150 is reached by bar 510's high of 161.
            breakout: 140,
            target: 150,
            target60: 'hit',
            placeboN: 20,
        });
    });

    it('reports a stable pivot as unrepainted and a moving one on each day its price changed', () => {
        const stable = patternWalkForSymbol('AAA', 'us', bars).counters;
        expect(stable.pivotRepaintChecks).toBe(69);
        expect(stable.pivotRepaints).toBe(0);
        pivotMode.value = 'moving';
        const moving = patternWalkForSymbol('AAA', 'us', bars).counters;
        expect(moving.pivotRepaintChecks).toBe(69);
        // The pivot price is the window's last close: it changes at 510, 511, 514, 515, 516.
        expect(moving.pivotRepaints).toBe(5);
    });

    it('counts an instance whose forward window is missing, and one with too few placebo dates', () => {
        const short = patternWalkForSymbol('AAA', 'us', bars.slice(0, 540));
        expect(short.events).toEqual([]);
        expect(short.counters.noForwardWindow).toBe(1);
        // The event day alone sits 20 bars above its predecessor: no placebo date shares its bucket.
        const lone = patternWalkForSymbol(
            'AAA',
            'us',
            series(570, { 500: { close: 110 } })
        );
        expect(lone.events).toEqual([]);
        expect(lone.counters.noPlacebo).toBe(1);
    });

    it('skips a pattern whose geometry is null and a day with no usable ATR', () => {
        mocks.computeCandidateGeometry.mockReturnValue(null);
        const nullGeometry = patternWalkForSymbol('AAA', 'us', bars).counters;
        expect(nullGeometry.days).toBe(70);
        expect(nullGeometry.candidateDays).toBeUndefined();
        const dead = series(570).map(b => ({ ...b, high: 100, low: 100 }));
        const deadCounters = patternWalkForSymbol('AAA', 'us', dead).counters;
        expect(deadCounters.days).toBeUndefined();
        expect(deadCounters.candidateDays).toBeUndefined();
    });

    it('handles a series shorter than one window', () => {
        expect(patternWalkForSymbol('AAA', 'us', series(300))).toEqual({
            events: [],
            counters: {
                pivots: 0,
                selfConfirmedPivots: 0,
                selfConfirmedNotCloseProvenPivots: 0,
            },
        });
    });
});
