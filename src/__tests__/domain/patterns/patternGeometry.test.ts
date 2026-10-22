import { describe, expect, it } from 'vitest';
import { computeCandidateGeometry } from '@/domain/patterns/patternGeometry';
import { makeBars } from '@/__tests__/domain/patterns/helpers';
import type {
    PatternGeometry,
    PatternLine,
    PatternPoint,
    PivotPoint,
    QualifiedPattern,
    QualifiedPatternGeometry,
} from '@/domain/types';

/**
 * Geometry is pure arithmetic over a qualified pattern's fixed shape, so these cases hand-build the shapes with round numbers
 * and check each family's levels against the textbook definitions. The
 * qualifier itself (which shapes exist) is covered by qualify.test.ts and
 * the scenario suite.
 */
const ATR = 1;
const BARS = makeBars(Array.from({ length: 10 }, () => 100));

const hi = (index: number, price: number): PivotPoint => ({
    index,
    price,
    kind: 'high',
});
const lo = (index: number, price: number): PivotPoint => ({
    index,
    price,
    kind: 'low',
});
const line = (
    start: PatternPoint,
    end: PatternPoint,
    touches: readonly PatternPoint[] = [start, end]
): PatternLine => ({ start, end, touches });

const directed = (g: QualifiedPatternGeometry | null): PatternGeometry => {
    if (g === null || g.direction === null)
        throw new Error('expected directed geometry');
    return g;
};

const doubleTop: QualifiedPattern = {
    id: 'double_top',
    startIndex: 1,
    endIndex: 3,
    pivots: [hi(1, 15), lo(2, 11), hi(3, 15.2)],
    shape: { kind: 'extreme', neckline: lo(2, 11) },
    touches: 2,
};

