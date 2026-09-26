import { describe, expect, it } from 'vitest';
import {
    CHART_PATTERN_CANDIDATES_SECTION_HEADER,
    CHART_PATTERN_CANDIDATES_SECTION_INTRO,
    formatChartPatternCandidatesSection,
} from '@/domain/analysis/chartPatternCandidatesSection';
import { screenChartPatterns } from '@/domain/patterns';
import { computePatternTargets } from '@/domain/analysis/patternTargets';
import {
    makeAlternatingPivotBars,
    makeBars,
} from '@/__tests__/domain/patterns/helpers';
import type { Bar, PatternCandidate } from '@/domain/types';

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

describe('formatChartPatternCandidatesSection', () => {
    it('renders "None detected" when atr is null', () => {
        const bars: Bar[] = [
            { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 },
        ];
        const section = formatChartPatternCandidatesSection(
            candidatesFor(bars, null),
            bars,
            null,
            2,
            '1Day'
        );
        expect(section).toBe(
            `${CHART_PATTERN_CANDIDATES_SECTION_HEADER}\n${CHART_PATTERN_CANDIDATES_SECTION_INTRO}\n- None detected by the pre-screener`
        );
    });

    it('renders "None detected" when atr is non-positive', () => {
        const bars: Bar[] = [
            { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 },
        ];
        expect(
            formatChartPatternCandidatesSection(
                candidatesFor(bars, 0),
                bars,
                0,
                2,
                '1Day'
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
        const section = formatChartPatternCandidatesSection(
            candidatesFor(bars, 1),
            bars,
            1,
            2,
            '1Day'
        );
        expect(section).toBe(
            `${CHART_PATTERN_CANDIDATES_SECTION_HEADER}\n${CHART_PATTERN_CANDIDATES_SECTION_INTRO}\n- None detected by the pre-screener`
        );
    });

    it('renders a candidate block with computed geometry and % distances from the last close', () => {
        const bars = makeAlternatingPivotBars(10, [20, 10, 20, 12], 20);
        const section = formatChartPatternCandidatesSection(
            candidatesFor(bars, 1),
            bars,
            1,
            2,
            '1Day'
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
            const section = formatChartPatternCandidatesSection(
                candidatesFor(bars, 1),
                bars,
                1,
                priceDp,
                '1Day'
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
        const section = formatChartPatternCandidatesSection(
            candidatesFor(bars, 1),
            bars,
            1,
            2,
            '1Day'
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
        const section = formatChartPatternCandidatesSection(
            candidatesFor(bars, 1),
            bars,
            1,
            2,
            '1Day'
        );
        expect(section).toContain('### double_top (broken)');
    });

    it('every candidate block names the pattern id as its heading', () => {
        const bars = makeAlternatingPivotBars(10, [20, 5, 20, 5], 20); // rectangle
        const section = formatChartPatternCandidatesSection(
            candidatesFor(bars, 1),
            bars,
            1,
            2,
            '1Day'
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
                '1Day'
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
                '1Day'
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
            '1Day'
        );
        expect(section).toMatch(/- Breakout level: \d+\.\d{2}\n/);
        expect(section).not.toContain('from last close');
    });
});
