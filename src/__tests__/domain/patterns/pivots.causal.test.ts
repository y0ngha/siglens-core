import { describe, expect, it } from 'vitest';
import type { Bar } from '@/domain/types';
import { extractPivots } from '@/domain/patterns/pivots';
import { calculateATR } from '@/domain/indicators/atr';
import { patternOverlayId } from '@/domain/overlays/patternOverlays';
import {
    geometryOf,
    runProductionPipeline,
} from '@/__tests__/domain/patterns/scenarios/harness';
import { chartFixture } from '@/__tests__/domain/patterns/fixtures/chartFixture';
import hourlyA from '@/__tests__/domain/patterns/fixtures/charts/hourly-level-oscillation-a.json';
import hourlyB from '@/__tests__/domain/patterns/fixtures/charts/hourly-level-oscillation-b.json';
import daily from '@/__tests__/domain/patterns/fixtures/charts/daily-level-oscillation.json';

/**
 * Causal pivots (2026-10-08 replay sweep). The three fixtures are real
 * charts (anonymized, see `chartFixture`) where one more bar used to change
 * a drawn pattern's height, invalidation or target under the same overlay id
 * with no new pivot: the zigzag re-ran all history at the latest ATR, which
 * drifts every bar.
 */
const CASES = {
    hourlyA: chartFixture(hourlyA),
    hourlyB: chartFixture(hourlyB),
    daily: chartFixture(daily),
};

const pivotsUpTo = (bars: readonly Bar[], n: number) => {
    const head = bars.slice(0, n);
    return extractPivots(head, calculateATR(head), { onePivotPerBar: true });
};

describe('extractPivots with the per-bar ATR series', () => {
    it.each(Object.entries(CASES))(
        '%s: every pivot confirmed by bar n is unchanged when bars n+1… are appended',
        (_, c) => {
            const full = pivotsUpTo(c.bars, c.bars.length);
            let checked = 0;
            for (let n = c.bars.length - 60; n < c.bars.length; n++) {
                const before = pivotsUpTo(c.bars, n);
                expect(full.slice(0, before.length)).toEqual(before);
                checked += before.length;
            }
            expect(checked).toBeGreaterThan(0);
        }
    );

    it('a single latest-ATR threshold does not have that property on the same bars (why the series is needed)', () => {
        const { bars } = CASES.daily;
        const lastAtr = (n: number): number =>
            calculateATR(bars.slice(0, n)).at(-1) as number;
        const changed = Array.from({ length: 60 }, (_, k) => {
            const n = bars.length - 60 + k;
            const opts = { onePivotPerBar: true };
            const before = extractPivots(bars.slice(0, n), lastAtr(n), opts);
            const after = extractPivots(
                bars.slice(0, n + 1),
                lastAtr(n + 1),
                opts
            );
            return (
                JSON.stringify(after.slice(0, before.length)) !==
                JSON.stringify(before)
            );
        }).filter(Boolean).length;
        expect(changed).toBeGreaterThan(0);
    });

    it('never puts a high and a low pivot on one bar', () => {
        for (const c of Object.values(CASES)) {
            const pivots = pivotsUpTo(c.bars, c.bars.length);
            const indices = pivots.map(p => p.index);
            expect(new Set(indices).size).toBe(indices.length);
        }
    });
});

describe('replaying the last 40 bars: a drawn pattern keeps its levels while no new pivot confirms', () => {
    it('height and invalidation never change under one overlay id between two bars with the same pivots', () => {
        let compared = 0;
        for (const c of Object.values(CASES)) {
            const tf = c.timeframe;
            for (let n = c.bars.length - 40; n < c.bars.length; n++) {
                if (
                    pivotsUpTo(c.bars, n + 1).length !==
                    pivotsUpTo(c.bars, n).length
                )
                    continue;
                const a = runProductionPipeline(c.bars.slice(0, n), tf);
                const b = runProductionPipeline(c.bars.slice(0, n + 1), tf);
                for (const p of a.qualified) {
                    const id = patternOverlayId(p, a.bars);
                    const q = b.qualified.find(
                        x => patternOverlayId(x, b.bars) === id
                    );
                    if (q === undefined) continue;
                    const ga = geometryOf(a, p);
                    const gb = geometryOf(b, q);
                    expect(gb.height, `${id} at ${n}`).toBe(ga.height);
                    if (ga.direction !== null && gb.direction !== null)
                        expect(gb.invalidationLevel).toBe(ga.invalidationLevel);
                    compared++;
                }
            }
        }
        expect(compared).toBeGreaterThan(0);
    });
});
