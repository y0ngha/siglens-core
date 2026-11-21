import { describe, expect, it } from 'vitest';
import type { PatternGeometry } from '@/domain/types';
import { NO_CHART_PATTERNS_LINE } from '@/domain/analysis/chartPatternCandidatesSection';
import { lineValueAt } from '@/domain/patterns/boundaryLines';
import {
    PATTERN_MIN_HEIGHT_PRICE_PCT,
    SCREEN_LOOKBACK_BARS,
} from '@/domain/patterns/constants';
import { extractPivots } from '@/domain/patterns/pivots';
import { computeCandidateGeometry } from '@/domain/patterns/patternGeometry';
import { qualifyFlags } from '@/domain/patterns/qualify/flags';
import { calculateATR } from '@/domain/indicators/atr';
import {
    geometryOf,
    invariantViolations,
    runProductionPipeline,
    statusOf,
} from '@/__tests__/domain/patterns/scenarios/harness';
import {
    type ChartFixture,
    chartFixture,
} from '@/__tests__/domain/patterns/fixtures/chartFixture';
import pennantSlidesFile from '@/__tests__/domain/patterns/fixtures/charts/daily-pennant-breakout-slides.json';
import pennantBelowZeroFile from '@/__tests__/domain/patterns/fixtures/charts/daily-pennant-target-below-zero.json';
import triangleBeforeApexFile from '@/__tests__/domain/patterns/fixtures/charts/daily-triangle-broken-before-apex.json';

/**
 * Real-chart regressions for the breakout freeze (WP-17 core-3). Each chart is
 * anonymized (see `chartFixture`) and is one 250-bar window ending on a day
 * the old engine mishandled; the pipeline runs on prefixes of it, which are
 * the same charts a day earlier (ATR and pivots are causal).
 */
const pennantSlides = chartFixture(pennantSlidesFile);
const pennantBelowZero = chartFixture(pennantBelowZeroFile);
const triangleBeforeApex = chartFixture(triangleBeforeApexFile);

const runAt = (chart: ChartFixture, length: number) =>
    runProductionPipeline(chart.bars.slice(0, length), chart.timeframe);

const directedGeometry = (
    g: ReturnType<typeof geometryOf>
): PatternGeometry => {
    if (g.direction === null) throw new Error('expected directed geometry');
    return g;
};

describe('a pennant breaking down keeps its breakout level while its lower line climbs', () => {
    // The pennant (bars 200-232) closes under its lower line at bar 233. That
    // line then climbs about 1.5 per bar, so read at the last bar the breakout
    // slid from 244.44 to 282 within 13 bars.
    const BREAK = 233;
    const lengths = [234, 240, 246];
    const pennantsAt = lengths.map(n => {
        const run = runAt(pennantSlides, n);
        const pennant = run.qualified.find(q => q.id === 'pennant');
        if (pennant === undefined || pennant.shape.kind !== 'flag')
            throw new Error(`no pennant at ${n} bars`);
        return { n, run, pennant, shape: pennant.shape };
    });

    it('breaks at bar 233 on every day from the break on', () => {
        expect(pennantsAt.map(p => p.shape.breakoutIndex)).toEqual([
            BREAK,
            BREAK,
            BREAK,
        ]);
    });

    it('prints the same geometry on every day, equal to the lower line at the break bar', () => {
        const [first] = pennantsAt;
        const frozen = lineValueAt(first.shape.lower, BREAK);
        const geometries = pennantsAt.map(p =>
            directedGeometry(geometryOf(p.run, p.pennant))
        );
        expect(geometries).toEqual([
            geometries[0],
            geometries[0],
            geometries[0],
        ]);
        expect(geometries[0].breakoutLevel).toBeCloseTo(frozen, 10);
        expect(geometries[0].direction).toBe('down');
    });

    it('the line itself has moved away from the frozen level by the last bar', () => {
        const last = pennantsAt[pennantsAt.length - 1];
        const slid = lineValueAt(last.shape.lower, last.n - 1);
        const frozen = lineValueAt(last.shape.lower, BREAK);
        // By more than a tenth of the breakout level (what the old reading printed).
        expect(slid - frozen).toBeGreaterThan(0.1 * frozen);
    });

    it('is "broken" while the close stays under the frozen level', () => {
        expect(pennantsAt.map(p => statusOf(p.run, 'pennant'))).toEqual([
            'broken',
            'broken',
            'broken',
        ]);
    });

    it('the overlay ends its dashed lower line on the break bar at the printed breakout', () => {
        const last = pennantsAt[pennantsAt.length - 1];
        const overlay = last.run.overlays.find(o =>
            o.id.startsWith('pattern:pennant:')
        );
        const g = directedGeometry(geometryOf(last.run, last.pennant));
        const dashed = overlay?.segments.filter(
            s => s.role === 'channel_lower' && s.style === 'dashed'
        );
        expect(dashed?.map(s => [s.to.time, s.to.price])).toEqual([
            [last.run.bars[BREAK].time, g.breakoutLevel],
        ]);
    });

    it('holds every invariant of the harness on each day', () => {
        expect(pennantsAt.map(p => invariantViolations(p.run))).toEqual([
            [],
            [],
            [],
        ]);
    });

    it('reads "failed breakout" on the full chart, whose last close is back over the frozen level', () => {
        const run = runAt(pennantSlides, pennantSlides.bars.length);
        expect(statusOf(run, 'pennant')).toBe('failed breakout');
    });
});

