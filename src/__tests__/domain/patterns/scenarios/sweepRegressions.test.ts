import { describe, expect, it } from 'vitest';
import type { ChartPatternId } from '@/domain/types';
import {
    invariantViolations,
    runPipeline,
    runProductionPipeline,
    statusOf,
} from '@/__tests__/domain/patterns/scenarios/harness';
import { calculateATR } from '@/domain/indicators/atr';
import { computeCandidateGeometry } from '@/domain/patterns/patternGeometry';
import { lineValueAt } from '@/domain/patterns/boundaryLines';
import { CONVERGING_MAX_WIDTH_RATIO } from '@/domain/patterns/constants';
import {
    type ChartFixture,
    chartFixture,
} from '@/__tests__/domain/patterns/fixtures/chartFixture';
import cupStaircaseFile from '@/__tests__/domain/patterns/fixtures/charts/daily-cup-staircase.json';
import cupRimsFarApartFile from '@/__tests__/domain/patterns/fixtures/charts/hourly-cup-rims-far-apart-for-depth.json';
import crashThenClimbFile from '@/__tests__/domain/patterns/fixtures/charts/daily-crash-then-climb-and-pennant.json';
import doubleTopRisingLegFile from '@/__tests__/domain/patterns/fixtures/charts/intraday-double-top-rising-leg.json';
import cupOutsideBarRimFile from '@/__tests__/domain/patterns/fixtures/charts/daily-cup-outside-bar-rim.json';
import hsBelowNecklineFile from '@/__tests__/domain/patterns/fixtures/charts/synthetic-hs-right-shoulder-below-neckline.json';

/**
 * Regressions from the 2026-10-08 validation sweep (81 real charts, a
 * seeded fuzzer). The real charts are anonymized (see `chartFixture`), keep
 * their full fetched history and run the way the analysis prompt runs them —
 * the latest ATR plus the per-bar series for the pivots. Each fixture is
 * kept because a rule fails one of these tests when it is removed.
 */
const cupStaircase = chartFixture(cupStaircaseFile);
const cupRimsFarApart = chartFixture(cupRimsFarApartFile);
const crashThenClimb = chartFixture(crashThenClimbFile);
const doubleTopRisingLeg = chartFixture(doubleTopRisingLegFile);
const cupOutsideBarRim = chartFixture(cupOutsideBarRimFile);
const hsBelowNeckline = chartFixture(hsBelowNecklineFile);

/** The fixtures' price scale (see `chartFixture`). */
const SCALE = 1.37;

const drawn = (c: ChartFixture): ChartPatternId[] =>
    runProductionPipeline(c.bars, c.timeframe).qualified.map(q => q.id);

describe('cups judged false on real charts are not drawn', () => {
    it('a staircase of higher highs with no advance into the left rim (CUP_PRIOR_ADVANCE_SPAN_SHARE)', () => {
        expect(drawn(cupStaircase)).not.toContain('cup_and_handle');
    });

    it('rims too far apart for the depth of a shallow hourly base (CUP_RIM_MAX_DEPTH_SHARE)', () => {
        expect(drawn(cupRimsFarApart)).not.toContain('cup_and_handle');
    });

    it('a bottom two bars after the left rim — a crash, then a long climb', () => {
        expect(drawn(crashThenClimb)).not.toContain('cup_and_handle');
    });
});

describe('a double top whose trough comes two bars after the first peak (a rising leg) is not drawn', () => {
    it('intraday', () => {
        expect(drawn(doubleTopRisingLeg)).not.toContain('double_top');
    });
});

describe('a head & shoulders whose neckline a close crossed before the right shoulder', () => {
    // A fuzzed series the sweep ran at a pinned ATR.
    it('is not drawn at the pinned ATR, at the latest ATR, or the way production runs', () => {
        const c = hsBelowNeckline;
        const series = calculateATR(c.bars);
        for (const atr of [c.atr as number, series.at(-1) as number])
            expect(
                runPipeline(c.bars, atr, c.timeframe).qualified.map(q => q.id)
            ).not.toContain('head_and_shoulders');
        expect(drawn(c)).not.toContain('head_and_shoulders');
    });

    it('leaves no invariant violation', () => {
        expect(
            invariantViolations(
                runProductionPipeline(
                    hsBelowNeckline.bars,
                    hsBelowNeckline.timeframe
                )
            )
        ).toEqual([]);
    });
});

