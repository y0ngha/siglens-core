import type {
    Bar,
    ChartPatternId,
    OverlayCandidate,
    QualifiedPattern,
    QualifiedPatternGeometry,
    Timeframe,
} from '@/domain/types';
import { screenChartPatterns } from '@/domain/patterns/screenChartPatterns';
import { qualifyPatterns } from '@/domain/patterns/qualify/qualifyPatterns';
import { computeCandidateGeometry } from '@/domain/patterns/patternGeometry';
import { lineValueAt } from '@/domain/patterns/boundaryLines';
import {
    BOUNDARY_CONTAINMENT_ATR,
    BOUNDARY_MIN_TOUCHES,
    BROADENING_MIN_SIDE_TOUCHES,
    BROADENING_MIN_TOTAL_TOUCHES,
    RECTANGLE_MIN_TOUCHES,
    WEDGE_MIN_TOUCHES,
} from '@/domain/patterns/constants';
import { buildPatternOverlayCandidates } from '@/domain/overlays/patternOverlays';
import { formatChartPatternCandidatesSection } from '@/domain/analysis/chartPatternCandidatesSection';

/** Everything the production pipeline derives from one bar series (prompt.ts order). */
export interface PipelineRun {
    bars: readonly Bar[];
    atr: number;
    loose: ChartPatternId[];
    qualified: QualifiedPattern[];
    shapeHints: ChartPatternId[];
    overlays: OverlayCandidate[];
    section: string;
}

/** Screener → qualifier → overlays → prompt section, exactly as `buildAnalysisPrompt` chains them. */
export function runPipeline(
    bars: readonly Bar[],
    atr: number,
    timeframe: Timeframe = '1Day'
): PipelineRun {
    const loose = screenChartPatterns(bars, atr);
    const { qualified, shapeHints } = qualifyPatterns(
        loose,
        bars,
        atr,
        timeframe
    );
    const overlays = buildPatternOverlayCandidates(qualified, bars, atr, 2);
    const section = formatChartPatternCandidatesSection(
        qualified,
        shapeHints,
        bars,
        atr,
        2,
        timeframe,
        new Set(overlays.map(o => o.id))
    );
    return {
        bars,
        atr,
        loose: loose.map(c => c.id),
        qualified,
        shapeHints,
        overlays,
        section,
    };
}

export function geometryOf(
    run: PipelineRun,
    pattern: QualifiedPattern
): QualifiedPatternGeometry {
    const g = computeCandidateGeometry(pattern, run.bars, run.atr);
    if (g === null) throw new Error(`${pattern.id} has no geometry`);
    return g;
}

/** `forming` / `broken` as the prompt block prints it, or `null` without a block. */
export function statusOf(run: PipelineRun, id: ChartPatternId): string | null {
    const match = new RegExp(`### ${id} \\((forming|broken)\\)`).exec(
        run.section
    );
    return match === null ? null : match[1];
}

const LINE_ROLES = new Set([
    'boundary_upper',
    'boundary_lower',
    'channel_upper',
    'channel_lower',
]);

/**
 * The invariants every run must hold, whatever was drawn (spec 2026-10-07
 * §2.2, §2.5): no drawn boundary or channel line is crossed by a candle
 * beyond ε over its drawn span, a neckline holds between its two troughs,
 * each line family meets its touch count, and no two drawn patterns with
 * opposite directions share bars. Returns readable violations (empty = ok).
 */
export function invariantViolations(run: PipelineRun): string[] {
    const slack = BOUNDARY_CONTAINMENT_ATR * run.atr + 1e-9;
    const indexOf = (time: number): number =>
        run.bars.findIndex(b => b.time === time);
    const violations: string[] = [];

    for (const overlay of run.overlays) {
        for (const s of overlay.segments.filter(x => LINE_ROLES.has(x.role))) {
            const from = indexOf(s.from.time);
            const to = indexOf(s.to.time);
            for (let i = from; i <= to; i++) {
                const v =
                    s.from.price +
                    ((s.to.price - s.from.price) * (i - from)) / (to - from);
                const poke = s.role.endsWith('upper')
                    ? run.bars[i].high - v
                    : v - run.bars[i].low;
                if (poke > slack)
                    violations.push(
                        `${overlay.id} ${s.role} crossed at bar ${i} by ${poke.toFixed(3)}`
                    );
            }
        }
    }

    for (const q of run.qualified) {
        const { shape } = q;
        if (shape.kind === 'head_and_shoulders') {
            const regular = q.pivots[0].kind === 'high';
            for (let i = q.pivots[1].index; i <= q.pivots[3].index; i++) {
                const v = lineValueAt(shape.neckline, i);
                const poke = regular
                    ? v - run.bars[i].low
                    : run.bars[i].high - v;
                if (poke > slack)
                    violations.push(`${q.id} neckline crossed at bar ${i}`);
            }
        }
        if (shape.kind === 'trendline' || shape.kind === 'flag') {
            const u = shape.upper.touches.length;
            const l = shape.lower.touches.length;
            const need =
                q.id === 'ascending_wedge' || q.id === 'descending_wedge'
                    ? WEDGE_MIN_TOUCHES
                    : q.id === 'rectangle'
                      ? RECTANGLE_MIN_TOUCHES
                      : BOUNDARY_MIN_TOUCHES;
            const broadeningOk =
                u + l >= BROADENING_MIN_TOTAL_TOUCHES &&
                Math.max(u, l) >= BROADENING_MIN_SIDE_TOUCHES;
            const ok =
                q.id === 'broadening_formation'
                    ? broadeningOk
                    : u >= need && l >= need;
            if (!ok) violations.push(`${q.id} touches ${u}/${l}`);
        }
    }

    const directions = run.qualified.map(q => ({
        q,
        dir: geometryOf(run, q).direction,
    }));
    for (const a of directions) {
        for (const b of directions) {
            const opposite =
                a.dir !== null && b.dir !== null && a.dir !== b.dir;
            const share =
                Math.min(a.q.endIndex, b.q.endIndex) >
                Math.max(a.q.startIndex, b.q.startIndex);
            if (a.q !== b.q && opposite && share)
                violations.push(`${a.q.id} and ${b.q.id} drawn opposite`);
        }
    }
    return violations;
}
