import type {
    Bar,
    OverlayCandidate,
    OverlayFormat,
    OverlayLabel,
    OverlaySegment,
    PivotPoint,
} from '@/domain/types';
import { extractPivots } from '@/domain/patterns/pivots';
import { SCREEN_LOOKBACK_BARS } from '@/domain/patterns/constants';
import {
    ELLIOTT_CANDIDATE_LIMIT,
    EW_ABC_C_BEYOND_A_BONUS,
    EW_ABC_PIVOTS,
    EW_ALTERNATION_MIN_DIFF,
    EW_IMPULSE_PIVOTS,
    EW_MIN_IMPULSE_SPAN_BARS,
    EW_MIN_PARTIAL_PIVOTS,
    EW_MIN_WAVE_BARS,
    EW_UNJUDGED_SCORE,
    EW_WAVE2_RETRACE_MAX,
    EW_WAVE2_RETRACE_MIN,
    EW_WAVE3_EXTENSION,
    EW_WAVE4_RETRACE_MAX,
    EW_WAVE4_RETRACE_MIN,
    EW_WAVE5_OF_ZERO_TO_THREE,
    EW_WAVE5_TOLERANCE,
} from '@/domain/overlays/constants';
import { formatOverlayPoint } from '@/domain/overlays/format';

const ABC_LABELS = ['A', 'B', 'C'] as const;

interface Count {
    seq: PivotPoint[];
    abc: PivotPoint[];
    up: boolean;
    score: number;
    atRightEdge: boolean;
}

const within = (x: number, lo: number, hi: number): number =>
    x >= lo && x <= hi ? 1 : 0;
const alternates = (seq: readonly PivotPoint[]): boolean =>
    seq.every(
        (p, i) =>
            i === 0 ||
            (p.kind !== seq[i - 1].kind &&
                p.index - seq[i - 1].index >= EW_MIN_WAVE_BARS)
    );

/** Whether `seq`'s last pivot is the last pivot in `pivots` — i.e. it is the
 * still-forming, provisional right-edge pivot rather than a confirmed one. */
const isLastPivotInList = (
    seq: readonly PivotPoint[],
    pivots: readonly PivotPoint[]
): boolean => seq[seq.length - 1] === pivots[pivots.length - 1];

/** Absolute rules on however many waves `seq` has. `P(i)` is price signed so "up" is always positive. */
function passesRules(seq: readonly PivotPoint[], up: boolean): boolean {
    const P = (i: number) => (up ? seq[i].price : -seq[i].price);
    const w = (i: number) => Math.abs(seq[i + 1].price - seq[i].price);
    const n = seq.length;
    if (n >= 3 && !(P(2) > P(0))) return false; // rule 1
    if (n >= 5 && !(P(3) > P(1))) return false; // wave 3 clears wave 1
    if (n >= 5 && w(2) < w(0) && n < EW_IMPULSE_PIVOTS) return false; // rule 2, wave 5 unformed
    if (n >= EW_IMPULSE_PIVOTS && w(2) < w(0) && w(2) < w(4)) return false; // rule 2
    if (n >= 5 && !(P(4) > P(1))) return false; // rule 3
    return true;
}

function score(seq: readonly PivotPoint[], lastBarIndex: number): number {
    const w = (i: number) => Math.abs(seq[i + 1].price - seq[i].price);
    const n = seq.length;
    const r2 = w(1) / w(0);
    const g2 = within(r2, EW_WAVE2_RETRACE_MIN, EW_WAVE2_RETRACE_MAX);
    const g3 =
        n >= 5
            ? Math.min(1, w(2) / w(0) / EW_WAVE3_EXTENSION)
            : EW_UNJUDGED_SCORE;
    const r4 = n >= 5 ? w(3) / w(2) : null;
    const g4 =
        r4 === null
            ? EW_UNJUDGED_SCORE
            : within(r4, EW_WAVE4_RETRACE_MIN, EW_WAVE4_RETRACE_MAX);
    const g5 =
        n >= EW_IMPULSE_PIVOTS
            ? Math.abs(w(4) / w(0) - 1) <= EW_WAVE5_TOLERANCE ||
              Math.abs(
                  w(4) / Math.abs(seq[3].price - seq[0].price) -
                      EW_WAVE5_OF_ZERO_TO_THREE
              ) <= EW_WAVE5_TOLERANCE
                ? 1
                : 0
            : EW_UNJUDGED_SCORE;
    const alt =
        r4 === null
            ? EW_UNJUDGED_SCORE
            : Math.abs(r2 - r4) >= EW_ALTERNATION_MIN_DIFF
              ? 1
              : 0;
    const recency = Math.max(
        0,
        1 - (lastBarIndex - seq[n - 1].index) / SCREEN_LOOKBACK_BARS
    );
    return (g2 + g3 + g4 + g5 + alt + recency) / 6;
}

/** A–B–C after wave 5: B must not retrace past wave 5's end. */
function abcAfter(
    pivots: readonly PivotPoint[],
    endPos: number,
    up: boolean
): PivotPoint[] {
    const abc = pivots.slice(endPos + 1, endPos + 1 + EW_ABC_PIVOTS);
    if (abc.length < EW_ABC_PIVOTS || !alternates([pivots[endPos], ...abc]))
        return [];
    const five = pivots[endPos].price;
    const bBeyondFive = up ? abc[1].price >= five : abc[1].price <= five;
    return bBeyondFive ? [] : abc;
}