describe('a flag keeps its label while it forms', () => {
    const c = crashThenClimb;

    it('the daily flag that read pennant → bear flag → pennant on three bars keeps one label', () => {
        const labels = new Set<string>();
        for (let n = 466; n <= 473; n++) {
            const run = runProductionPipeline(c.bars.slice(0, n), c.timeframe);
            for (const q of run.qualified)
                if (q.shape.kind === 'flag') labels.add(q.id);
        }
        expect([...labels]).toEqual(['pennant']);
    });

    it('the drawn channel always reads the way it is labelled (converging for a pennant)', () => {
        let checked = 0;
        for (let n = 466; n <= 473; n++) {
            const run = runProductionPipeline(c.bars.slice(0, n), c.timeframe);
            for (const q of run.qualified) {
                if (q.shape.kind !== 'flag') continue;
                const { upper, lower } = q.shape;
                const a = Math.min(upper.start.index, lower.start.index);
                const b = Math.max(upper.end.index, lower.end.index);
                const ratio =
                    (lineValueAt(upper, b) - lineValueAt(lower, b)) /
                    (lineValueAt(upper, a) - lineValueAt(lower, a));
                expect(ratio <= CONVERGING_MAX_WIDTH_RATIO, `n=${n}`).toBe(
                    q.id === 'pennant'
                );
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(0);
    });
});

describe('an outside reversal bar keeps the swing it takes out', () => {
    // The left-rim bar also made a new low inside a pullback; it takes out
    // the swing high before it, so it is the swing high and the pullback's
    // earlier low is the swing low.
    // One bar short of the fixture's end: its last bar closes under the
    // handle low and fails the cup (see the next block).
    it('the daily cup keeps that bar as its left rim (222.35 / 208.33 before scaling)', () => {
        const run = runProductionPipeline(
            cupOutsideBarRim.bars.slice(0, -1),
            cupOutsideBarRim.timeframe
        );
        const cup = run.qualified.find(q => q.id === 'cup_and_handle');
        if (cup === undefined || cup.shape.kind !== 'cup')
            throw new Error('no cup');
        expect(cup.shape.leftRim.price).toBeCloseTo(222.35 * SCALE, 3);
        expect(cup.shape.rightRim.price).toBeCloseTo(208.33 * SCALE, 3);
    });
});

describe('a pattern whose last close is already past its invalidation level is not offered', () => {
    // 2026-10-08 A/B: this cup was listed and drawn as `forming` with the
    // last close (178.45 before scaling) under its handle low (180.81), the
    // printed invalidation level — 0.22 ATR under, inside the 0.25 ATR slack
    // the spent check used to allow.
    const c = cupOutsideBarRim;
    const cupOf = (bars: typeof c.bars) =>
        runProductionPipeline(bars, c.timeframe);

    it('one bar earlier (last close above the handle low) the cup is listed as forming', () => {
        const run = cupOf(c.bars.slice(0, -1));
        const cup = run.qualified.find(q => q.id === 'cup_and_handle');
        if (cup === undefined) throw new Error('no cup');
        const g = computeCandidateGeometry(cup, run.bars, run.atr);
        if (g === null || g.direction !== 'up') throw new Error('not up');
        expect(g.invalidationLevel).toBeCloseTo(180.81 * SCALE, 3);
        expect(statusOf(run, 'cup_and_handle')).toBe('forming');
    });

    it('on the last bar the cup is neither listed nor drawn, and no other card or overlay breaks an invariant', () => {
        const run = cupOf(c.bars);
        const last = c.bars[c.bars.length - 1].close;
        expect(last).toBeLessThan(180.81 * SCALE);
        expect(run.qualified.map(q => q.id)).not.toContain('cup_and_handle');
        expect(run.overlays.some(o => o.id.includes('cup_and_handle'))).toBe(
            false
        );
        expect(run.section).not.toContain('cup_and_handle');
        expect(invariantViolations(run)).toEqual([]);
    });
});
