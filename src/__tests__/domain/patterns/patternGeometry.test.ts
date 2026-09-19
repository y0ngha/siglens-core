import { describe, expect, it } from 'vitest';
import { computeCandidateGeometry } from '@/domain/patterns/patternGeometry';
import {
    classifyCurvaturePatterns,
    classifyDoubleTripleBottom,
    classifyDoubleTripleTop,
    classifyHeadAndShoulders,
    classifyInverseHeadAndShoulders,
    classifyTrendlinePatterns,
    type PatternClassifier,
} from '@/domain/patterns/classifiers';
import { extractPivots } from '@/domain/patterns/pivots';
import {
    makeAlternatingPivotBars,
    makeBars,
    makeHLBars,
} from '@/__tests__/domain/patterns/helpers';
import type { Bar, ChartPatternId, PatternCandidate } from '@/domain/types';

const ATR = 1;

/**
 * Runs the real classifier over `bars` and returns its `id`-matching
 * candidate, `pivots` and all — geometry now comes directly from what a
 * classifier actually matched (spec 2026-09-18 real-data fix), so fixtures
 * derive candidates the same way `screenChartPatterns` does instead of
 * hand-authoring `{id, startIndex, endIndex}` with no `pivots`.
 */
function deriveCandidate(
    bars: readonly Bar[],
    atr: number,
    classifier: PatternClassifier,
    id: ChartPatternId
): PatternCandidate {
    const pivots = extractPivots(bars, atr, { includeProvisional: true });
    const found = classifier(pivots, bars, atr).find(c => c.id === id);
    if (!found) {
        throw new Error(`fixture no longer produces a ${id} candidate`);
    }
    return found;
}

