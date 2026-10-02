import { describe, expect, it } from 'vitest';
import { makeHLBars } from '@/__tests__/domain/patterns/helpers';
import type { Bar } from '@/domain/types';
import { screenChartPatterns } from '@/domain/patterns/screenChartPatterns';
import { computeCandidateGeometry } from '@/domain/patterns/patternGeometry';
import {
    computePatternTargets,
    printedPatternGeometry,
} from '@/domain/analysis/patternTargets';
import {
    buildPatternOverlayCandidates,
    patternOverlayId,
} from '@/domain/overlays/patternOverlays';
import hsTextbook from '@/__tests__/domain/patterns/fixtures/hs-textbook.json';
import doubleTop from '@/__tests__/domain/patterns/fixtures/double-top.json';
import ascendingTriangle from '@/__tests__/domain/patterns/fixtures/ascending-triangle.json';
import bullFlag from '@/__tests__/domain/patterns/fixtures/bull-flag.json';
import cupAndHandle from '@/__tests__/domain/patterns/fixtures/cup-and-handle.json';

interface Fixture {
    atr: number;
    bars: Bar[];
}
const build = (f: Fixture) =>
    buildPatternOverlayCandidates(
        screenChartPatterns(f.bars, f.atr),
        f.bars,
        f.atr,
        DP
    );
/** Prompt price precision the fixtures are printed at. */
const DP = 2;
const barTimes = (f: Fixture) => new Set(f.bars.map(b => b.time));

