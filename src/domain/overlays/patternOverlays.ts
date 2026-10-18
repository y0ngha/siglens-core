import type {
    Bar,
    OverlayCandidate,
    OverlayLabel,
    OverlayLevel,
    OverlaySegment,
    PatternBreakoutDirection,
    PatternCandidate,
    PatternGeometry,
    PatternLine,
    PatternPoint,
    PivotPoint,
    QualifiedPattern,
    QualifiedPatternGeometry,
} from '@/domain/types';
import { computeCandidateGeometry } from '@/domain/patterns/patternGeometry';
import { lineValueAt } from '@/domain/patterns/boundaryLines';
import {
    OVERLAY_ID_PREFIX,
    OVERLAY_LEVEL_LABELS,
} from '@/domain/overlays/constants';
import {
    computePatternTargets,
    printedPatternGeometry,
} from '@/domain/analysis/patternTargets';
import type { PriceQuoting } from '@/domain/analysis/promptFormat';

const HS_LABELS = ['LS', 'H', 'RS'] as const;
const HS_LABEL_PIVOT_INDICES = [0, 2, 4] as const;

/**
 * @internal
 * Skill file stem (`skills/patterns/<stem>.md`) for a `ChartPatternId` — every
 * id uses '_' where the file name uses '-'. The one place this convention lives:
 * pattern candidates carry it as `skill`, and `resolveChartOverlays` matches on it.
 */
export function patternSkillStem(patternId: string): string {
    return patternId.replace(/_/g, '-');
}

/** @internal Deterministic overlay id for one pattern: its id and the time of its first bar. */
export function patternOverlayId(
    candidate: PatternCandidate,
    bars: readonly Bar[]
): string {
    return `${OVERLAY_ID_PREFIX.pattern}${candidate.id}:${bars[candidate.startIndex].time}`;
}

const at = (bars: readonly Bar[], index: number, price: number) => ({
    time: bars[index].time,
    price,
});

function seg(
    bars: readonly Bar[],
    fromIndex: number,
    fromPrice: number,
    toIndex: number,
    toPrice: number,
    role: string,
    style: 'solid' | 'dashed' = 'solid'
): OverlaySegment {
    return {
        from: at(bars, fromIndex, fromPrice),
        to: at(bars, toIndex, toPrice),
        role,
        style,
        pane: 'price',
    };
}

/** A boundary drawn solid from its first to its last confirmed touch (spec 2026-10-07 §2.2). */
function lineSegment(
    bars: readonly Bar[],
    line: PatternLine,
    role: string
): OverlaySegment {
    return seg(
        bars,
        line.start.index,
        line.start.price,
        line.end.index,
        line.end.price,
        role
    );
}

/**
 * The dashed continuation of `line` from its last touch to bar `toIndex` —
 * the bar its printed value is read at (the last bar for a breakout or an
 * undirected boundary, the break bar for a neckline). Without it the chart
 * stopped at the last touch while the prompt quoted the line further right,
 * so the printed level sat on nothing drawn. Empty when the line already
 * ends there.
 */
function extensionSegments(
    bars: readonly Bar[],
    line: PatternLine,
    toIndex: number,
    role: string
): OverlaySegment[] {
    return toIndex > line.end.index
        ? [
              seg(
                  bars,
                  line.end.index,
                  line.end.price,
                  toIndex,
                  lineValueAt(line, toIndex),
                  role,
                  'dashed'
              ),
          ]
        : [];
}

/** A boundary solid between its touches, then dashed to `toIndex` (see {@link extensionSegments}). */
function extendedLine(
    bars: readonly Bar[],
    line: PatternLine,
    toIndex: number,
    role: string
): OverlaySegment[] {
    return [
        lineSegment(bars, line, role),
        ...extensionSegments(bars, line, toIndex, role),
    ];
}

/**
 * Legs between consecutive points. A leg between two points on the same bar
 * (a wide bar whose high and low both pivot) has no length and cannot be
 * drawn — it is left out instead of costing the whole pattern its drawing
 * (`runsForward` drops a candidate with any non-forward segment; 165 of
 * 1,592 real-data double/triple/H&S hits lost their drawing that way).
 */
function polyline(
    bars: readonly Bar[],
    points: readonly PatternPoint[]
): OverlaySegment[] {
    return points
        .slice(1)
        .flatMap((p, i) =>
            p.index > points[i].index
                ? [
                      seg(
                          bars,
                          points[i].index,
                          points[i].price,
                          p.index,
                          p.price,
                          'pattern'
                      ),
                  ]
                : []
        );
}

function hsLabels(
    bars: readonly Bar[],
    pivots: readonly PivotPoint[]
): OverlayLabel[] {
    return HS_LABEL_PIVOT_INDICES.map((pi, i) => ({
        at: at(bars, pivots[pi].index, pivots[pi].price),
        text: HS_LABELS[i],
        position: pivots[pi].kind === 'high' ? 'above' : 'below',
    }));
}

/**
 * The pattern's breakout, invalidation and measured-move target at the exact
 * numbers its prompt block prints (`printedPatternGeometry`), so a line's
 * axis label matches the analysis card. Every level is drawn from the
 * pattern's first point, across the whole pattern: a line starting at the
 * last leg sits a few bars from the right edge and hides behind its own axis
 * label (2026-10-02 live render). Like the prompt block, a level at or below
 * zero (a down pattern taller than its breakout) is not a price and is left
 * out.
 */
