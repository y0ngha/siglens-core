import { describe, expect, it } from 'vitest';
import {
    CHART_PATTERN_CANDIDATES_SECTION_HEADER,
    CHART_PATTERN_CANDIDATES_SECTION_INTRO,
    formatChartPatternCandidatesSection,
    printedPatternGeometriesByOverlayId,
    spacingLine,
} from '@/domain/analysis/chartPatternCandidatesSection';
import { screenChartPatterns } from '@/domain/patterns';
import {
    computePatternTargets,
    printedPatternGeometry,
} from '@/domain/analysis/patternTargets';
import { buildPatternOverlayCandidates } from '@/domain/overlays/patternOverlays';
import {
    makeAlternatingPivotBars,
    makeBars,
} from '@/__tests__/domain/patterns/helpers';
import type { Bar, PatternCandidate, PatternGeometry } from '@/domain/types';

/**
 * `formatChartPatternCandidatesSection` no longer screens internally (spec
 * 2026-09-18 — the caller screens once and shares the result) —
 * this mirrors exactly what `prompt.ts` now does at its own call site.
 */
const candidatesFor = (
    bars: readonly Bar[],
    atr: number | null
): PatternCandidate[] =>
    atr !== null && atr > 0 ? screenChartPatterns(bars, atr) : [];

/** Mirrors `prompt.ts`'s `offeredPatternOverlayIds` derivation exactly. */
const offeredIdsFor = (
    candidates: readonly PatternCandidate[],
    bars: readonly Bar[],
    atr: number | null
): ReadonlySet<string> =>
    new Set(
        buildPatternOverlayCandidates(candidates, bars, atr ?? 0, 2).map(
            c => c.id
        )
    );

