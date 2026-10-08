import { describe, expect, it } from 'vitest';
import type { Bar, QualifiedPattern } from '@/domain/types';
import { qualifyPatterns } from '@/domain/patterns/qualify/qualifyPatterns';
import { computeCandidateGeometry } from '@/domain/patterns/patternGeometry';
import { BOUNDARY_CONTAINMENT_ATR } from '@/domain/patterns/constants';
import {
    computePatternTargets,
    printedPatternGeometry,
} from '@/domain/analysis/patternTargets';
import {
    buildPatternOverlayCandidates,
    patternOverlayId,
} from '@/domain/overlays/patternOverlays';
import { makeBars } from '@/__tests__/domain/patterns/helpers';
import hsTextbook from '@/__tests__/domain/patterns/fixtures/hs-textbook.json';
import doubleTop from '@/__tests__/domain/patterns/fixtures/double-top.json';
import ascendingTriangle from '@/__tests__/domain/patterns/fixtures/ascending-triangle.json';
import bullFlag from '@/__tests__/domain/patterns/fixtures/bull-flag.json';
import cupAndHandle from '@/__tests__/domain/patterns/fixtures/cup-and-handle.json';

interface Fixture {
    atr: number;
    bars: Bar[];
}
/** Prompt price precision the fixtures are printed at. */
const DP = 2;
const FIXTURES = [
    hsTextbook,
    doubleTop,
    ascendingTriangle,
    bullFlag,
    cupAndHandle,
] as Fixture[];
const qualified = (f: Fixture): QualifiedPattern[] =>
    qualifyPatterns([], f.bars, f.atr, '1Day').qualified;
const build = (f: Fixture) =>
    buildPatternOverlayCandidates(qualified(f), f.bars, f.atr, DP);
const find = (f: Fixture, id: string) => {
    const c = build(f).find(o => o.id.startsWith(`pattern:${id}:`));
    if (!c) throw new Error(`no ${id} overlay`);
    return c;
};

