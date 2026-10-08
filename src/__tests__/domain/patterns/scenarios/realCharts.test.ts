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

/**
 * Real-chart regressions (2026-10-08 recall diagnosis). The charts are
 * anonymized (see `chartFixture`) and keep their full fetched history: the
 * pivots read the per-bar ATR series from its first bar, exactly as the
 * analysis prompt does, so a shorter slice would warm up differently.
 */
const piercedChannel = chartFixture(piercedChannelFile);
const risingResistance = chartFixture(risingResistanceFile);

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
