import type {
    Bar,
    OverlayCandidate,
    OverlayFormat,
    PivotKind,
    PivotPoint,
} from '@/domain/types';
import { extractPivots } from '@/domain/patterns/pivots';
import {
    FLAT_SLOPE_ATR_PER_BAR,
    SCREEN_LOOKBACK_BARS,
} from '@/domain/patterns/constants';
import {
    TRENDLINE_BREAK_ATR_MULT,
    TRENDLINE_CANDIDATES_PER_SIDE,
    TRENDLINE_MAX_BREAK_BARS,
    TRENDLINE_TOUCH_ATR_MULT,
} from '@/domain/overlays/constants';
import { formatOverlayPoint } from '@/domain/overlays/format';

type Side = 'support' | 'resistance';
const SIDE_KIND: Record<Side, PivotKind> = {
    support: 'low',
    resistance: 'high',
};

interface ScoredLine {
    p1: PivotPoint;
    p2: PivotPoint;
    slope: number;
    touches: number;
}

function scoreLine(
    side: Side,
    p1: PivotPoint,
    p2: PivotPoint,
    pivots: readonly PivotPoint[],
    bars: readonly Bar[],
    atr: number
): ScoredLine | null {
    const slope = (p2.price - p1.price) / (p2.index - p1.index);
    const normalized = slope / atr;
    if (
        side === 'support'
            ? normalized <= FLAT_SLOPE_ATR_PER_BAR
            : normalized >= -FLAT_SLOPE_ATR_PER_BAR
    )
        return null;
    const lineAt = (x: number) => p1.price + slope * (x - p1.index);

    let breaks = 0;
    for (let i = p1.index; i < bars.length; i++) {
        const gap = bars[i].close - lineAt(i);
        if (
            side === 'support'
                ? gap < -TRENDLINE_BREAK_ATR_MULT * atr
                : gap > TRENDLINE_BREAK_ATR_MULT * atr
        )
            breaks++;
    }
    if (breaks >= TRENDLINE_MAX_BREAK_BARS) return null;

    const touches = pivots.filter(
        p =>
            p.index >= p1.index &&
            Math.abs(p.price - lineAt(p.index)) <=
                TRENDLINE_TOUCH_ATR_MULT * atr
    ).length;
    return { p1, p2, slope, touches };
}

function toCandidate(
    side: Side,
    line: ScoredLine,
    bars: readonly Bar[],
    fmt: OverlayFormat
): OverlayCandidate {
    const last = bars.length - 1;
    const from = { time: bars[line.p1.index].time, price: line.p1.price };
    const to = {
        time: bars[last].time,
        price: line.p1.price + line.slope * (last - line.p1.index),
    };
    const through = { time: bars[line.p2.index].time, price: line.p2.price };
    return {
        id: `tl:${side}:${from.time}:${through.time}`,
        kind: 'trendline',
        skill: 'trendline',
        promptLine: `${side} (${side === 'support' ? 'ascending' : 'descending'}) from ${formatOverlayPoint(from, fmt)} through ${formatOverlayPoint(through, fmt)}, at last bar ${formatOverlayPoint(to, fmt)}; touches ${line.touches}`,
        segments: [{ from, to, role: side, style: 'solid', pane: 'price' }],
        levels: [],
        labels: [],
    };
}

/**
 * @internal
 * Two-pivot trendline candidates over the screener window:
 * rising support through lows, falling resistance through highs, invalidated
 * by repeated closes through the line, ranked by touches then recency.
 */
export function buildTrendlineCandidates(
    bars: readonly Bar[],
    atr: number,
    fmt: OverlayFormat
): OverlayCandidate[] {
    if (atr <= 0 || bars.length < 2) return [];
    const offset = Math.max(0, bars.length - SCREEN_LOOKBACK_BARS);
    const pivots = extractPivots(bars.slice(offset), atr).map(p => ({
        ...p,
        index: p.index + offset,
    }));

    return (['support', 'resistance'] as const).flatMap(side => {
        const same = pivots.filter(p => p.kind === SIDE_KIND[side]);
        const lines: ScoredLine[] = [];
        for (let i = 0; i < same.length; i++) {
            for (let j = i + 1; j < same.length; j++) {
                const line = scoreLine(side, same[i], same[j], same, bars, atr);
                if (line) lines.push(line);
            }
        }
        return lines
            .toSorted(
                (a, b) => b.touches - a.touches || b.p2.index - a.p2.index
            )
            .slice(0, TRENDLINE_CANDIDATES_PER_SIDE)
            .map(line => toCandidate(side, line, bars, fmt));
    });
}