describe('a pennant whose measured move runs below zero is not offered', () => {
    const bars = pennantBelowZero.bars;
    const series = calculateATR(bars);
    const atr = series[series.length - 1];
    if (atr === null || atr === undefined) throw new Error('ATR not ready');
    const windowStart = Math.max(0, bars.length - SCREEN_LOOKBACK_BARS);
    const [pennant] = qualifyFlags({
        bars,
        pivots: extractPivots(bars, series, { onePivotPerBar: true }).filter(
            p => p.index >= windowStart
        ),
        atr,
        lastIndex: bars.length - 1,
        minHeightPricePct: PATTERN_MIN_HEIGHT_PRICE_PCT['1Day'],
    });

    it('the flag qualifier still finds the pennant, breaking down', () => {
        expect(pennant.id).toBe('pennant');
        expect(pennant.shape).toMatchObject({
            kind: 'flag',
            direction: 'down',
        });
    });

    it('its pole is taller than the breakout line it would project from, so the target is below zero', () => {
        if (pennant.shape.kind !== 'flag') throw new Error('flag');
        const { poleTop, poleBase, lower, breakoutIndex } = pennant.shape;
        const pole = Math.abs(poleTop.price - poleBase.price);
        expect(lineValueAt(lower, breakoutIndex) - pole).toBeLessThan(0);
    });

    it('has no geometry', () => {
        expect(computeCandidateGeometry(pennant, bars, atr)).toBeNull();
    });

    it('is not qualified, drawn or printed', () => {
        const run = runAt(pennantBelowZero, bars.length);
        expect(run.qualified).toEqual([]);
        expect(run.overlays).toEqual([]);
        expect(run.section).toContain(NO_CHART_PATTERNS_LINE);
    });
});

describe('a triangle broken before its apex keeps its geometry after the lines cross', () => {
    // The symmetrical triangle (bars 186-241) closes under its lower line at
    // bar 247, two bars before the lines meet. Read at the last bar the pair
    // had crossed by bar 249 and was dropped.
    const BREAK = 247;
    const lengths = [248, 249, 250];
    const trianglesAt = lengths.map(n => {
        const run = runAt(triangleBeforeApex, n);
        const triangle = run.qualified.find(
            q => q.id === 'symmetrical_triangle'
        );
        if (triangle === undefined || triangle.shape.kind !== 'trendline')
            throw new Error(`no triangle at ${n} bars`);
        return { n, run, triangle, shape: triangle.shape };
    });

    it('breaks at bar 247 on every day from the break on', () => {
        expect(trianglesAt.map(t => t.shape.breakoutIndex)).toEqual([
            BREAK,
            BREAK,
            BREAK,
        ]);
    });

    it('on the last day the lines have crossed, so the old reading had no geometry', () => {
        const last = trianglesAt[trianglesAt.length - 1];
        const lastIndex = last.n - 1;
        expect(lineValueAt(last.shape.upper, lastIndex)).toBeLessThan(
            lineValueAt(last.shape.lower, lastIndex)
        );
    });

    it('prints the same geometry on every day, equal to the lower line at the break bar', () => {
        const geometries = trianglesAt.map(t =>
            directedGeometry(geometryOf(t.run, t.triangle))
        );
        expect(geometries).toEqual([
            geometries[0],
            geometries[0],
            geometries[0],
        ]);
        expect(geometries[0].direction).toBe('down');
        expect(geometries[0].breakoutLevel).toBeCloseTo(
            lineValueAt(trianglesAt[0].shape.lower, BREAK),
            10
        );
    });

    it('is "broken" on the break day and "failed breakout" once a close is back over the frozen level', () => {
        expect(
            trianglesAt.map(t => statusOf(t.run, 'symmetrical_triangle'))
        ).toEqual(['broken', 'failed breakout', 'failed breakout']);
    });

    it('holds every invariant of the harness on each day', () => {
        expect(trianglesAt.map(t => invariantViolations(t.run))).toEqual([
            [],
            [],
            [],
        ]);
    });
});
