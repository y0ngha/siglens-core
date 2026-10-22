import { describe, expect, it } from 'vitest';
import type { ChartPatternId } from '@/domain/types';
import {
    invariantViolations,
    runProductionPipeline,
} from '@/__tests__/domain/patterns/scenarios/harness';
import {
    type ChartFixture,
    chartFixture,
} from '@/__tests__/domain/patterns/fixtures/chartFixture';
import piercedChannelFile from '@/__tests__/domain/patterns/fixtures/charts/daily-channel-pierced.json';
import risingResistanceFile from '@/__tests__/domain/patterns/fixtures/charts/daily-rising-resistance.json';
import gapDownNearLeftRimFile from '@/__tests__/domain/patterns/fixtures/charts/daily-gap-down-near-left-rim.json';

/**
 * Real-chart regressions from a recall diagnosis. The charts are
 * anonymized (see `chartFixture`) and keep their full fetched history: the
 * pivots read the per-bar ATR series from its first bar, exactly as the
 * analysis prompt does, so a shorter slice would warm up differently.
 */
const piercedChannel = chartFixture(piercedChannelFile);
const risingResistance = chartFixture(risingResistanceFile);
const gapDownNearLeftRim = chartFixture(gapDownNearLeftRimFile);

const run = (chart: ChartFixture) =>
    runProductionPipeline(chart.bars, chart.timeframe);
const drawn = (chart: ChartFixture): ChartPatternId[] =>
    run(chart).qualified.map(q => q.id);

describe('real-chart regressions (2026-10-08 recall diagnosis)', () => {
    it.each(Object.entries({ piercedChannel, risingResistance }))(
        '%s: no drawn line is crossed and every printed level lies on a drawn line',
        (_, chart) => {
            expect(invariantViolations(run(chart))).toEqual([]);
        }
    );

    it('a daily ascending channel a candle pierces by 0.28 ATR is not drawn', () => {
        expect(drawn(piercedChannel)).not.toContain('ascending_channel');
    });

    it('the daily chart whose "resistance" highs keep rising draws no ascending triangle', () => {
        expect(drawn(risingResistance)).not.toContain('ascending_triangle');
    });
});

describe('a gap-down two bars after the left rim is not a rounding bottom (2026-10-08 A/B)', () => {
    // Rims 344.57 / 345.34 and a low of 300.00 two bars after the left rim
    // (before scaling). The quadratic fitted on the closes centred its vertex
    // and the chart drew a saucer; drawn through the printed points it is a
    // crash and a slow climb. The extreme bar must sit in the middle half.
    const r = run(gapDownNearLeftRim);

    it('draws no rounding bottom', () => {
        expect(r.qualified.map(q => q.id)).not.toContain('rounding_bottom');
    });

    it('leaves no invariant violation', () => {
        expect(invariantViolations(r)).toEqual([]);
    });
});