describe('buildPatternOverlayCandidates', () => {
    it('head & shoulders: 5-pivot polyline + a sloped neckline ending at the breakout bar, no breakout level, LS/H/RS labels', () => {
        const f = hsTextbook as Fixture;
        const hs = find(f, 'head_and_shoulders');
        expect(hs.kind).toBe('pattern');
        expect(hs.skill).toBe('head-and-shoulders');
        expect(hs.segments).toHaveLength(5);
        const neckline = hs.segments.find(s => s.role === 'neckline')!;
        expect(neckline.style).toBe('dashed');
        // Not broken yet → the breakout is read (and the neckline ends) at the last bar.
        expect(neckline.to.time).toBe(f.bars[f.bars.length - 1].time);
        const [q] = qualified(f);
        const g = computeCandidateGeometry(q, f.bars, f.atr)!;
        expect(g.direction).toBe('down');
        // The drawn neckline ends exactly at the printed breakout level.
        expect(neckline.to.price).toBeCloseTo(
            g.direction === null ? NaN : g.breakoutLevel,
            10
        );
        expect(hs.levels.map(l => l.label)).toEqual(['invalidation', 'target']);
        expect(hs.labels.map(l => l.text)).toEqual(['LS', 'H', 'RS']);
    });

    it('double top: polyline through the matched window and a breakout level first', () => {
        const dt = find(doubleTop as Fixture, 'double_top');
        expect(dt.segments.length).toBeGreaterThanOrEqual(2);
        expect(dt.levels[0].label).toBe('breakout');
    });

    it('triangle: an upper and a lower boundary drawn touch to touch, no candle beyond either by more than ε', () => {
        const f = ascendingTriangle as Fixture;
        const tri = find(f, 'ascending_triangle');
        expect(tri.segments.map(s => s.role).toSorted()).toEqual([
            'boundary_lower',
            'boundary_upper',
        ]);
        let checked = 0;
        for (const s of tri.segments) {
            const from = f.bars.findIndex(b => b.time === s.from.time);
            const to = f.bars.findIndex(b => b.time === s.to.time);
            for (let i = from; i <= to; i++) {
                const v =
                    s.from.price +
                    ((s.to.price - s.from.price) * (i - from)) / (to - from);
                const poke =
                    s.role === 'boundary_upper'
                        ? f.bars[i].high - v
                        : v - f.bars[i].low;
                expect(poke).toBeLessThanOrEqual(
                    BOUNDARY_CONTAINMENT_ATR * f.atr + 1e-9
                );
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(20);
    });

    it('flag: pole plus two channel LINES (not a horizontal box)', () => {
        const flag = find(bullFlag as Fixture, 'bull_flag');
        expect(flag.segments.map(s => s.role).toSorted()).toEqual([
            'channel_lower',
            'channel_upper',
            'pole',
        ]);
        expect(flag.levels.map(l => l.label)).toEqual([
            'invalidation',
            'target',
        ]);
    });

    it('cup & handle: left rim → bottom → right rim → handle low, with a breakout level', () => {
        const cup = find(cupAndHandle as Fixture, 'cup_and_handle');
        expect(cup.segments).toHaveLength(3);
        expect(cup.levels[0].label).toBe('breakout');
    });

    it('every point sits on a real bar time and segments run forward in time', () => {
        let checked = 0;
        for (const f of FIXTURES) {
            const times = new Set(f.bars.map(b => b.time));
            for (const c of build(f)) {
                for (const s of c.segments) {
                    expect(times.has(s.from.time)).toBe(true);
                    expect(times.has(s.to.time)).toBe(true);
                    expect(s.to.time).toBeGreaterThan(s.from.time);
                    checked++;
                }
                for (const l of c.levels)
                    expect(times.has(l.fromTime)).toBe(true);
            }
        }
        expect(checked).toBeGreaterThan(10);
    });

    it('every family draws its printed invalidation and measured target, from the pattern start', () => {
        let checked = 0;
        for (const f of FIXTURES) {
            for (const q of qualified(f)) {
                const g = computeCandidateGeometry(q, f.bars, f.atr);
                const c = buildPatternOverlayCandidates(
                    [q],
                    f.bars,
                    f.atr,
                    DP
                )[0];
                if (g === null || g.direction === null) continue;
                checked++;
                const byLabel = new Map(c.levels.map(l => [l.label, l]));
                const p = printedPatternGeometry(g, DP);
                expect(byLabel.get('invalidation')?.price).toBe(
                    p.invalidationLevel
                );
                expect(byLabel.get('target')?.price).toBe(
                    computePatternTargets(
                        p.breakoutLevel,
                        p.extremeLevel,
                        p.direction
                    ).measuredTarget
                );
                for (const l of c.levels)
                    expect(l.fromTime).toBe(f.bars[q.startIndex].time);
            }
        }
        // One per fixture family — never a pass with zero checks.
        expect(checked).toBe(5);
    });

    it('id is deterministic and matches patternOverlayId', () => {
        const f = doubleTop as Fixture;
        const q = qualified(f);
        expect(
            buildPatternOverlayCandidates(q, f.bars, f.atr, DP).map(c => c.id)
        ).toEqual(q.map(p => patternOverlayId(p, f.bars)));
    });

    it('skips a pattern without geometry (boundaries crossed by the last bar)', () => {
        const bars = makeBars(Array.from({ length: 10 }, () => 100));
        const crossed: QualifiedPattern = {
            id: 'symmetrical_triangle',
            startIndex: 1,
            endIndex: 4,
            pivots: [],
            shape: {
                kind: 'trendline',
                upper: {
                    start: { index: 1, price: 20 },
                    end: { index: 3, price: 18 },
                    touches: [],
                },
                lower: {
                    start: { index: 2, price: 10 },
                    end: { index: 4, price: 12 },
                    touches: [],
                },
                direction: 'up',
            },
            touches: 4,
        };
        expect(buildPatternOverlayCandidates([crossed], bars, 1, DP)).toEqual(
            []
        );
    });

    it('an undirected rectangle draws its two boundaries and no level', () => {
        const bars = makeBars(Array.from({ length: 10 }, () => 15));
        const [c] = buildPatternOverlayCandidates(
            [
                {
                    id: 'rectangle',
                    startIndex: 1,
                    endIndex: 6,
                    pivots: [],
                    shape: {
                        kind: 'trendline',
                        upper: {
                            start: { index: 1, price: 20 },
                            end: { index: 5, price: 20 },
                            touches: [],
                        },
                        lower: {
                            start: { index: 2, price: 10 },
                            end: { index: 6, price: 10 },
                            touches: [],
                        },
                        direction: null,
                    },
                    touches: 4,
                },
            ],
            bars,
            1,
            DP
        );
        expect(c.segments.map(s => s.role)).toEqual([
            'boundary_upper',
            'boundary_lower',
        ]);
        expect(c.levels).toEqual([]);
    });

    it('rounding: the drawing is the sampled arc, one leg per pair of samples', () => {
        const bars = makeBars(Array.from({ length: 10 }, () => 15));
        const arc = [0, 3, 6, 9].map(index => ({
            index,
            price: 10 + (index - 4.5) ** 2 / 4,
        }));
        const [c] = buildPatternOverlayCandidates(
            [
                {
                    id: 'rounding_bottom',
                    startIndex: 0,
                    endIndex: 9,
                    pivots: [],
                    shape: {
                        kind: 'rounding',
                        leftRim: { index: 0, price: 16, kind: 'high' },
                        rightRim: { index: 9, price: 16, kind: 'high' },
                        extreme: { index: 4, price: 10 },
                        invalidation: { index: 4, price: 10 },
                        arc,
                    },
                    touches: 2,
                },
            ],
            bars,
            1,
            DP
        );
        expect(c.segments.map(s => [s.from.price, s.to.price])).toEqual(
            arc.slice(1).map((p, i) => [arc[i].price, p.price])
        );
        expect(c.levels.map(l => l.label)).toEqual([
            'breakout',
            'invalidation',
            'target',
        ]);
    });
});
