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
import { calculateATR } from '@/domain/indicators/atr';
import {
    BOUNDARY_CONTAINMENT_ATR,
    BOUNDARY_MIN_TOUCHES,
    BROADENING_MIN_SIDE_TOUCHES,
    BROADENING_MIN_TOTAL_TOUCHES,
    RECTANGLE_MIN_TOUCHES,
    WEDGE_MIN_TOUCHES,
} from '@/domain/patterns/constants';
import {
    buildPatternOverlayCandidates,
    patternOverlayId,
} from '@/domain/overlays/patternOverlays';
import { formatChartPatternCandidatesSection } from '@/domain/analysis/chartPatternCandidatesSection';
import type { PriceQuoting } from '@/domain/analysis/promptFormat';

const QUOTING: PriceQuoting = { dp: 2, krxTick: null };

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

/**
 * Screener → qualifier → overlays → prompt section, exactly as
 * `buildAnalysisPrompt` chains them. `atr` pins every tolerance; pass
 * `atrSeries` (as production does) for causal pivot thresholds, or omit it
 * to pin those to `atr` too.
 */
export function runPipeline(
    bars: readonly Bar[],
    atr: number,
    timeframe: Timeframe = '1Day',
    atrSeries?: readonly (number | null)[]
): PipelineRun {
    const loose = screenChartPatterns(bars, atr, atrSeries);
    const { qualified, shapeHints } = qualifyPatterns(
        loose,
        bars,
        atr,
        timeframe,
        atrSeries
    );
    const overlays = buildPatternOverlayCandidates(
        qualified,
        bars,
        atr,
        QUOTING
    );
    const section = formatChartPatternCandidatesSection(
        qualified,
        bars,
        atr,
        QUOTING,
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

/** `forming` / `broken` / `failed breakout` as the prompt block prints it, or `null` without a block. */
export function statusOf(run: PipelineRun, id: ChartPatternId): string | null {
    const match = new RegExp(
        `### ${id} \\((forming|broken|failed breakout)\\)`
    ).exec(run.section);
    return match === null ? null : match[1];
}

const LINE_ROLES = new Set([
    'boundary_upper',
    'boundary_lower',
    'channel_upper',
    'channel_lower',
]);

/**
 * The invariants every run must hold, whatever was drawn: no drawn boundary or channel line is crossed by a candle
 * beyond ε over its solid touch-to-touch span, a neckline holds between its
 * two troughs,
 * each line family meets its touch count, and no two drawn patterns with
 * opposite directions share bars, and every printed boundary value lies on
 * a drawn line. Returns readable violations (empty = ok).
 */
export function invariantViolations(run: PipelineRun): string[] {
    const slack = BOUNDARY_CONTAINMENT_ATR * run.atr + 1e-9;
    const indexOf = (time: number): number =>
        run.bars.findIndex(b => b.time === time);
    const violations: string[] = [];

    for (const overlay of run.overlays) {
        // Only the solid touch-to-touch span bounds the bars; the dashed
        // continuation to the reading bar is where a breakout happens.
        const bounding = overlay.segments.filter(
            x => LINE_ROLES.has(x.role) && x.style === 'solid'
        );
        for (const s of bounding) {
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

    violations.push(...printedLevelsOffLine(run));

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

/** A segment of `role` ending at bar `index` at `price` (within float noise). */
function endsOn(
    overlay: OverlayCandidate,
    role: string,
    time: number,
    price: number
): boolean {
    return overlay.segments.some(
        s =>
            s.role === role &&
            s.to.time === time &&
            Math.abs(s.to.price - price) <= 1e-9
    );
}

/**
 * Every boundary value the prompt block prints lies on a drawn line, at the
 * bar it is read at: the breakout side (both sides when undirected) of a
 * boundary pair and a flag's breakout channel at the last bar, a flag's
 * other channel line at the flag's end (its key point), a neckline at its
 * break bar.
 */
function printedLevelsOffLine(run: PipelineRun): string[] {
    const lastTime = run.bars[run.bars.length - 1].time;
    return run.qualified.flatMap(q => {
        const overlay = run.overlays.find(
            o => o.id === patternOverlayId(q, run.bars)
        );
        if (overlay === undefined) return [];
        const g = geometryOf(run, q);
        const { shape } = q;
        const expected: [string, number, number][] = [];
        if (shape.kind === 'trendline') {
            if (g.direction === null) {
                expected.push(['boundary_upper', lastTime, g.upperLevel]);
                expected.push(['boundary_lower', lastTime, g.lowerLevel]);
            } else {
                expected.push([
                    g.direction === 'up' ? 'boundary_upper' : 'boundary_lower',
                    lastTime,
                    g.breakoutLevel,
                ]);
            }
        }
        if (shape.kind === 'flag' && g.direction !== null) {
            const up = g.direction === 'up';
            expected.push([
                up ? 'channel_upper' : 'channel_lower',
                lastTime,
                g.breakoutLevel,
            ]);
            // The other channel line's printed key point, at the flag's end.
            expected.push([
                up ? 'channel_lower' : 'channel_upper',
                run.bars[q.endIndex].time,
                lineValueAt(up ? shape.lower : shape.upper, q.endIndex),
            ]);
        }
        if (shape.kind === 'head_and_shoulders' && g.direction !== null)
            expected.push([
                'neckline',
                run.bars[shape.breakoutIndex].time,
                g.breakoutLevel,
            ]);
        return expected
            .filter(
                ([role, time, price]) => !endsOn(overlay, role, time, price)
            )
            .map(([role, , price]) => `${q.id} ${role} misses ${price}`);
    });
}

/** {@link runPipeline} the way production runs it: the latest ATR and the per-bar series it came from. */
export function runProductionPipeline(
    bars: readonly Bar[],
    timeframe: Timeframe
): PipelineRun {
    const series = calculateATR(bars);
    const atr = series[series.length - 1];
    if (atr === null || atr === undefined) throw new Error('ATR not ready');
    return runPipeline(bars, atr, timeframe, series);
}