describe('buildPatternOverlayCandidates', () => {
    it('head & shoulders: 5-pivot polyline + a sloped neckline segment, no breakout level, LS/H/RS labels', () => {
        const f = hsTextbook as Fixture;
        const hs = build(f).find(c =>
            c.id.startsWith('pattern:head_and_shoulders:')
        )!;
        expect(hs.kind).toBe('pattern');
        expect(hs.skill).toBe('head-and-shoulders');
        // 4 polyline legs through the 5 pivots + 1 neckline segment.
        expect(hs.segments).toHaveLength(5);
        const neckline = hs.segments.find(s => s.role === 'neckline')!;
        expect(neckline).toBeDefined();
        expect(neckline.style).toBe('dashed');
        expect(neckline.pane).toBe('price');
        // Extended to the chart's right edge.
        expect(neckline.to.time).toBe(f.bars[f.bars.length - 1].time);
        // No horizontal breakout level for H&S — the neckline segment replaces
        // it; only the invalidation and target levels are horizontal.
        expect(hs.levels.map(l => l.label)).toEqual(['invalidation', 'target']);
        expect(hs.labels.map(l => l.text)).toEqual(['LS', 'H', 'RS']);
    });

    it('double top: polyline through the matched window and a neckline level', () => {
        const dt = build(doubleTop as Fixture).find(c =>
            c.id.startsWith('pattern:double_top:')
        )!;
        expect(dt.segments.length).toBeGreaterThanOrEqual(2);
        expect(dt.levels[0].label).toBe('breakout');
    });

    it('triangle: exactly an upper and a lower boundary', () => {
        const tri = build(ascendingTriangle as Fixture).find(c =>
            c.id.includes('ascending_triangle')
        )!;
        expect(tri.segments.map(s => s.role).toSorted()).toEqual([
            'boundary_lower',
            'boundary_upper',
        ]);
    });

    it('flag: pole plus two channel edges from geometry', () => {
        const flag = build(bullFlag as Fixture).find(c =>
            c.id.includes('bull_flag')
        )!;
        expect(flag.segments.map(s => s.role).toSorted()).toEqual([
            'channel_lower',
            'channel_upper',
            'pole',
        ]);
    });

    it('every point sits on a real bar time and segments run forward in time', () => {
        for (const f of [
            hsTextbook,
            doubleTop,
            ascendingTriangle,
            bullFlag,
            cupAndHandle,
        ] as Fixture[]) {
            const times = barTimes(f);
            for (const c of build(f)) {
                for (const s of c.segments) {
                    expect(times.has(s.from.time)).toBe(true);
                    expect(times.has(s.to.time)).toBe(true);
                    expect(s.to.time).toBeGreaterThan(s.from.time);
                }
                for (const l of c.levels)
                    expect(times.has(l.fromTime)).toBe(true);
            }
        }
    });

    it('every family draws its printed invalidation and measured target, from before the last bar', () => {
        let checked = 0;
        for (const f of [
            hsTextbook,
            doubleTop,
            ascendingTriangle,
            bullFlag,
            cupAndHandle,
        ] as Fixture[]) {
            const screened = screenChartPatterns(f.bars, f.atr);
            const lastTime = f.bars[f.bars.length - 1].time;
            for (const s of screened) {
                const g = computeCandidateGeometry(s, f.bars, f.atr);
                const c = buildPatternOverlayCandidates(
                    [s],
                    f.bars,
                    f.atr,
                    DP
                )[0];
                if (!g || !c) continue;
                checked++;
                const byLabel = new Map(c.levels.map(l => [l.label, l]));
                // The exact numbers the prompt block prints.
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
                    expect(l.fromTime).toBeLessThan(lastTime);
            }
        }
        // One per fixture family at least — never a pass with zero checks.
        expect(checked).toBeGreaterThanOrEqual(5);
    });

    it('id is deterministic and matches patternOverlayId', () => {
        const f = doubleTop as Fixture;
        const screened = screenChartPatterns(f.bars, f.atr);
        const out = buildPatternOverlayCandidates(screened, f.bars, f.atr, DP);
        expect(out.map(c => c.id)).toEqual(
            screened
                .filter(s =>
                    out.some(o => o.id === patternOverlayId(s, f.bars))
                )
                .map(s => patternOverlayId(s, f.bars))
        );
    });

    it('skips a candidate with no geometry (hand-built, no pivots)', () => {
        const f = doubleTop as Fixture;
        expect(
            buildPatternOverlayCandidates(
                [{ id: 'double_top', startIndex: 1, endIndex: 5 }],
                f.bars,
                f.atr,
                DP
            )
        ).toEqual([]);
    });

    it('channels and broadening formations draw two regression boundaries', () => {
        // Rising parallel channel: highs 104/108/112, lows 100/104/108.
        const bars = makeHLBars([
            [102, 100],
            [104, 102],
            [102, 100.5],
            [106, 104],
            [108, 106],
            [106, 104.5],
            [110, 108],
            [112, 110],
            [110, 108.5],
            [111, 109],
        ]).map((b, i) => ({ ...b, time: 1000 + i }));
        const pivots = [
            { index: 1, price: 104, kind: 'high' as const },
            { index: 2, price: 100.5, kind: 'low' as const },
            { index: 4, price: 108, kind: 'high' as const },
            { index: 5, price: 104.5, kind: 'low' as const },
            { index: 7, price: 112, kind: 'high' as const },
            { index: 8, price: 108.5, kind: 'low' as const },
        ];
        for (const id of [
            'ascending_channel',
            'broadening_formation',
        ] as const) {
            const [c] = buildPatternOverlayCandidates(
                [{ id, startIndex: 1, endIndex: 8, pivots }],
                bars,
                1,
                DP
            );
            expect(c?.segments.map(s => s.role).toSorted()).toEqual([
                'boundary_lower',
                'boundary_upper',
            ]);
        }
    });

    it('skips a candidate whose geometry exists but has fewer than 2 pivots inside its range', () => {
        const f = doubleTop as Fixture;
        const [hit] = screenChartPatterns(f.bars, f.atr).filter(
            c => c.id === 'double_top'
        );
        // Same pivots (geometry still computes), but the range now covers one pivot.
        const firstPivot = hit.pivots![0].index;
        const narrowed = {
            ...hit,
            startIndex: firstPivot,
            endIndex: firstPivot,
        };
        expect(
            computeCandidateGeometry(narrowed, f.bars, f.atr)
        ).not.toBeNull();
        expect(
            buildPatternOverlayCandidates([narrowed], f.bars, f.atr, DP)
        ).toEqual([]);
    });
});