describe('formatChartPatternCandidatesSection', () => {
    it('renders "None detected" when atr is null', () => {
        const bars: Bar[] = [
            { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 },
        ];
        const candidates = candidatesFor(bars, null);
        const section = formatChartPatternCandidatesSection(
            candidates,
            bars,
            null,
            2,
            '1Day',
            offeredIdsFor(candidates, bars, null)
        );
        expect(section).toBe(
            `${CHART_PATTERN_CANDIDATES_SECTION_HEADER}\n${CHART_PATTERN_CANDIDATES_SECTION_INTRO}\n- None detected by the pre-screener`
        );
    });

    it('renders "None detected" when atr is non-positive', () => {
        const bars: Bar[] = [
            { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 },
        ];
        const candidates = candidatesFor(bars, 0);
        expect(
            formatChartPatternCandidatesSection(
                candidates,
                bars,
                0,
                2,
                '1Day',
                offeredIdsFor(candidates, bars, 0)
            )
        ).toContain('- None detected by the pre-screener');
    });

    it('renders "None detected" when the pre-screener finds nothing', () => {
        // Flat bars never retrace far enough to establish any pivot.
        const bars: Bar[] = Array.from({ length: 10 }, (_, i) => ({
            time: i,
            open: 100,
            high: 100,
            low: 100,
            close: 100,
            volume: 1,
        }));
        const candidates = candidatesFor(bars, 1);
        const section = formatChartPatternCandidatesSection(
            candidates,
            bars,
            1,
            2,
            '1Day',
            offeredIdsFor(candidates, bars, 1)
        );
        expect(section).toBe(
            `${CHART_PATTERN_CANDIDATES_SECTION_HEADER}\n${CHART_PATTERN_CANDIDATES_SECTION_INTRO}\n- None detected by the pre-screener`
        );
    });

    it('renders a candidate block with computed geometry and % distances from the last close', () => {
        const bars = makeAlternatingPivotBars(10, [20, 10, 20, 12], 20);
        const candidates = candidatesFor(bars, 1);
        const section = formatChartPatternCandidatesSection(
            candidates,
            bars,
            1,
            2,
            '1Day',
            offeredIdsFor(candidates, bars, 1)
        );

        expect(
            section.startsWith(CHART_PATTERN_CANDIDATES_SECTION_HEADER)
        ).toBe(true);
        expect(section).toContain('### ascending_triangle');
        expect(section).toContain('- Breakout level: 20.00');
        // last close = 20 = breakout level -> 0% distance, still (forming) since not strictly beyond
        expect(section).toContain('(forming)');
        // Height is the widest gap (pattern start), not the last-bar gap:
        // resistance 20 − support line extrapolated to the first pivot (9).
        // Extreme level = breakout − height (up), so a model that copies
        // breakout/extreme/direction makes the app recompute the same targets.
        expect(section).toContain('- Extreme level: 9.00');
        expect(section).toContain('- Direction: up');
        expect(section).toContain('- Height: 11.00');
        expect(section).toContain('- Measured target: 31.00');
        expect(section).toContain('- Conservative target (50%): 25.50');
        expect(section).toContain('- Invalidation level: 13.00');
        expect(section).toMatch(/- Key points: .+left rim|resistance touch/);
        // A drawable overlay was offered for this candidate -> the id line prints.
        expect(section).toContain('- Candidate id: pattern:');
    });

    it('prints the Spacing line right after Key points for a double bottom, and none for a rectangle', () => {
        // troughs at bar 1 and bar 3 → 2 bars apart; the rectangle has touches, not peaks/troughs
        const bars = makeAlternatingPivotBars(20, [10, 20, 10, 20], 20);
        const candidates = candidatesFor(bars, 1);
        const section = formatChartPatternCandidatesSection(
            candidates,
            bars,
            1,
            2,
            '1Day',
            offeredIdsFor(candidates, bars, 1)
        );
        const block = (id: string): string[] => {
            const start = section.indexOf(`### ${id}`);
            expect(start).toBeGreaterThanOrEqual(0);
            const next = section.indexOf('\n### ', start + 4);
            return section
                .slice(start, next === -1 ? undefined : next)
                .split('\n');
        };
        const db = block('double_bottom');
        const kp = db.findIndex(l => l.startsWith('- Key points: '));
        expect(db[kp + 1]).toBe('- Spacing (bars): trough 1 → trough 2: 2');
        expect(block('rectangle').some(l => l.startsWith('- Spacing'))).toBe(
            false
        );
    });

    describe('spacingLine', () => {
        const pt = (label: string, index: number) => ({
            label,
            price: 1,
            index,
            time: index,
        });

        it('is the bar count between consecutive peaks/troughs in index order (OXY 2026-10-02: 5, not "7봉"/"14봉")', () => {
            expect(
                spacingLine([
                    pt('trough 1', 492),
                    pt('trough 2', 497),
                    pt('neckline', 494),
                ])
            ).toBe('- Spacing (bars): trough 1 → trough 2: 5');
        });

        it('covers head and shoulders and ignores non-structural points', () => {
            expect(
                spacingLine([
                    pt('left shoulder', 10),
                    pt('left trough', 12),
                    pt('head', 18),
                    pt('right trough', 21),
                    pt('right shoulder', 25),
                    pt('neckline', 21),
                ])
            ).toBe(
                '- Spacing (bars): left shoulder → head: 8 / head → right shoulder: 7'
            );
        });

        it('is null with fewer than two structural points', () => {
            expect(spacingLine([pt('rim', 1), pt('bottom', 9)])).toBeNull();
            expect(spacingLine([pt('peak 1', 4)])).toBeNull();
        });
    });

    // Review round 2: a model copies the PRINTED breakout/extreme, so the app's
    // recomputation must reproduce the PRINTED targets exactly — with raw,
    // non-terminating geometry (OLS trendlines) and at every price precision.
    it.each([2, 0])(
        'printed targets equal computePatternTargets of the printed breakout/extreme (priceDp %i)',
        priceDp => {
            const bars = makeAlternatingPivotBars(
                10,
                [20.07, 10.13, 20.11, 12.29, 19.97, 13.41],
                20.03
            );
            const candidates = candidatesFor(bars, 1);
            const section = formatChartPatternCandidatesSection(
                candidates,
                bars,
                1,
                priceDp,
                '1Day',
                offeredIdsFor(candidates, bars, 1)
            );
            const blocks = section
                .split('\n### ')
                .slice(1)
                .filter(b => b.includes('- Breakout level: '));
            expect(blocks.length).toBeGreaterThan(0);
            for (const block of blocks) {
                const num = (label: string): string =>
                    new RegExp(`- ${label}: (-?[\\d.]+)`).exec(block)![1]!;
                const direction = /- Direction: (up|down)/.exec(block)![1] as
                    'up' | 'down';
                const recomputed = computePatternTargets(
                    Number(num('Breakout level')),
                    Number(num('Extreme level')),
                    direction
                );
                expect(Number(num('Measured target'))).toBe(
                    recomputed.measuredTarget
                );
                expect(Number(num('Conservative target \\(50%\\)'))).toBe(
                    recomputed.conservativeTarget
                );
                // Never more than one decimal beyond the price precision.
                const conservativeText = num('Conservative target \\(50%\\)');
                const decimals = conservativeText.includes('.')
                    ? conservativeText.split('.')[1]!.length
                    : 0;
                expect(decimals).toBeLessThanOrEqual(priceDp + 1);
            }
        }
    );

    it('never prints a negative target and takes the status from the printed (rounded) breakout', () => {
        // Reviewer's probe: a down pattern taller than its breakout projects a
        // negative measured target, and a raw neckline of 19.9951 printed as
        // 20.00 must not read "broken" against a last close of 20.00.
        const bars = makeAlternatingPivotBars(15, [25, 10, 19.9951, 10.02], 20);
        const candidates = candidatesFor(bars, 1);
        const section = formatChartPatternCandidatesSection(
            candidates,
            bars,
            1,
            2,
            '1Day',
            offeredIdsFor(candidates, bars, 1)
        );
        expect(section).not.toMatch(/target(?: \(50%\))?: -\d/);
        const doubleBottom = section
            .split('\n### ')
            .find(b => b.startsWith('double_bottom'));
        expect(doubleBottom).toContain('- Breakout level: 20.00');
        expect(doubleBottom!.startsWith('double_bottom (forming)')).toBe(true);
        // The descending triangle's projected target is below zero → N/A.
        expect(section).toContain('- Measured target: N/A');
    });

    it('renders (broken) when the last close has already moved past the breakout level', () => {
        // Same double_top shape as patternGeometry.test.ts, but the trailing
        // low closes well below the neckline (~10.95) instead of just below
        // the second peak — direction is 'down', so this counts as broken.
        const bars = makeBars([10, 15, 11, 15.2, 5]);
        const candidates = candidatesFor(bars, 1);
        const section = formatChartPatternCandidatesSection(
            candidates,
            bars,
            1,
            2,
            '1Day',
            offeredIdsFor(candidates, bars, 1)
        );
        expect(section).toContain('### double_top (broken)');
    });

    it('every candidate block names the pattern id as its heading', () => {
        const bars = makeAlternatingPivotBars(10, [20, 5, 20, 5], 20); // rectangle
        const candidates = candidatesFor(bars, 1);
        const section = formatChartPatternCandidatesSection(
            candidates,
            bars,
            1,
            2,
            '1Day',
            offeredIdsFor(candidates, bars, 1)
        );
        expect(section).toContain('### rectangle');
    });

    describe('when geometry cannot be computed at render time', () => {
        // double_top screened from valid data (see the "(broken)" case above).
        const bars = makeBars([10, 15, 11, 15.2, 5]);
        const candidates = candidatesFor(bars, 1);

        it('renders each supplied candidate as "geometry unavailable" when atr is null', () => {
            expect(candidates.length).toBeGreaterThan(0);
            const section = formatChartPatternCandidatesSection(
                candidates,
                bars,
                null,
                2,
                '1Day',
                offeredIdsFor(candidates, bars, null)
            );
            expect(section).toContain('### double_top — geometry unavailable');
            expect(section).not.toContain('- Breakout level');
            expect(section).not.toContain('None detected');
        });

        it('renders "geometry unavailable" instead of throwing when the bar series is empty', () => {
            const section = formatChartPatternCandidatesSection(
                candidates,
                [],
                1,
                2,
                '1Day',
                offeredIdsFor(candidates, [], 1)
            );
            expect(section).toContain('### double_top — geometry unavailable');
        });
    });

    it('omits the "% from last close" suffix when the last close is not a positive price (bad feed tick)', () => {
        const bars = makeBars([10, 15, 11, 15.2, 5]);
        const candidates = candidatesFor(bars, 1);
        const zeroCloseBars: Bar[] = [
            ...bars.slice(0, -1),
            { ...bars[bars.length - 1], close: 0 },
        ];
        const section = formatChartPatternCandidatesSection(
            candidates,
            zeroCloseBars,
            1,
            2,
            '1Day',
            offeredIdsFor(candidates, zeroCloseBars, 1)
        );
        expect(section).toMatch(/- Breakout level: \d+\.\d{2}\n/);
        expect(section).not.toContain('from last close');
    });

    it('a candidate with geometry but no offered overlay (empty offeredOverlayIds) gets no "Candidate id" line', () => {
        // Same fixture as the "computed geometry" test above (a real
        // ascending_triangle hit with geometry) — only the offered-id set
        // changes, isolating the gate from geometry availability.
        const bars = makeAlternatingPivotBars(10, [20, 10, 20, 12], 20);
        const candidates = candidatesFor(bars, 1);
        const section = formatChartPatternCandidatesSection(
            candidates,
            bars,
            1,
            2,
            '1Day',
            new Set() // nothing was offered as a drawable overlay
        );
        expect(section).toContain('### ascending_triangle');
        expect(section).toContain('- Breakout level: 20.00');
        expect(section).not.toContain('- Candidate id:');
    });

    it('a real "no overlay built" case (flag with endIndex <= startIndex) also gets no "Candidate id" line', () => {
        // A single-bar flag candidate: geometry may still compute, but
        // `buildPatternOverlayCandidates` refuses to draw a flag whose
        // channel has no width (`endIndex <= startIndex`).
        const bars = makeAlternatingPivotBars(10, [20, 10, 20, 12], 20);
        const candidates = candidatesFor(bars, 1);
        const flagCandidate: PatternCandidate = {
            id: 'bull_flag',
            startIndex: 3,
            endIndex: 3,
            pivots: candidates[0]?.pivots,
        };
        const offered = offeredIdsFor([flagCandidate], bars, 1);
        expect(offered.size).toBe(0);
        const section = formatChartPatternCandidatesSection(
            [flagCandidate],
            bars,
            1,
            2,
            '1Day',
            offered
        );
        expect(section).not.toContain('- Candidate id:');
    });
});

