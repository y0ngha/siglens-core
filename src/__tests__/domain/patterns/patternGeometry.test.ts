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
            shape: {
                kind: 'trendline',
                upper,
                lower,
                direction: 'up',
                breakoutIndex: 9,
            },
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
                            breakoutIndex: 7,
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
                            breakoutIndex: 9,
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
                        breakoutIndex: 9,
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

        it('returns null once the boundaries have crossed by the break bar (here the last bar, past the apex)', () => {
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
                        breakoutIndex: 9,
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
                            breakoutIndex: 9,
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
                            breakoutIndex: 9,
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

describe('computeCandidateGeometry — a sloped breakout line is read at breakoutIndex', () => {
    // Both lines rise 1 per bar: upper 19 + i (touches at bars 1 and 5), lower
    // 8 + i (bars 2 and 6). The last bar is 9; the break was read at `at`.
    const upper = line({ index: 1, price: 20 }, { index: 5, price: 24 });
    const lower = line({ index: 2, price: 10 }, { index: 6, price: 14 });
    const pair = (
        direction: 'up' | 'down' | null,
        breakoutIndex: number
    ): QualifiedPattern => ({
        id: 'symmetrical_triangle',
        startIndex: 1,
        endIndex: 6,
        pivots: [],
        shape: { kind: 'trendline', upper, lower, direction, breakoutIndex },
        touches: 4,
    });

    it('directed up: the upper line at the break bar, not at the last bar', () => {
        const g = directed(computeCandidateGeometry(pair('up', 7), BARS, ATR));
        expect(g.breakoutLevel).toBe(26);
        expect(g.measuredTarget).toBe(37);
        expect(
            directed(computeCandidateGeometry(pair('up', 9), BARS, ATR))
                .breakoutLevel
        ).toBe(28);
    });

    it('directed down: the lower line at the break bar', () => {
        const g = directed(
            computeCandidateGeometry(pair('down', 7), BARS, ATR)
        );
        expect(g.breakoutLevel).toBe(15);
        expect(g.invalidationLevel).toBe(24);
        expect(g.measuredTarget).toBe(4);
    });

    it('undirected: both boundaries at the break bar', () => {
        expect(computeCandidateGeometry(pair(null, 7), BARS, ATR)).toEqual({
            keyPoints: expect.any(Array),
            height: 11,
            upperLevel: 26,
            lowerLevel: 15,
            direction: null,
        });
    });

    it('a flag: the breakout channel line at the break bar', () => {
        const flag = (breakoutIndex: number): QualifiedPattern => ({
            id: 'bull_flag',
            startIndex: 0,
            endIndex: 8,
            pivots: [lo(0, 80), hi(3, 100)],
            shape: {
                kind: 'flag',
                direction: 'up',
                poleBase: lo(0, 80),
                poleTop: hi(3, 100),
                upper: line({ index: 4, price: 99 }, { index: 8, price: 97 }),
                lower: line({ index: 5, price: 96 }, { index: 7, price: 95 }),
                flagExtreme: { index: 7, price: 95 },
                breakoutIndex,
            },
            touches: 4,
        });
        expect(
            directed(computeCandidateGeometry(flag(8), BARS, ATR)).breakoutLevel
        ).toBe(97);
        expect(
            directed(computeCandidateGeometry(flag(9), BARS, ATR)).breakoutLevel
        ).toBe(96.5);
    });

    describe('a pair broken before its apex keeps its geometry', () => {
        // Upper 21 − i falling through (1,20) and (3,18); lower 7 + i rising
        // through (2,9) and (6,13): they meet at bar 7 (14 = 14).
        const crossing = (breakoutIndex: number): QualifiedPattern => ({
            ...pair('up', breakoutIndex),
            shape: {
                kind: 'trendline',
                upper: line({ index: 1, price: 20 }, { index: 3, price: 18 }),
                lower: line({ index: 2, price: 9 }, { index: 6, price: 13 }),
                direction: 'up',
                breakoutIndex,
            },
        });

        it('broke at bar 6, where the upper line (15) is still over the lower (13)', () => {
            const g = directed(
                computeCandidateGeometry(crossing(6), BARS, ATR)
            );
            expect(g.breakoutLevel).toBe(15);
            expect(g.invalidationLevel).toBe(13);
        });

        it('has nothing left to break out of once the lines meet (bar 7) or cross (bar 9)', () => {
            expect(computeCandidateGeometry(crossing(7), BARS, ATR)).toBeNull();
            expect(computeCandidateGeometry(crossing(9), BARS, ATR)).toBeNull();
        });
    });
});

describe('computeCandidateGeometry — guards for a measured move that is not offered', () => {
    const cup = (rim: number, handleLow: number): QualifiedPattern => ({
        id: 'cup_and_handle',
        startIndex: 0,
        endIndex: 8,
        pivots: [],
        shape: {
            kind: 'cup',
            leftRim: hi(0, rim + 1),
            rightRim: hi(6, rim),
            bottom: { index: 3, price: rim - 20 },
            handleLow: { index: 8, price: handleLow },
        },
        touches: 4,
    });
    const topWith = (peak: number, neck: number): QualifiedPattern => ({
        id: 'double_top',
        startIndex: 1,
        endIndex: 3,
        pivots: [hi(1, peak), lo(2, neck), hi(3, peak)],
        shape: { kind: 'extreme', neckline: lo(2, neck) },
        touches: 2,
    });
    const offered = (p: QualifiedPattern): boolean =>
        computeCandidateGeometry(p, BARS, ATR) !== null;

    it('a breakout at or below zero is not offered (an up pattern whose target is positive)', () => {
        // Rim 0 → target 20 > 0, invalidation −30 below it: only the breakout guard fires.
        expect(offered(cup(0, -30))).toBe(false);
        expect(offered(cup(-1, -30))).toBe(false);
        expect(offered(cup(0.01, -30))).toBe(true);
    });

    it('a measured target at or below zero is not offered (down)', () => {
        // Peaks 20 stand 10 over the neckline 10: target exactly 0.
        expect(offered(topWith(20, 10))).toBe(false);
        expect(offered(topWith(25, 10))).toBe(false);
        expect(offered(topWith(19.9, 10))).toBe(true);
    });

    it('an up breakout at or below its invalidation is not offered', () => {
        expect(offered(cup(120, 120))).toBe(false);
        expect(offered(cup(120, 125))).toBe(false);
        expect(offered(cup(120, 119.99))).toBe(true);
    });

    it('a down breakout at or above its invalidation is not offered', () => {
        // Peaks 15 and 15.2 (the invalidation is the higher one).
        const base = topWith(15, 11);
        const wide = (neck: number): QualifiedPattern => ({
            ...base,
            pivots: [hi(1, 15), lo(2, neck), hi(3, 15.2)],
            shape: { kind: 'extreme', neckline: lo(2, neck) },
        });
        expect(offered(wide(15.2))).toBe(false);
        expect(offered(wide(16))).toBe(false);
        expect(offered(wide(15.19))).toBe(true);
    });

    describe('wrong side of the invalidation, per remaining family', () => {
        const rounding = (
            id: 'rounding_bottom' | 'rounding_top',
            invalidation: number
        ): QualifiedPattern => {
            const bottom = id === 'rounding_bottom';
            const rim = bottom ? hi : lo;
            return {
                id,
                startIndex: 0,
                endIndex: 7,
                pivots: [],
                shape: {
                    kind: 'rounding',
                    leftRim: rim(0, bottom ? 119 : 81),
                    rightRim: rim(6, bottom ? 120 : 80),
                    extreme: { index: 3, price: 100 },
                    invalidation: { index: 7, price: invalidation },
                    arc: [],
                },
                touches: 3,
            };
        };
        const highTightFlag = (flagLow: number): QualifiedPattern => ({
            id: 'high_tight_flag',
            startIndex: 0,
            endIndex: 9,
            pivots: [],
            shape: {
                kind: 'high_tight_flag',
                poleBase: lo(0, 100),
                poleTop: hi(5, 200),
                flagLow: { index: 7, price: flagLow },
            },
            touches: 2,
        });

        it('rounding bottom: an invalidation at or above the lip is not offered, one under it is', () => {
            expect(offered(rounding('rounding_bottom', 120))).toBe(false);
            expect(offered(rounding('rounding_bottom', 125))).toBe(false);
            expect(offered(rounding('rounding_bottom', 119.9))).toBe(true);
        });

        it('rounding top: an invalidation at or under the lip is not offered, one over it is', () => {
            expect(offered(rounding('rounding_top', 80))).toBe(false);
            expect(offered(rounding('rounding_top', 75))).toBe(false);
            expect(offered(rounding('rounding_top', 80.1))).toBe(true);
        });

        it('high tight flag: a flag low at or above the pole top is not offered, one under it is', () => {
            expect(offered(highTightFlag(200))).toBe(false);
            expect(offered(highTightFlag(210))).toBe(false);
            expect(offered(highTightFlag(199.99))).toBe(true);
        });
    });

    describe('undirected', () => {
        const rectangle = (lowerPrice: number): QualifiedPattern => ({
            id: 'rectangle',
            startIndex: 1,
            endIndex: 6,
            pivots: [],
            shape: {
                kind: 'trendline',
                upper: line({ index: 1, price: 20 }, { index: 5, price: 20 }),
                lower: line(
                    { index: 2, price: lowerPrice },
                    { index: 6, price: lowerPrice }
                ),
                direction: null,
                breakoutIndex: 9,
            },
            touches: 4,
        });

        it('a lower boundary at or below zero is not offered', () => {
            expect(offered(rectangle(0))).toBe(false);
            expect(offered(rectangle(-5))).toBe(false);
            expect(offered(rectangle(0.01))).toBe(true);
        });
    });
});
