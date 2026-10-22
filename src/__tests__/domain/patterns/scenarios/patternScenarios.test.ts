import { describe, expect, it } from 'vitest';
import {
    LEVEL_TOLERANCE,
    MATURING_TRIANGLE_BARS,
    SCENARIOS,
    STABILITY_CASES,
    type LevelExpectation,
    type Scenario,
} from '@/__tests__/domain/patterns/scenarios/catalog';
import {
    geometryOf,
    invariantViolations,
    runPipeline,
    statusOf,
    type PipelineRun,
} from '@/__tests__/domain/patterns/scenarios/harness';
import {
    appendCloses,
    continueLeg,
} from '@/__tests__/domain/patterns/scenarios/builder';
import { patternOverlayId } from '@/domain/overlays/patternOverlays';
import { extractPivots } from '@/domain/patterns/pivots';
import type { ChartPatternId, QualifiedPatternGeometry } from '@/domain/types';

/**
 * Chart-pattern qualification scenario suite: every
 * ChartPatternId × {textbook, pierce, near-miss, stability, breakout,
 * failure, arbitration, intraday}. The table lives in `catalog.ts`; each row
 * runs the production chain (screener → qualifier → overlays → prompt
 * section) and checks the row's outcome plus the invariants every run must
 * hold (`invariantViolations`).
 */

const drawnIds = (run: PipelineRun): ChartPatternId[] =>
    run.qualified.map(q => q.id).toSorted((a, b) => a.localeCompare(b, 'en'));

function levelsOf(g: QualifiedPatternGeometry): Record<string, number> {
    return g.direction === null
        ? { upper: g.upperLevel, lower: g.lowerLevel }
        : {
              breakout: g.breakoutLevel,
              invalidation: g.invalidationLevel,
              target: g.measuredTarget,
          };
}

function expectLevels(
    g: QualifiedPatternGeometry,
    expected: LevelExpectation
): void {
    const actual = levelsOf(g);
    for (const [key, value] of Object.entries(expected)) {
        if (value === undefined) continue;
        const got = actual[key];
        expect(Number.isFinite(got), `${key} is a number`).toBe(true);
        expect(Math.abs(got - value), `${key} ${got}`).toBeLessThanOrEqual(
            LEVEL_TOLERANCE
        );
    }
}

function check(s: Scenario): void {
    const run = runPipeline(s.bars, s.atr, s.timeframe);
    expect(invariantViolations(run)).toEqual([]);
    const ids = drawnIds(run);
    const e = s.expect;
    if ('notDrawn' in e) {
        expect(ids).not.toContain(e.notDrawn);
        if (e.instead) expect(ids).toEqual([...e.instead]);
        return;
    }
    expect(ids).toContain(e.drawn);
    if (e.only) expect(ids).toEqual([...e.only]);
    const pattern = run.qualified.find(q => q.id === e.drawn)!;
    const g = geometryOf(run, pattern);
    if (e.direction !== undefined) expect(g.direction).toBe(e.direction);
    if (e.levels) expectLevels(g, e.levels);
    if (e.status) expect(statusOf(run, e.drawn)).toBe(e.status);
    // A drawn pattern prints its Candidate id; nothing else does.
    expect(run.section).toContain(
        `- Candidate id: ${patternOverlayId(pattern, run.bars)}`
    );
}

const label = (s: Scenario): string => `${s.pattern} | ${s.kind} | ${s.name}`;

describe('chart-pattern qualification scenarios', () => {
    it.each(SCENARIOS.map(s => [label(s), s] as const))('%s', (_, s) =>
        check(s)
    );

    it('covers every ChartPatternId with a textbook case', () => {
        const ids = new Set(
            SCENARIOS.filter(s => s.kind === 'a textbook').map(s => s.pattern)
        );
        expect(ids.size).toBe(22);
    });
});

describe('provisional invariance: extending the current leg moves nothing', () => {
    it.each(STABILITY_CASES.map(c => [c.pattern, c] as const))(
        '%s | d stability',
        (_, c) => {
            const before = runPipeline(c.bars, 1);
            const p0 = before.qualified.find(q => q.id === c.pattern);
            expect(p0, 'base series draws the pattern').toBeDefined();
            const extended = appendCloses(c.bars, continueLeg(c.bars, 3, 0.05));
            // Precondition: the extension confirms no new pivot — it only
            // moves the still-forming extreme.
            expect(extractPivots(extended, 1)).toEqual(
                extractPivots(c.bars, 1)
            );
            const after = runPipeline(extended, 1);
            const p1 = after.qualified.find(q => q.id === c.pattern);
            expect(p1, 'still drawn').toBeDefined();
            expect(patternOverlayId(p1!, extended)).toBe(
                patternOverlayId(p0!, c.bars)
            );
            expect(p1!.startIndex).toBe(p0!.startIndex);
            expect(p1!.pivots).toEqual(p0!.pivots);
            const { breakoutIndex: _b0, ...shape0 } = {
                breakoutIndex: 0,
                ...p0!.shape,
            };
            const { breakoutIndex: _b1, ...shape1 } = {
                breakoutIndex: 0,
                ...p1!.shape,
            };
            // The H&S breakout bar is read at the last bar until a break, so
            // only the neckline line itself is compared.
            expect(shape1).toEqual(shape0);
            const g0 = geometryOf(before, p0!);
            const g1 = geometryOf(after, p1!);
            if (g0.direction !== null && g1.direction !== null) {
                expect(g1.invalidationLevel).toBe(g0.invalidationLevel);
                expect(g1.invalidationIndex).toBe(g0.invalidationIndex);
            }
        }
    );
});

describe('a newly confirmed touch keeps the levels fixed', () => {
    // Eight pivots (4 + 4 touches); the two appended closes confirm the
    // fifth resistance touch as the ninth pivot.
    const before = runPipeline(MATURING_TRIANGLE_BARS, 1);
    const confirmed = appendCloses(MATURING_TRIANGLE_BARS, [108.6, 108]);
    const after = runPipeline(confirmed, 1);
    const p0 = before.qualified.find(q => q.id === 'ascending_triangle')!;
    const p1 = after.qualified.find(q => q.id === 'ascending_triangle')!;

    it('the appended bars confirm exactly one more pivot, a resistance touch', () => {
        const pivots0 = extractPivots(MATURING_TRIANGLE_BARS, 1);
        const pivots1 = extractPivots(confirmed, 1);
        expect(pivots0).toHaveLength(8);
        expect(pivots1.slice(0, 8)).toEqual(pivots0);
        expect(pivots1).toHaveLength(9);
        expect(pivots1[8].kind).toBe('high');
        expect(p1.touches).toBe(p0.touches + 1);
    });

    it('keeps the first touch, so the start and the overlay id stay', () => {
        expect(p1.startIndex).toBe(p0.startIndex);
        expect(patternOverlayId(p1, confirmed)).toBe(
            patternOverlayId(p0, MATURING_TRIANGLE_BARS)
        );
    });

    it('keeps the height, target and invalidation', () => {
        const g0 = geometryOf(before, p0);
        const g1 = geometryOf(after, p1);
        if (g0.direction === null || g1.direction === null)
            throw new Error('ascending triangle is directed');
        expect(g1.height).toBe(g0.height);
        expect(g1.measuredTarget).toBe(g0.measuredTarget);
        expect(g1.invalidationLevel).toBe(g0.invalidationLevel);
        expect(g1.invalidationIndex).toBe(g0.invalidationIndex);
    });
});