describe('computeCandidateGeometry', () => {
    describe('dispatcher guards', () => {
        it('returns null when atr is non-positive or not a number', () => {
            expect(computeCandidateGeometry(doubleTop, BARS, 0)).toBeNull();
            expect(computeCandidateGeometry(doubleTop, BARS, -1)).toBeNull();
            expect(
                computeCandidateGeometry(doubleTop, BARS, Number.NaN)
            ).toBeNull();
        });

        it('returns null when endIndex is out of bounds', () => {
            expect(
                computeCandidateGeometry(
                    { ...doubleTop, endIndex: 99 },
                    BARS,
                    ATR
                )
            ).toBeNull();
        });

        it('returns null when startIndex is negative', () => {
            expect(
                computeCandidateGeometry(
                    { ...doubleTop, startIndex: -1 },
                    BARS,
                    ATR
                )
            ).toBeNull();
        });

        it('returns null when startIndex > endIndex', () => {
            expect(
                computeCandidateGeometry(
                    { ...doubleTop, startIndex: 3, endIndex: 1 },
                    BARS,
                    ATR
                )
            ).toBeNull();
        });
    });

    describe('double/triple', () => {
        it('double top: neckline breakout, height = peak average − neckline, invalidation = the highest peak at its own bar', () => {
            const g = directed(computeCandidateGeometry(doubleTop, BARS, ATR));
            expect(g.direction).toBe('down');
            expect(g.breakoutLevel).toBe(11);
            expect(g.height).toBeCloseTo(4.1, 10);
            expect(g.measuredTarget).toBeCloseTo(6.9, 10);
            expect(g.conservativeTarget).toBeCloseTo(8.95, 10);
            expect(g.invalidationLevel).toBe(15.2);
            expect(g.invalidationIndex).toBe(3);
            expect(g.keyPoints.map(p => p.label)).toEqual([
                'peak 1',
                'peak 2',
                'neckline',
            ]);
        });

        it('triple bottom (mirrored): breaks up, invalidation = the lowest trough', () => {
            const g = directed(
                computeCandidateGeometry(
                    {
                        id: 'triple_bottom',
                        startIndex: 1,
                        endIndex: 5,
                        pivots: [
                            lo(1, 10),
                            hi(2, 14),
                            lo(3, 9.8),
                            hi(4, 13),
                            lo(5, 10.2),
                        ],
                        shape: { kind: 'extreme', neckline: hi(2, 14) },
                        touches: 3,
                    },
                    BARS,
                    ATR
                )
            );
            expect(g.direction).toBe('up');
            expect(g.breakoutLevel).toBe(14);
            expect(g.height).toBeCloseTo(4, 10);
            expect(g.measuredTarget).toBeCloseTo(18, 10);
            expect(g.invalidationLevel).toBe(9.8);
            expect(g.invalidationIndex).toBe(3);
        });
    });

    describe('head & shoulders: every number reads the SLOPED neckline', () => {
        // Neckline through (2,10) and (4,12) rises 1 per bar; head 20 at bar 3.
        const neckline = line({ index: 2, price: 10 }, { index: 4, price: 12 });
        const hs: QualifiedPattern = {
            id: 'head_and_shoulders',
            startIndex: 1,
            endIndex: 5,
            pivots: [hi(1, 16), lo(2, 10), hi(3, 20), lo(4, 12), hi(5, 16.5)],
            shape: { kind: 'head_and_shoulders', neckline, breakoutIndex: 7 },
            touches: 5,
        };

        it('breakout = neckline at the breakout bar, height = head − neckline at the head, invalidation = right shoulder', () => {
            const g = directed(computeCandidateGeometry(hs, BARS, ATR));
            expect(g.direction).toBe('down');
            expect(g.breakoutLevel).toBe(15); // 10 + (7 − 2)
            expect(g.height).toBe(9); // 20 − 11 (neckline at bar 3)
            expect(g.measuredTarget).toBe(6);
            expect(g.conservativeTarget).toBe(10.5);
            expect(g.invalidationLevel).toBe(16.5);
            expect(g.invalidationIndex).toBe(5);
            expect(g.keyPoints.find(p => p.label === 'neckline')).toEqual({
                label: 'neckline',
                price: 15,
                index: 7,
                time: BARS[7].time,
            });
        });

        it('inverse: breaks up from the neckline', () => {
            const g = directed(
                computeCandidateGeometry(
                    {
                        ...hs,
                        id: 'inverse_head_and_shoulders',
                        pivots: [
                            lo(1, 14),
                            hi(2, 20),
                            lo(3, 10),
                            hi(4, 20),
                            lo(5, 14.5),
                        ],
                        shape: {
                            kind: 'head_and_shoulders',
                            neckline: line(
                                { index: 2, price: 20 },
                                { index: 4, price: 20 }
                            ),
                            breakoutIndex: 6,
                        },
                    },
                    BARS,
                    ATR
                )
            );
            expect(g.direction).toBe('up');
            expect(g.breakoutLevel).toBe(20);
            expect(g.height).toBe(10);
            expect(g.measuredTarget).toBe(30);
        });
    });

    describe('boundary pairs', () => {
        // Resistance flat at 20 (touches 1, 5), support rising 1/bar through
        // (2,10) and (6,14). Last bar is 9.
        const upper = line({ index: 1, price: 20 }, { index: 5, price: 20 });
        const lower = line({ index: 2, price: 10 }, { index: 6, price: 14 });
        const triangle: QualifiedPattern = {
            id: 'ascending_triangle',
            startIndex: 1,
            endIndex: 6,
            pivots: [],
            shape: { kind: 'trendline', upper, lower, direction: 'up' },
            touches: 4,
        };

        it('breakout = breakout-side line at the last bar; invalidation = the opposite line’s last touch; height = width at the first touch', () => {
            const g = directed(computeCandidateGeometry(triangle, BARS, ATR));
            expect(g.breakoutLevel).toBe(20);
            expect(g.invalidationLevel).toBe(14);
            expect(g.invalidationIndex).toBe(6);
            expect(g.height).toBe(11); // 20 − 9 (support at bar 1)
            expect(g.measuredTarget).toBe(31);
            expect(g.keyPoints.map(p => p.label)).toEqual([
                'resistance touch 1',
                'resistance touch 2',
                'support touch 1',
                'support touch 2',
            ]);
        });

        it('down direction breaks the lower line and is invalidated at the last upper touch', () => {
            const g = directed(
                computeCandidateGeometry(
                    {
                        ...triangle,
                        id: 'ascending_wedge',
                        shape: {
                            kind: 'trendline',
                            upper,
                            lower,
                            direction: 'down',
                        },
                    },
                    makeBars(Array.from({ length: 8 }, () => 100)),
                    ATR
                )
            );
            expect(g.breakoutLevel).toBe(15); // support at bar 7
            expect(g.invalidationLevel).toBe(20);
            expect(g.invalidationIndex).toBe(5);
            expect(g.measuredTarget).toBe(4);
        });

        it('broadening formation: height is the width at the LAST touch', () => {
            const g = directed(
                computeCandidateGeometry(
                    {
                        id: 'broadening_formation',
                        startIndex: 1,
                        endIndex: 6,
                        pivots: [],
                        shape: {
                            kind: 'trendline',
                            upper: line(
                                { index: 1, price: 20 },
                                { index: 5, price: 24 }
                            ),
                            lower: line(
                                { index: 2, price: 10 },
                                { index: 6, price: 6 }
                            ),
                            direction: 'up',
                        },
                        touches: 4,
                    },
                    BARS,
                    ATR
                )
            );
            expect(g.height).toBe(19); // 25 − 6 at bar 6
        });

        it('no prior trend: both boundaries at the last bar, no direction, no target', () => {
            const g = computeCandidateGeometry(
                {
                    ...triangle,
                    id: 'rectangle',
                    shape: {
                        kind: 'trendline',
                        upper,
                        lower: line(
                            { index: 2, price: 10 },
                            { index: 6, price: 10 }
                        ),
                        direction: null,
                    },
                },
                BARS,
                ATR
            );
            expect(g).toEqual({
                keyPoints: expect.any(Array),
                height: 10,
                upperLevel: 20,
                lowerLevel: 10,
                direction: null,
            });
        });

        it('returns null once the boundaries have crossed by the last bar (past the apex)', () => {
            const g = computeCandidateGeometry(
                {
                    ...triangle,
                    id: 'symmetrical_triangle',
                    shape: {
                        kind: 'trendline',
                        upper: line(
                            { index: 1, price: 20 },
                            { index: 3, price: 18 }
                        ),
                        lower,
                        direction: 'up',
                    },
                },
                BARS,
                ATR
            );
            expect(g).toBeNull();
        });
    });

    describe('flags and high tight flag', () => {
        it('bull flag: breakout = upper channel at the last bar, height = pole, invalidation = flag low', () => {
            const g = directed(
                computeCandidateGeometry(
                    {
                        id: 'bull_flag',
                        startIndex: 0,
                        endIndex: 8,
                        pivots: [lo(0, 80), hi(3, 100)],
                        shape: {
                            kind: 'flag',
                            direction: 'up',
                            poleBase: lo(0, 80),
                            poleTop: hi(3, 100),
                            upper: line(
                                { index: 4, price: 99 },
                                { index: 8, price: 97 }
                            ),
                            lower: line(
                                { index: 5, price: 96 },
                                { index: 7, price: 95 }
                            ),
                            flagExtreme: { index: 7, price: 95 },
                        },
                        touches: 4,
                    },
                    BARS,
                    ATR
                )
            );
            expect(g.direction).toBe('up');
            expect(g.breakoutLevel).toBe(96.5); // upper at bar 9
            expect(g.height).toBe(20);
            expect(g.measuredTarget).toBe(116.5);
            expect(g.invalidationLevel).toBe(95);
            expect(g.invalidationIndex).toBe(7);
            expect(g.keyPoints.map(p => p.label)).toEqual([
                'flagpole base',
                'flagpole top',
                'flag upper channel',
                'flag lower channel',
            ]);
        });

        it('bear flag: breaks the lower channel, labels the pole end "flagpole bottom"', () => {
            const g = directed(
                computeCandidateGeometry(
                    {
                        id: 'bear_flag',
                        startIndex: 0,
                        endIndex: 8,
                        pivots: [hi(0, 100), lo(3, 80)],
                        shape: {
                            kind: 'flag',
                            direction: 'down',
                            poleBase: hi(0, 100),
                            poleTop: lo(3, 80),
                            upper: line(
                                { index: 5, price: 85 },
                                { index: 7, price: 86 }
                            ),
                            lower: line(
                                { index: 4, price: 81 },
                                { index: 8, price: 83 }
                            ),
                            flagExtreme: { index: 7, price: 86 },
                        },
                        touches: 4,
                    },
                    BARS,
                    ATR
                )
            );
            expect(g.direction).toBe('down');
            expect(g.breakoutLevel).toBe(83.5);
            expect(g.measuredTarget).toBe(63.5);
            expect(g.invalidationLevel).toBe(86);
            expect(g.keyPoints[1].label).toBe('flagpole bottom');
        });

        it('high tight flag: breakout at the pole top, height = pole, invalidation = flag low', () => {
            const g = directed(
                computeCandidateGeometry(
                    {
                        id: 'high_tight_flag',
                        startIndex: 0,
                        endIndex: 9,
                        pivots: [lo(0, 100), hi(5, 200)],
                        shape: {
                            kind: 'high_tight_flag',
                            poleBase: lo(0, 100),
                            poleTop: hi(5, 200),
                            flagLow: { index: 7, price: 170 },
                        },
                        touches: 2,
                    },
                    BARS,
                    ATR
                )
            );
            expect(g.breakoutLevel).toBe(200);
            expect(g.height).toBe(100);
            expect(g.measuredTarget).toBe(300);
            expect(g.conservativeTarget).toBe(250);
            expect(g.invalidationLevel).toBe(170);
        });

        it('returns null when the measured height is not positive', () => {
            expect(
                computeCandidateGeometry(
                    {
                        id: 'high_tight_flag',
                        startIndex: 0,
                        endIndex: 9,
                        pivots: [],
                        shape: {
                            kind: 'high_tight_flag',
                            poleBase: lo(0, 200),
                            poleTop: hi(5, 200),
                            flagLow: { index: 7, price: 170 },
                        },
                        touches: 2,
                    },
                    BARS,
                    ATR
                )
            ).toBeNull();
        });
    });

    describe('cup & handle and rounding', () => {
        it('cup & handle: breakout = right rim, height = right rim − bottom, invalidation = handle low', () => {
            const g = directed(
                computeCandidateGeometry(
                    {
                        id: 'cup_and_handle',
                        startIndex: 0,
                        endIndex: 8,
                        pivots: [],
                        shape: {
                            kind: 'cup',
                            leftRim: hi(0, 121),
                            rightRim: hi(6, 120),
                            bottom: { index: 3, price: 100 },
                            handleLow: { index: 8, price: 114 },
                        },
                        touches: 4,
                    },
                    BARS,
                    ATR
                )
            );
            expect(g.breakoutLevel).toBe(120);
            expect(g.height).toBe(20);
            expect(g.measuredTarget).toBe(140);
            expect(g.invalidationLevel).toBe(114);
            expect(g.invalidationIndex).toBe(8);
            expect(g.keyPoints.map(p => p.label)).toEqual([
                'left rim',
                'bottom',
                'right rim',
                'handle low',
            ]);
        });

        it('rounding bottom: breakout at the higher rim, invalidation at the right-side swing', () => {
            const g = directed(
                computeCandidateGeometry(
                    {
                        id: 'rounding_bottom',
                        startIndex: 0,
                        endIndex: 8,
                        pivots: [],
                        shape: {
                            kind: 'rounding',
                            leftRim: hi(0, 119),
                            rightRim: hi(8, 120),
                            extreme: { index: 4, price: 100 },
                            invalidation: { index: 6, price: 108 },
                            arc: [],
                        },
                        touches: 2,
                    },
                    BARS,
                    ATR
                )
            );
            expect(g.direction).toBe('up');
            expect(g.breakoutLevel).toBe(120);
            expect(g.height).toBe(20);
            expect(g.invalidationLevel).toBe(108);
            expect(g.keyPoints[1].label).toBe('bottom');
        });

        it('rounding top: breakout at the lower rim, direction down', () => {
            const g = directed(
                computeCandidateGeometry(
                    {
                        id: 'rounding_top',
                        startIndex: 0,
                        endIndex: 8,
                        pivots: [],
                        shape: {
                            kind: 'rounding',
                            leftRim: lo(0, 81),
                            rightRim: lo(8, 80),
                            extreme: { index: 4, price: 100 },
                            invalidation: { index: 6, price: 92 },
                            arc: [],
                        },
                        touches: 2,
                    },
                    BARS,
                    ATR
                )
            );
            expect(g.direction).toBe('down');
            expect(g.breakoutLevel).toBe(80);
            expect(g.height).toBe(20);
            expect(g.measuredTarget).toBe(60);
            expect(g.keyPoints[1].label).toBe('top');
        });
    });
});