function patternLevels(
    pattern: QualifiedPattern,
    g: PatternGeometry,
    bars: readonly Bar[],
    quoting: PriceQuoting,
    withBreakout: boolean
): OverlayLevel[] {
    const p = printedPatternGeometry(g, quoting);
    const { measuredTarget } = computePatternTargets(
        p.breakoutLevel,
        p.extremeLevel,
        p.direction
    );
    const fromTime = bars[pattern.startIndex].time;
    const outcome = [
        {
            price: p.invalidationLevel ?? 0,
            label: OVERLAY_LEVEL_LABELS.invalidation,
        },
        { price: measuredTarget, label: OVERLAY_LEVEL_LABELS.target },
    ]
        .filter(l => Number.isFinite(l.price) && l.price > 0)
        .map(l => ({ ...l, fromTime }));
    return withBreakout
        ? [
              {
                  price: p.breakoutLevel,
                  fromTime,
                  label: OVERLAY_LEVEL_LABELS.breakout,
              },
              ...outcome,
          ]
        : outcome;
}

interface PatternDrawing {
    segments: OverlaySegment[];
    labels: OverlayLabel[];
    /** Whether the breakout gets a horizontal level (no drawn line already marks it). */
    breakoutLevel: boolean;
}

/**
 * Segments per shape: boundaries as two lines (triangles, wedges, channels,
 * rectangle, broadening), a pole plus two channel lines (flags), the five
 * pivots plus a sloped neckline (head & shoulders), the fitted arc
 * (rounding), and the structural points as a polyline otherwise.
 *
 * Every line is solid between its touches and continues dashed to the bar
 * its printed value is read at, so each boundary value the prompt block
 * prints lies on a drawn line: the breakout side of a directed boundary pair
 * and of a flag to the last bar, both boundaries of an undirected pair to
 * the last bar, a flag's other channel line to the flag's last bar (its key
 * point) and the neckline to the break bar.
 */
function drawingOf(
    pattern: QualifiedPattern,
    direction: QualifiedPatternGeometry['direction'],
    bars: readonly Bar[]
): PatternDrawing {
    const { shape } = pattern;
    const lastIndex = bars.length - 1;
    switch (shape.kind) {
        case 'trendline': {
            // A side is read at the last bar when it is the breakout side or
            // the pair is undirected; otherwise only its touches are drawn.
            const readAt = (
                line: PatternLine,
                side: PatternBreakoutDirection
            ): number =>
                direction === null || direction === side
                    ? lastIndex
                    : line.end.index;
            return {
                segments: [
                    ...extendedLine(
                        bars,
                        shape.upper,
                        readAt(shape.upper, 'up'),
                        'boundary_upper'
                    ),
                    ...extendedLine(
                        bars,
                        shape.lower,
                        readAt(shape.lower, 'down'),
                        'boundary_lower'
                    ),
                ],
                labels: [],
                breakoutLevel: false,
            };
        }
        case 'flag': {
            const up = shape.direction === 'up';
            return {
                segments: [
                    seg(
                        bars,
                        shape.poleBase.index,
                        shape.poleBase.price,
                        shape.poleTop.index,
                        shape.poleTop.price,
                        'pole'
                    ),
                    ...extendedLine(
                        bars,
                        shape.upper,
                        up ? lastIndex : pattern.endIndex,
                        'channel_upper'
                    ),
                    ...extendedLine(
                        bars,
                        shape.lower,
                        up ? pattern.endIndex : lastIndex,
                        'channel_lower'
                    ),
                ],
                labels: [],
                breakoutLevel: false,
            };
        }
        case 'head_and_shoulders':
            return {
                segments: [
                    ...polyline(bars, pattern.pivots),
                    ...extendedLine(
                        bars,
                        shape.neckline,
                        shape.breakoutIndex,
                        'neckline'
                    ),
                ],
                labels: hsLabels(bars, pattern.pivots),
                breakoutLevel: false,
            };
        case 'cup':
            return {
                segments: polyline(bars, [
                    shape.leftRim,
                    shape.bottom,
                    shape.rightRim,
                    shape.handleLow,
                ]),
                labels: [],
                breakoutLevel: true,
            };
        case 'rounding':
            return {
                segments: polyline(bars, shape.arc),
                labels: [],
                breakoutLevel: true,
            };
        case 'high_tight_flag':
            return {
                segments: polyline(bars, [
                    shape.poleBase,
                    shape.poleTop,
                    shape.flagLow,
                ]),
                labels: [],
                breakoutLevel: true,
            };
        case 'extreme':
            return {
                segments: polyline(bars, pattern.pivots),
                labels: [],
                breakoutLevel: true,
            };
    }
}

/**
 * @internal
 * Qualified patterns → drawable pattern candidates (spec 2026-09-28 §3.1,
 * spec 2026-10-07). Levels: invalidation and measured target for every
 * directed pattern, plus a horizontal breakout where no drawn line already
 * marks it. An undirected boundary pair (no prior trend) draws its two
 * boundaries and no level — it has no target. A pattern without geometry is
 * skipped.
 */
export function buildPatternOverlayCandidates(
    patterns: readonly QualifiedPattern[],
    bars: readonly Bar[],
    atr: number,
    quoting: PriceQuoting
): OverlayCandidate[] {
    return patterns.flatMap(pattern => {
        const g = computeCandidateGeometry(pattern, bars, atr);
        if (g === null) return [];
        const drawing = drawingOf(pattern, g.direction, bars);
        return [
            {
                id: patternOverlayId(pattern, bars),
                kind: 'pattern' as const,
                // The skill file stem (`skills/patterns/<skill>.md`).
                skill: patternSkillStem(pattern.id),
                promptLine: '',
                segments: drawing.segments,
                levels:
                    g.direction === null
                        ? []
                        : patternLevels(
                              pattern,
                              g,
                              bars,
                              quoting,
                              drawing.breakoutLevel
                          ),
                labels: drawing.labels,
            },
        ];
    });
}
