import type {
    Bar,
    OverlayCandidate,
    OverlayLabel,
    OverlayLevel,
    OverlaySegment,
    PatternCandidate,
    PatternGeometry,
    PivotPoint,
} from '@/domain/types';
import {
    computeCandidateGeometry,
    evaluateTrendlineAt,
} from '@/domain/patterns/patternGeometry';
import { OVERLAY_LEVEL_LABELS } from '@/domain/overlays/constants';
import {
    computePatternTargets,
    printedPatternGeometry,
} from '@/domain/analysis/patternTargets';

const TRENDLINE_FAMILY = new Set([
    'ascending_triangle',
    'descending_triangle',
    'symmetrical_triangle',
    'ascending_wedge',
    'descending_wedge',
    'ascending_channel',
    'descending_channel',
    'broadening_formation',
    'rectangle',
]);
const FLAG_FAMILY = new Set(['bull_flag', 'bear_flag', 'pennant']);
const HS_FAMILY = new Set(['head_and_shoulders', 'inverse_head_and_shoulders']);
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

/** @internal Deterministic overlay id for one screener hit. */
export function patternOverlayId(
    candidate: PatternCandidate,
    bars: readonly Bar[]
): string {
    return `pattern:${candidate.id}:${bars[candidate.startIndex].time}`;
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

/**
 * Neckline as a SEGMENT (not a horizontal level) through the two troughs of a
 * 5-pivot head & shoulders (`pivots[1]`/`pivots[3]`), extended linearly to the
 * chart's right edge — a real neckline slopes, so a horizontal breakout level
 * misdraws it for anything but a perfectly flat one.
 */
function necklineSegment(
    bars: readonly Bar[],
    pivots: readonly PivotPoint[]
): OverlaySegment {
    const p1 = pivots[1];
    const p3 = pivots[3];
    const lastIndex = bars.length - 1;
    const slope = (p3.price - p1.price) / (p3.index - p1.index);
    const extendedPrice = p3.price + slope * (lastIndex - p3.index);
    return seg(
        bars,
        p1.index,
        p1.price,
        lastIndex,
        extendedPrice,
        'neckline',
        'dashed'
    );
}

/**
 * Legs between consecutive pivots. A leg between two pivots on the same bar
 * (a wide bar whose high and low both pivot) has no length and cannot be
 * drawn — it is left out instead of costing the whole pattern its drawing
 * (`runsForward` drops a candidate with any non-forward segment; 165 of
 * 1,592 real-data double/triple/H&S hits lost their drawing that way).
 */
function polyline(
    bars: readonly Bar[],
    pivots: readonly PivotPoint[]
): OverlaySegment[] {
    return pivots
        .slice(1)
        .flatMap((p, i) =>
            p.index > pivots[i].index
                ? [
                      seg(
                          bars,
                          pivots[i].index,
                          pivots[i].price,
                          p.index,
                          p.price,
                          'pattern'
                      ),
                  ]
                : []
        );
}

function trendlineSegments(
    bars: readonly Bar[],
    pivots: readonly PivotPoint[]
): OverlaySegment[] {
    const highs = pivots.filter(p => p.kind === 'high');
    const lows = pivots.filter(p => p.kind === 'low');
    const start = Math.min(...pivots.map(p => p.index));
    const end = Math.max(...pivots.map(p => p.index));
    return [
        seg(
            bars,
            start,
            evaluateTrendlineAt(highs, start),
            end,
            evaluateTrendlineAt(highs, end),
            'boundary_upper'
        ),
        seg(
            bars,
            start,
            evaluateTrendlineAt(lows, start),
            end,
            evaluateTrendlineAt(lows, end),
            'boundary_lower'
        ),
    ];
}

function flagSegments(
    bars: readonly Bar[],
    c: PatternCandidate,
    g: PatternGeometry
): OverlaySegment[] {
    const [base, top, upper, lower] = g.keyPoints;
    return [
        seg(bars, base.index, base.price, top.index, top.price, 'pole'),
        seg(
            bars,
            c.startIndex,
            upper.price,
            c.endIndex,
            upper.price,
            'channel_upper'
        ),
        seg(
            bars,
            c.startIndex,
            lower.price,
            c.endIndex,
            lower.price,
            'channel_lower'
        ),
    ];
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
 * pattern's first pivot (its start without pivots), across the whole pattern:
 * a line starting at the last leg sits a few bars from the right edge and
 * hides behind its own axis label (2026-10-02 live render). Like the prompt
 * block, a level at or below zero (a down pattern taller than its breakout)
 * is not a price and is left out.
 */
function patternLevels(
    c: PatternCandidate,
    g: PatternGeometry,
    bars: readonly Bar[],
    inRange: readonly PivotPoint[],
    priceDp: number,
    withBreakout: boolean
): OverlayLevel[] {
    const p = printedPatternGeometry(g, priceDp);
    const { measuredTarget } = computePatternTargets(
        p.breakoutLevel,
        p.extremeLevel,
        p.direction
    );
    const fromTime =
        bars[inRange.length > 0 ? inRange[0].index : c.startIndex].time;
    const outcome = [
        {
            price: p.invalidationLevel ?? 0,
            label: OVERLAY_LEVEL_LABELS.invalidation,
        },
        { price: measuredTarget, label: OVERLAY_LEVEL_LABELS.target },
    ]
        .filter(l => Number.isFinite(l.price) && l.price > 0)
        .map(l => ({ ...l, fromTime }));
    return withBreakout && inRange.length > 0
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

function toOverlay(
    c: PatternCandidate,
    g: PatternGeometry,
    bars: readonly Bar[],
    priceDp: number
): OverlayCandidate | null {
    const inRange = (c.pivots ?? []).filter(
        p => p.index >= c.startIndex && p.index <= c.endIndex
    );
    // `skill` is the skill file stem (`skills/patterns/<skill>.md`).
    const base = {
        id: patternOverlayId(c, bars),
        kind: 'pattern' as const,
        skill: patternSkillStem(c.id),
        promptLine: '',
    };

    if (FLAG_FAMILY.has(c.id)) {
        if (c.endIndex <= c.startIndex) return null;
        return {
            ...base,
            segments: flagSegments(bars, c, g),
            levels: patternLevels(c, g, bars, inRange, priceDp, false),
            labels: [],
        };
    }
    if (TRENDLINE_FAMILY.has(c.id)) {
        return {
            ...base,
            segments: trendlineSegments(bars, inRange),
            levels: patternLevels(c, g, bars, inRange, priceDp, false),
            labels: [],
        };
    }
    if (inRange.length < 2) return null;
    const isHs = HS_FAMILY.has(c.id) && inRange.length === 5;
    return {
        ...base,
        // Head & shoulders draws its neckline as a sloped segment through the
        // two troughs instead of a horizontal breakout level (real necklines
        // slope); every other family keeps the horizontal breakout level.
        segments: isHs
            ? [...polyline(bars, inRange), necklineSegment(bars, inRange)]
            : polyline(bars, inRange),
        levels: patternLevels(c, g, bars, inRange, priceDp, !isHs),
        labels: isHs ? hsLabels(bars, inRange) : [],
    };
}

/**
 * @internal
 * Screener hits → drawable pattern candidates (spec 2026-09-28 §3.1). A hit
 * with no geometry is skipped — the prompt section still lists it, but there
 * is nothing trustworthy to draw.
 */
export function buildPatternOverlayCandidates(
    candidates: readonly PatternCandidate[],
    bars: readonly Bar[],
    atr: number,
    priceDp: number
): OverlayCandidate[] {
    return candidates.flatMap(c => {
        const g = computeCandidateGeometry(c, bars, atr);
        const overlay = g ? toOverlay(c, g, bars, priceDp) : null;
        return overlay ? [overlay] : [];
    });
}