describe('computeCandidateGeometry', () => {
    describe('dispatcher guards', () => {
        const candidate: PatternCandidate = {
            id: 'double_top',
            startIndex: 1,
            endIndex: 3,
        };
        const bars = makeBars([10, 15, 11, 15.2, 11]);

        it('returns null when atr is non-positive', () => {
            expect(computeCandidateGeometry(candidate, bars, 0)).toBeNull();
            expect(computeCandidateGeometry(candidate, bars, -1)).toBeNull();
        });

        it('returns null when atr is non-finite', () => {
            expect(
                computeCandidateGeometry(candidate, bars, Number.NaN)
            ).toBeNull();
        });

        it('returns null when endIndex is out of bounds', () => {
            expect(
                computeCandidateGeometry(
                    { ...candidate, endIndex: 99 },
                    bars,
                    ATR
                )
            ).toBeNull();
        });

        it('returns null when startIndex > endIndex', () => {
            expect(
                computeCandidateGeometry(
                    { ...candidate, startIndex: 3, endIndex: 1 },
                    bars,
                    ATR
                )
            ).toBeNull();
        });
    });

    describe('extreme-match family: double_top', () => {
        // Same fixture as classifiers.test.ts's own double_top case.
        const bars = makeBars([10, 15, 11, 15.2, 11]);
        const candidate = deriveCandidate(
            bars,
            ATR,
            classifyDoubleTripleTop,
            'double_top'
        );

        it('computes neckline/height/targets/invalidation from the two peaks + trough between them', () => {
            const geometry = computeCandidateGeometry(candidate, bars, ATR);
            expect(geometry).not.toBeNull();
            expect(geometry!.direction).toBe('down');
            // peaks 15.05 / 15.25, trough (neckline) 10.95
            expect(geometry!.breakoutLevel).toBeCloseTo(10.95, 5);
            expect(geometry!.height).toBeCloseTo(4.2, 5);
            expect(geometry!.measuredTarget).toBeCloseTo(6.75, 5);
            expect(geometry!.conservativeTarget).toBeCloseTo(8.85, 5);
            expect(geometry!.invalidationLevel).toBeCloseTo(15.25, 5);
            expect(geometry!.keyPoints.length).toBeGreaterThanOrEqual(3);
        });
    });

    describe('extreme-match family: double_bottom (mirrored)', () => {
        const bars = makeBars([10, 5, 9, 4, 9]);
        const candidate = deriveCandidate(
            bars,
            ATR,
            classifyDoubleTripleBottom,
            'double_bottom'
        );

        it('breaks up, target above the neckline', () => {
            const geometry = computeCandidateGeometry(candidate, bars, ATR);
            expect(geometry).not.toBeNull();
            expect(geometry!.direction).toBe('up');
            expect(geometry!.measuredTarget).toBeGreaterThan(
                geometry!.breakoutLevel
            );
            expect(geometry!.conservativeTarget).toBeGreaterThan(
                geometry!.breakoutLevel
            );
            expect(geometry!.conservativeTarget).toBeLessThan(
                geometry!.measuredTarget
            );
        });
    });

    describe('head & shoulders family', () => {
        // Same fixture as classifiers.test.ts's shoulder-tolerance-boundary case,
        // minus its trailing confirmation bar — the right shoulder is the
        // still-forming (provisional) pivot here.
        const bars = makeHLBars([
            [10, 10], // seed
            [15, 15], // left shoulder
            [10, 10], // left trough
            [20, 20], // head
            [10, 10], // right trough
            [18.5, 18.5], // right shoulder (provisional)
        ]);
        const candidate = deriveCandidate(
            bars,
            ATR,
            classifyHeadAndShoulders,
            'head_and_shoulders'
        );

        it('height = head - neckline, target = neckline - height, invalidation = right shoulder', () => {
            const geometry = computeCandidateGeometry(candidate, bars, ATR);
            expect(geometry).not.toBeNull();
            expect(geometry!.direction).toBe('down');
            expect(geometry!.breakoutLevel).toBe(10); // neckline (10+10)/2
            expect(geometry!.height).toBe(10); // head 20 - neckline 10
            expect(geometry!.measuredTarget).toBe(0); // 10 - 10
            expect(geometry!.conservativeTarget).toBe(5); // 10 - 5
            expect(geometry!.invalidationLevel).toBe(18.5); // right shoulder
            const labels = geometry!.keyPoints.map(p => p.label);
            expect(labels).toEqual(
                expect.arrayContaining([
                    'left shoulder',
                    'left trough',
                    'head',
                    'right trough',
                    'right shoulder',
                    'neckline',
                ])
            );
        });

        it('the left shoulder (the series seed pivot) survives — geometry reads candidate.pivots directly, no re-extraction to lose it to (regression guard)', () => {
            // Historically, re-extracting pivots over `bars[startIndex..endIndex]`
            // dropped the left shoulder (the classifier's own seed extreme,
            // never re-emitted by a fresh `extractPivots` call starting at its
            // own bar). Geometry no longer re-extracts at all.
            const geometry = computeCandidateGeometry(candidate, bars, ATR);
            expect(geometry).not.toBeNull();
        });
    });

    describe('inverse head & shoulders (mirrored)', () => {
        const bars = makeHLBars([
            [20, 20],
            [15, 15],
            [20, 20],
            [10, 10],
            [20, 20],
            [16, 16],
        ]);
        const candidate = deriveCandidate(
            bars,
            ATR,
            classifyInverseHeadAndShoulders,
            'inverse_head_and_shoulders'
        );

        it('breaks up, target above the neckline', () => {
            const geometry = computeCandidateGeometry(candidate, bars, ATR);
            expect(geometry).not.toBeNull();
            expect(geometry!.direction).toBe('up');
            expect(geometry!.measuredTarget).toBeGreaterThan(
                geometry!.breakoutLevel
            );
        });
    });

    describe('candidate.pivots missing/insufficient → null (geometry-unavailable residual case)', () => {
        // A real `screenChartPatterns` hit always carries `pivots` (attached
        // by the classifier that matched it) — these two hand-built
        // candidates simulate the only remaining way geometry comes back
        // `null`: a candidate without a usable `pivots` array (spec
        // 2026-09-18 real-data fix — geometry no longer re-extracts pivots
        // over `[startIndex, endIndex]`, it only reads `candidate.pivots`).
        it('no pivots at all', () => {
            const bars = makeBars([10, 15, 10, 20, 10]);
            const candidate: PatternCandidate = {
                id: 'head_and_shoulders',
                startIndex: 1,
                endIndex: 3,
            };
            expect(computeCandidateGeometry(candidate, bars, ATR)).toBeNull();
        });

        it('pivots present but too few for the pattern (fewer than 2 same-kind extremes)', () => {
            const bars = makeBars([10, 15, 11]);
            const candidate: PatternCandidate = {
                id: 'double_top',
                startIndex: 0,
                endIndex: 2,
                pivots: extractPivots(bars, ATR, { includeProvisional: true }),
            };
            expect(computeCandidateGeometry(candidate, bars, ATR)).toBeNull();
        });
    });

    describe('trendline-pair family: ascending_triangle', () => {
        const bars = makeHLBars([10, 20, 10, 20, 12].map(v => [v, v]));
        const candidate = deriveCandidate(
            bars,
            ATR,
            classifyTrendlinePatterns,
            'ascending_triangle'
        );

        it('breaks up at flat resistance; height is the WIDEST gap (pattern start), lines read at the last bar', () => {
            const geometry = computeCandidateGeometry(candidate, bars, ATR);
            expect(geometry).not.toBeNull();
            expect(geometry!.direction).toBe('up');
            expect(geometry!.breakoutLevel).toBeCloseTo(20, 5);
            // support line through the 2 low pivots (2,10)/(4,12), evaluated
            // AT the last bar (index 4, one of the 2 points) -> exactly 12.
            expect(geometry!.invalidationLevel).toBeCloseTo(12, 5);
            // Textbook measured move = height at the widest point, i.e. the
            // first pivot (index 1): resistance 20 − support line at x=1 (9)
            // = 11 — not the narrow last-bar gap (20 − 12 = 8).
            expect(geometry!.height).toBeCloseTo(11, 5);
            expect(geometry!.measuredTarget).toBeCloseTo(31, 5);
            expect(geometry!.conservativeTarget).toBeCloseTo(25.5, 5);
        });

        it('reads the lines at the last pivot when the pattern is already past its apex', () => {
            // Resistance through (1,20)/(3,16) falls 2/bar, support through
            // (2,10)/(4,12) rises 1/bar: the lines cross between x=4 and x=5,
            // so at the last bar (x=9) resistance is below support. The
            // geometry must fall back to the pattern's last pivot (x=4:
            // resistance 14, support 12) instead of vanishing.
            const longBars = makeHLBars(
                [10, 20, 10, 16, 12, 13, 13, 13, 13, 13].map(v => [v, v])
            );
            const pastApex: PatternCandidate = {
                id: 'symmetrical_triangle',
                startIndex: 1,
                endIndex: 4,
                pivots: [
                    { index: 1, price: 20, kind: 'high' },
                    { index: 2, price: 10, kind: 'low' },
                    { index: 3, price: 16, kind: 'high' },
                    { index: 4, price: 12, kind: 'low' },
                ],
            };
            const geometry = computeCandidateGeometry(pastApex, longBars, ATR);
            expect(geometry).not.toBeNull();
            // Widest gap at x=1: 20 − 9 = 11.
            expect(geometry!.height).toBeCloseTo(11, 5);
            expect([14, 12]).toContain(
                Math.round(geometry!.breakoutLevel * 1e6) / 1e6
            );
        });
    });

    describe('trendline-pair family: descending_triangle (mirrored direction)', () => {
        const bars = makeHLBars([10, 20, 10, 18, 10].map(v => [v, v]));
        const candidate = deriveCandidate(
            bars,
            ATR,
            classifyTrendlinePatterns,
            'descending_triangle'
        );

        it('breaks down at flat support', () => {
            const geometry = computeCandidateGeometry(candidate, bars, ATR);
            expect(geometry).not.toBeNull();
            expect(geometry!.direction).toBe('down');
            expect(geometry!.measuredTarget).toBeLessThan(
                geometry!.breakoutLevel
            );
        });
    });

    describe('trendline-pair family: ascending_wedge (bearish) / descending_wedge (bullish)', () => {
        it('ascending_wedge breaks DOWN despite both trendlines rising', () => {
            const bars = makeHLBars([10, 20, 5, 22, 10].map(v => [v, v]));
            const candidate = deriveCandidate(
                bars,
                ATR,
                classifyTrendlinePatterns,
                'ascending_wedge'
            );
            const geometry = computeCandidateGeometry(candidate, bars, ATR);
            expect(geometry).not.toBeNull();
            expect(geometry!.direction).toBe('down');
        });

        it('descending_wedge breaks UP despite both trendlines falling', () => {
            const bars = makeHLBars([10, 20, 5, 15, 3].map(v => [v, v]));
            const candidate = deriveCandidate(
                bars,
                ATR,
                classifyTrendlinePatterns,
                'descending_wedge'
            );
            const geometry = computeCandidateGeometry(candidate, bars, ATR);
            expect(geometry).not.toBeNull();
            expect(geometry!.direction).toBe('up');
        });
    });

    describe('trendline-pair family: rectangle (ambiguous direction)', () => {
        const bars = makeHLBars([10, 20, 5, 20, 5].map(v => [v, v]));
        const candidate = deriveCandidate(
            bars,
            ATR,
            classifyTrendlinePatterns,
            'rectangle'
        );

        it('picks the side price sits closer to (last close at support -> down)', () => {
            const geometry = computeCandidateGeometry(candidate, bars, ATR);
            expect(geometry).not.toBeNull();
            // last bar (index 4) closes at 5 == support -> price sits at
            // support, 0 away vs 15 away from resistance (20) -> down.
            expect(geometry!.direction).toBe('down');
        });
    });

    describe('flag/pennant family: bull_flag', () => {
        const poleCloses = Array.from({ length: 20 }, (_, i) => 90 + i);
        const driftCloses = [107.6, 107.5, 107.4, 107.3, 107.2, 107.1];
        const bars = makeBars([...poleCloses, ...driftCloses]);
        const candidate: PatternCandidate = {
            id: 'bull_flag',
            startIndex: 19,
            endIndex: 25,
        };

        it('breakout at the flag upper channel, height = flagpole length', () => {
            const geometry = computeCandidateGeometry(candidate, bars, ATR);
            expect(geometry).not.toBeNull();
            expect(geometry!.direction).toBe('up');
            // flagpole: close(19)=109 - close(0)=90 = 19
            expect(geometry!.height).toBeCloseTo(19, 1);
            expect(geometry!.measuredTarget).toBeGreaterThan(
                geometry!.breakoutLevel
            );
            expect(geometry!.conservativeTarget).toBeGreaterThan(
                geometry!.breakoutLevel
            );
            const labels = geometry!.keyPoints.map(p => p.label);
            expect(labels).toContain('flagpole base');
            expect(labels).toContain('flag upper channel');
            expect(labels).toContain('flag lower channel');
        });
    });

    describe('flag/pennant family: bear_flag (mirrored)', () => {
        const poleValues = Array.from({ length: 20 }, (_, i) => 109 - i);
        const driftValues = [91.5, 91.6, 91.7, 91.8, 91.9, 92.0];
        const bars = makeHLBars(
            [...poleValues, ...driftValues].map(v => [v, v])
        );
        const candidate: PatternCandidate = {
            id: 'bear_flag',
            startIndex: 19,
            endIndex: 25,
        };

        it('breaks down at the flag lower channel', () => {
            const geometry = computeCandidateGeometry(candidate, bars, ATR);
            expect(geometry).not.toBeNull();
            expect(geometry!.direction).toBe('down');
            expect(geometry!.measuredTarget).toBeLessThan(
                geometry!.breakoutLevel
            );
        });
    });

    describe('flag/pennant family: pole too short → null', () => {
        it('returns null when there is no room before startIndex for a pole', () => {
            const bars = makeBars(Array.from({ length: 5 }, (_, i) => 100 + i));
            const candidate: PatternCandidate = {
                id: 'bull_flag',
                startIndex: 0,
                endIndex: 3,
            };
            expect(computeCandidateGeometry(candidate, bars, ATR)).toBeNull();
        });
    });

    describe('curvature family: rounding_bottom', () => {
        // Same fixture as classifiers.test.ts's own textbook rounding_bottom
        // case — a convex U (lows 10, 4, 2, 9) with its vertex inside the
        // middle half and depth (10-2=8) past the min-depth threshold; the
        // classifier itself requires >= 4 lows fitting a quadratic, which a
        // shorter/looser fixture (as this file used before) cannot satisfy.
        const bars = makeAlternatingPivotBars(
            15,
            [20, 10, 20, 4, 20, 2, 20, 9],
            20
        );
        const candidate = deriveCandidate(
            bars,
            ATR,
            classifyCurvaturePatterns,
            'rounding_bottom'
        );

        it('breakout at the rim, target above by the saucer depth', () => {
            const geometry = computeCandidateGeometry(candidate, bars, ATR);
            expect(geometry).not.toBeNull();
            expect(geometry!.direction).toBe('up');
            // Rim = the highest bar HIGH across the saucer (20), not the
            // highest of the matched low pivots (10) — the lip
            // is the swing high bounding the cup.
            expect(geometry!.breakoutLevel).toBe(20);
            expect(geometry!.height).toBe(18); // 20 - 2
            expect(geometry!.measuredTarget).toBe(38);
            expect(geometry!.conservativeTarget).toBe(29);
            expect(geometry!.keyPoints.map(p => p.label)).toEqual([
                'rim',
                'bottom',
            ]);
            expect(geometry!.invalidationLevel).toBe(2); // no handle -> bottom
        });
    });

    describe('curvature family: rim span bounds', () => {
        // The bar IMMEDIATELY outside each bound is higher than the lip (23 at
        // index 7), so widening the max-high scan by even one bar on either
        // side picks the wrong rim.
        const lows = [
            { index: 2, price: 10, kind: 'low' as const },
            { index: 4, price: 4, kind: 'low' as const },
            { index: 6, price: 2, kind: 'low' as const },
            { index: 8, price: 9, kind: 'low' as const },
        ];

        it('cup_and_handle: rim = highest high between the first cup low and the handle low', () => {
            // index 1 (just before the first cup low) and index 11 (just
            // after the handle low) are 30 > 23; index 9 is inside (21).
            const bars = makeHLBars(
                [40, 30, 10, 20, 4, 20, 2, 23, 9, 21, 7, 30].map(v => [v, v])
            );
            const candidate: PatternCandidate = {
                id: 'cup_and_handle',
                startIndex: 2,
                endIndex: 10,
                pivots: [...lows, { index: 10, price: 7, kind: 'low' }],
            };
            const geometry = computeCandidateGeometry(candidate, bars, ATR);
            expect(geometry).not.toBeNull();
            expect(geometry!.breakoutLevel).toBe(23);
            const rim = geometry!.keyPoints.find(p => p.label === 'rim');
            expect(rim?.time).toBe(bars[7]!.time);
            expect(geometry!.height).toBe(21); // 23 - 2
        });

        it('rounding_bottom: rim = highest high between the first low and the pattern end', () => {
            // index 1 (before) and index 9 (just after endIndex 8) are 30 > 23.
            const bars = makeHLBars(
                [40, 30, 10, 20, 4, 20, 2, 23, 9, 30].map(v => [v, v])
            );
            const candidate: PatternCandidate = {
                id: 'rounding_bottom',
                startIndex: 2,
                endIndex: 8,
                pivots: lows,
            };
            const geometry = computeCandidateGeometry(candidate, bars, ATR);
            expect(geometry).not.toBeNull();
            expect(geometry!.breakoutLevel).toBe(23);
            expect(geometry!.keyPoints.find(p => p.label === 'rim')?.time).toBe(
                bars[7]!.time
            );
        });
    });

    describe('curvature family: cup_and_handle', () => {
        // Same cup as the rounding_bottom fixture above, plus a 5th
        // (provisional) low at 7 — a shallow pullback from the cup's
        // right-edge low (9), matching classifiers.test.ts's own fixture.
        const bars = makeHLBars(
            [15, 20, 10, 20, 4, 20, 2, 20, 9, 20, 7].map(v => [v, v])
        );
        const candidate = deriveCandidate(
            bars,
            ATR,
            classifyCurvaturePatterns,
            'cup_and_handle'
        );

        it('invalidation = handle low, not the cup bottom', () => {
            const geometry = computeCandidateGeometry(candidate, bars, ATR);
            expect(geometry).not.toBeNull();
            expect(geometry!.direction).toBe('up');
            expect(geometry!.invalidationLevel).toBe(7); // handle low, not cup bottom (2)
            // Breakout at the lip (highest high up to the handle), not the
            // highest cup LOW (10) the classifier matched.
            expect(geometry!.breakoutLevel).toBe(20);
            const labels = geometry!.keyPoints.map(p => p.label);
            expect(labels).toContain('handle low');
        });
    });
});