describe('printedPatternGeometriesByOverlayId', () => {
    it.each([2, 0])(
        'maps each printed Candidate id to exactly the breakout/extreme/direction/invalidation its block prints (priceDp %i)',
        priceDp => {
            const bars = makeAlternatingPivotBars(
                10,
                [20.07, 10.13, 20.11, 12.29, 19.97, 13.41],
                20.03
            );
            const candidates = candidatesFor(bars, 1);
            const offered = offeredIdsFor(candidates, bars, 1);
            const section = formatChartPatternCandidatesSection(
                candidates,
                bars,
                1,
                priceDp,
                '1Day',
                offered
            );
            const geometries = printedPatternGeometriesByOverlayId(
                candidates,
                bars,
                1,
                priceDp,
                offered
            );
            const blocks = section
                .split('\n### ')
                .filter(b => b.includes('- Candidate id: '));
            expect(blocks.length).toBeGreaterThan(0);
            expect(geometries.size).toBe(blocks.length);
            for (const block of blocks) {
                const field = (label: string): string =>
                    new RegExp(`- ${label}: (\\S+)`).exec(block)![1]!;
                expect(geometries.get(field('Candidate id'))).toEqual({
                    breakoutLevel: Number(field('Breakout level')),
                    extremeLevel: Number(field('Extreme level')),
                    direction: field('Direction'),
                    invalidationLevel: Number(field('Invalidation level')),
                });
            }
        }
    );

    it('leaves out a candidate whose overlay was not offered', () => {
        const bars = makeAlternatingPivotBars(10, [20, 10, 20, 12], 20);
        const candidates = candidatesFor(bars, 1);
        expect(
            printedPatternGeometriesByOverlayId(
                candidates,
                bars,
                1,
                2,
                new Set()
            ).size
        ).toBe(0);
    });
});

describe('printedPatternGeometry', () => {
    const geometry: PatternGeometry = {
        keyPoints: [],
        breakoutLevel: 50.004,
        height: 10.123,
        measuredTarget: 0,
        conservativeTarget: 0,
        invalidationLevel: 0,
        direction: 'down',
    };

    it('rounds breakout and breakout ± height to the printed precision', () => {
        expect(printedPatternGeometry(geometry, 2)).toEqual({
            breakoutLevel: 50,
            extremeLevel: 60.13,
            direction: 'down',
        });
    });

    it('omits an invalidation level the block prints as N/A', () => {
        expect(printedPatternGeometry(geometry, 2)).not.toHaveProperty(
            'invalidationLevel'
        );
        expect(
            printedPatternGeometry(
                { ...geometry, invalidationLevel: 61.456 },
                2
            ).invalidationLevel
        ).toBe(61.46);
    });
});