function enumerate(
    pivots: readonly PivotPoint[],
    lastBarIndex: number
): Count[] {
    const counts: Count[] = [];
    for (let s = 0; s < pivots.length; s++) {
        const up = pivots[s].kind === 'low';
        for (let n = EW_IMPULSE_PIVOTS; n >= EW_MIN_PARTIAL_PIVOTS; n--) {
            if (s + n > pivots.length) continue;
            // A partial count only makes sense when it is still running at the right edge.
            if (n < EW_IMPULSE_PIVOTS && s + n !== pivots.length) continue;
            const seq = pivots.slice(s, s + n);
            if (
                !alternates(seq) ||
                seq[seq.length - 1].index - seq[0].index <
                    EW_MIN_IMPULSE_SPAN_BARS ||
                !passesRules(seq, up)
            )
                continue;
            const abc =
                n === EW_IMPULSE_PIVOTS ? abcAfter(pivots, s + n - 1, up) : [];
            const aEnd = abc[0]?.price;
            const cBeyondA =
                abc.length > 0 &&
                (up ? abc[2].price < aEnd : abc[2].price > aEnd);
            counts.push({
                seq,
                abc,
                up,
                score: Math.min(
                    1,
                    score(seq, lastBarIndex) +
                        (cBeyondA ? EW_ABC_C_BEYOND_A_BONUS : 0)
                ),
                atRightEdge: isLastPivotInList(seq, pivots),
            });
        }
    }
    return counts;
}

function toCandidate(
    count: Count,
    bars: readonly Bar[],
    fmt: OverlayFormat
): OverlayCandidate {
    const pt = (p: PivotPoint) => ({
        time: bars[p.index].time,
        price: p.price,
    });
    const all = [...count.seq, ...count.abc];
    const segments: OverlaySegment[] = all.slice(1).map((p, i) => ({
        from: pt(all[i]),
        to: pt(p),
        role:
            i < count.seq.length - 1
                ? `wave_${i + 1}`
                : `wave_${ABC_LABELS[i - (count.seq.length - 1)]}`,
        style: i < count.seq.length - 1 ? 'solid' : 'dashed',
        pane: 'price',
    }));
    const labels: OverlayLabel[] = all.slice(1).map((p, i) => ({
        at: pt(p),
        text:
            i < count.seq.length - 1
                ? String(i + 1)
                : ABC_LABELS[i - (count.seq.length - 1)],
        position: p.kind === 'high' ? 'above' : 'below',
    }));
    const n = count.seq.length;
    const dir = count.up ? 'up' : 'down';
    // With `n` pivots (0..n-1), waves 1..n-2 sit between confirmed pivots;
    // wave n-1 ends at the provisional right-edge pivot and is still forming.
    // A full 6-pivot count is only truly complete when its last pivot is
    // NOT the provisional right-edge one.
    const state =
        n < EW_IMPULSE_PIVOTS
            ? `wave ${n - 1} in progress`
            : count.atRightEdge
              ? 'wave 5 in progress'
              : count.abc.length > 0
                ? 'impulse complete, A–B–C done'
                : 'impulse complete';
    const points = all
        .map(
            (p, i) =>
                `${i < n ? i : ABC_LABELS[i - n]} ${formatOverlayPoint(pt(p), fmt)}`
        )
        .join(', ');
    return {
        id: `ew:${dir}:${bars[count.seq[0].index].time}:${n}${count.abc.length > 0 ? ':abc' : ''}`,
        kind: 'elliott',
        skill: 'elliott-wave',
        promptLine: `impulse ${dir}; ${state}; ${points}; score ${count.score.toFixed(2)}`,
        segments,
        levels: [],
        labels,
    };
}

/**
 * @internal
 * Elliott impulse counts (complete or still running at the right edge) that
 * pass the three absolute rules, scored on the textbook guidelines, with an
 * A–B–C attached when one follows a complete impulse (spec 2026-09-28 §3.5).
 * Pivot sensitivity is the screener's (1.5 ATR); counts are hypotheses, and
 * the model picks among them rather than drawing its own.
 */
export function buildElliottCandidates(
    bars: readonly Bar[],
    atr: number,
    fmt: OverlayFormat
): OverlayCandidate[] {
    if (atr <= 0 || bars.length < 2) return [];
    const offset = Math.max(0, bars.length - SCREEN_LOOKBACK_BARS);
    const pivots = extractPivots(bars.slice(offset), atr, {
        includeProvisional: true,
    }).map(p => ({ ...p, index: p.index + offset }));
    if (pivots.length < EW_MIN_PARTIAL_PIVOTS) return [];
    const seen = new Set<string>();
    return enumerate(pivots, bars.length - 1)
        .toSorted((a, b) => b.score - a.score)
        .map(c => toCandidate(c, bars, fmt))
        .filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)))
        .slice(0, ELLIOTT_CANDIDATE_LIMIT);
}
