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
 * opposite directions share bars, every printed boundary value lies on
 * a drawn line, every offered geometry has positive prices (breakout, targets,
 * undirected levels), a breakout on its pattern's side of the invalidation
 * and a printed breakout equal to the line at the shape's `breakoutIndex`.
 * Returns readable violations (empty = ok).
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
    violations.push(...geometryViolations(run));

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

/** `a` and `b` agree within float noise. */
const sameValue = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9;

/**
 * The break bar recomputed from OHLC, not read from the shape: the first bar
 * from `from` whose close is strictly beyond `levelAt` on the `sign` side, else
 * the last bar. Deliberately not `firstCloseBeyond`, so the invariant below
 * does not trust the code that stored `breakoutIndex`.
 */
function breakBarOf(
    bars: readonly Bar[],
    levelAt: (i: number) => number,
    sign: 1 | -1,
    from: number
): number {
    const last = bars.length - 1;
    return (
        Array.from({ length: Math.max(0, last - from + 1) }, (_, k) => from + k)
            .filter(i => sign * (bars[i].close - levelAt(i)) > 0)
            .at(0) ?? last
    );
}

/**
 * What every offered geometry must hold, whatever the family: prices are
 * positive, the breakout lies on the pattern's side of its invalidation, and
 * a boundary pair's, a flag's or a neckline's printed level is the line read
 * at the break bar recomputed from OHLC (never at a later bar), which is also
 * the shape's stored `breakoutIndex`.
 */
function geometryViolations(run: PipelineRun): string[] {
    return run.qualified.flatMap(q => {
        const g = geometryOf(run, q);
        const { shape } = q;
        if (g.direction === null) {
            if (shape.kind !== 'trendline') return [];
            const { upper, lower } = shape;
            const at = Math.min(
                breakBarOf(
                    run.bars,
                    i => lineValueAt(upper, i),
                    1,
                    q.endIndex + 1
                ),
                breakBarOf(
                    run.bars,
                    i => lineValueAt(lower, i),
                    -1,
                    q.endIndex + 1
                )
            );
            return [
                ...(g.upperLevel > 0 && g.lowerLevel > 0
                    ? []
                    : [`${q.id} non-positive boundary level`]),
                ...(shape.breakoutIndex === at &&
                sameValue(g.upperLevel, lineValueAt(upper, at)) &&
                sameValue(g.lowerLevel, lineValueAt(lower, at))
                    ? []
                    : [`${q.id} levels off the recomputed break bar`]),
            ];
        }
        const sign = g.direction === 'up' ? 1 : -1;
        const frozen =
            shape.kind === 'trendline' || shape.kind === 'flag'
                ? {
                      line: sign === 1 ? shape.upper : shape.lower,
                      from: q.endIndex + 1,
                      stored: shape.breakoutIndex,
                  }
                : shape.kind === 'head_and_shoulders'
                  ? {
                        line: shape.neckline,
                        from: q.pivots[q.pivots.length - 1].index + 1,
                        stored: shape.breakoutIndex,
                    }
                  : null;
        const at =
            frozen === null
                ? null
                : breakBarOf(
                      run.bars,
                      i => lineValueAt(frozen.line, i),
                      sign,
                      frozen.from
                  );
        return [
            ...(g.breakoutLevel > 0 &&
            g.measuredTarget > 0 &&
            g.conservativeTarget > 0
                ? []
                : [`${q.id} non-positive breakout or target`]),
            ...(sign * (g.breakoutLevel - g.invalidationLevel) > 0
                ? []
                : [`${q.id} breakout not past its invalidation`]),
            ...(frozen === null ||
            at === null ||
            (frozen.stored === at &&
                sameValue(g.breakoutLevel, lineValueAt(frozen.line, at)))
                ? []
                : [
                      `${q.id} breakout off the line at the recomputed break bar`,
                  ]),
        ];
    });
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
 * boundary pair and a flag's breakout channel at the break bar (the last bar
 * before a break, `breakoutIndex`), a flag's
 * other channel line at the flag's end (its key point), a neckline at its
 * break bar.
 */
function printedLevelsOffLine(run: PipelineRun): string[] {
    return run.qualified.flatMap(q => {
        const overlay = run.overlays.find(
            o => o.id === patternOverlayId(q, run.bars)
        );
        if (overlay === undefined) return [];
        const g = geometryOf(run, q);
        const { shape } = q;
        const expected: [string, number, number][] = [];
        if (shape.kind === 'trendline') {
            const breakTime = run.bars[shape.breakoutIndex].time;
            if (g.direction === null) {
                expected.push(['boundary_upper', breakTime, g.upperLevel]);
                expected.push(['boundary_lower', breakTime, g.lowerLevel]);
            } else {
                expected.push([
                    g.direction === 'up' ? 'boundary_upper' : 'boundary_lower',
                    breakTime,
                    g.breakoutLevel,
                ]);
            }
        }
        if (shape.kind === 'flag' && g.direction !== null) {
            const up = g.direction === 'up';
            expected.push([
                up ? 'channel_upper' : 'channel_lower',
                run.bars[shape.breakoutIndex].time,
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
