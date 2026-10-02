import type {
    Bar,
    ElliottScoredCandidate,
    ElliottStructure,
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
    ELLIOTT_ENABLED_STRUCTURES,
    ELLIOTT_PER_STRUCTURE_LIMIT,
    EW_ABC_C_BEYOND_A_BONUS,
    EW_ABC_PIVOTS,
    EW_ALTERNATION_MIN_DIFF,
    EW_IMPULSE_PIVOTS,
    EW_MIN_IMPULSE_SPAN_BARS,
    EW_MIN_PARTIAL_PIVOTS,
    EW_MIN_STRUCTURE_PIVOTS,
    EW_MIN_WAVE_ATR,
    EW_UNJUDGED_SCORE,
    EW_WAVE2_RETRACE_LIMIT_MAX,
    EW_WAVE2_RETRACE_LIMIT_MIN,
    EW_WAVE4_RETRACE_LIMIT_MAX,
    EW_WAVE4_RETRACE_LIMIT_MIN,
    EW_WAVE2_RETRACE_MAX,
    EW_WAVE2_RETRACE_MIN,
    EW_WAVE3_EXTENSION,
    EW_WAVE4_RETRACE_MAX,
    EW_WAVE4_RETRACE_MIN,
    EW_WAVE5_OF_ZERO_TO_THREE,
    EW_WAVE5_TOLERANCE,
} from '@/domain/overlays/constants';
import {
    formatOverlayPoint,
    formatOverlayPrice,
} from '@/domain/overlays/format';
import { buildAbcCandidates } from '@/domain/overlays/elliottAbc';
import { buildCombinationCandidates } from '@/domain/overlays/elliottCombination';
import { buildDiagonalCandidates } from '@/domain/overlays/elliottDiagonal';
import {
    abcTargets,
    alternates,
    classifyAbc,
    elliottPromptLine,
    isLastPivotInList,
    legSizes,
    mergeShortLegs,
    passesRules,
    recency,
    waveRatios,
    within,
} from '@/domain/overlays/elliottShared';
import { buildTriangleCandidates } from '@/domain/overlays/elliottTriangle';

const ABC_LABELS = ['A', 'B', 'C'] as const;

interface Count {
    seq: PivotPoint[];
    abc: PivotPoint[];
    up: boolean;
    score: number;
    atRightEdge: boolean;
}

function score(seq: readonly PivotPoint[], lastBarIndex: number): number {
    const w = (i: number) => Math.abs(seq[i + 1].price - seq[i].price);
    const n = seq.length;
    const r2 = w(1) / w(0);
    const g2 = within(r2, EW_WAVE2_RETRACE_MIN, EW_WAVE2_RETRACE_MAX);
    // Every count has waves 1–4 (EW_MIN_PARTIAL_PIVOTS = 5); only wave 5 may be missing.
    const g3 = Math.min(1, w(2) / w(0) / EW_WAVE3_EXTENSION);
    const r4 = w(3) / w(2);
    const g4 = within(r4, EW_WAVE4_RETRACE_MIN, EW_WAVE4_RETRACE_MAX);
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
    const alt = Math.abs(r2 - r4) >= EW_ALTERNATION_MIN_DIFF ? 1 : 0;
    return (
        (g2 + g3 + g4 + g5 + alt + recency(seq[n - 1].index, lastBarIndex)) / 6
    );
}

/**
 * Impulse filters beyond the three rules (2026-10-02 gate): wave 3 at least
 * as long as wave 1; waves 2 and 4 inside their hard retracement bands; every
 * finished wave at least EW_MIN_WAVE_ATR ATR; a finished wave 5
 * clears wave 3's end (truncation is rare and indistinguishable from noise).
 * A `forming` last wave is exempt from the size floor, the truncation check
 * and (wave 4) the lower band.
 */
function impulseShapeOk(
    seq: readonly PivotPoint[],
    forming: boolean,
    atr: number
): boolean {
    const w = legSizes(seq);
    const finished = forming ? w.slice(0, -1) : w;
    const r2 = w[1] / w[0];
    // Waves 1–4 always exist (EW_MIN_PARTIAL_PIVOTS = 5); a count that is
    // not forming is complete, so it has wave 5.
    const r4 = w[3] / w[2];
    return (
        w[2] >= w[0] &&
        r2 >= EW_WAVE2_RETRACE_LIMIT_MIN &&
        r2 <= EW_WAVE2_RETRACE_LIMIT_MAX &&
        r4 <= EW_WAVE4_RETRACE_LIMIT_MAX &&
        (r4 >= EW_WAVE4_RETRACE_LIMIT_MIN || (forming && w.length === 4)) &&
        finished.every(l => l >= EW_MIN_WAVE_ATR * atr) &&
        // A finished wave 5 clears wave 3's end (no truncation).
        (forming || w[4] > w[3])
    );
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
    lastBarIndex: number,
    atr: number
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
                !passesRules(seq, up) ||
                !impulseShapeOk(seq, isLastPivotInList(seq, pivots), atr)
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

/** The attached A–B–C's type and whether its C is still forming; `null` without an A–B–C. */
interface AbcTag {
    type: ReturnType<typeof classifyAbc>;
    cInProgress: boolean;
}

function impulseState(count: Count, abcTag: AbcTag | null): string {
    const n = count.seq.length;
    // With `n` pivots (0..n-1), waves 1..n-2 sit between confirmed pivots;
    // wave n-1 ends at the provisional right-edge pivot and is still forming.
    // A full 6-pivot count is only truly complete when its last pivot is
    // NOT the provisional right-edge one.
    if (n < EW_IMPULSE_PIVOTS) return `wave ${n - 1} in progress`;
    if (count.atRightEdge) return 'wave 5 in progress';
    if (count.abc.length === 0) return 'impulse complete';
    if (abcTag === null || abcTag.type === null)
        return 'impulse complete, A–B–C done';
    return `impulse complete, A–B–C ${abcTag.cInProgress ? 'with C in progress' : 'done'} (${abcTag.type})`;
}

/**
 * Invalidation for the count's state, then the ratios of its finished waves
 * and an attached A–B–C's C targets. Wave 4 forming: wave 1's end (rule 3).
 * Wave 5 forming: wave 4's end. Complete — with or without an A–B–C — a new
 * extreme beyond wave 5's end, which negates "impulse complete" (wave 5 is
 * still extending); breaking wave 4's end then only confirms the
 * correction. An attached A–B–C's B never passes wave 5's end (`abcAfter`),
 * so this is also every attached A–B–C's invalidation (a zigzag's A start).
 */
function impulseFacts(
    count: Count,
    abcTag: AbcTag | null,
    fmt: OverlayFormat
): string[] {
    const { seq, abc } = count;
    const forming = count.atRightEdge || seq.length < EW_IMPULSE_PIVOTS;
    const level =
        seq.length < EW_IMPULSE_PIVOTS
            ? seq[1]
            : count.atRightEdge
              ? seq[4]
              : seq[5];
    return [
        `invalidation ${formatOverlayPrice(level.price, fmt)}`,
        waveRatios(seq, forming),
        ...(abc.length > 0 && abcTag !== null && abcTag.type !== null
            ? [abcTargets([seq[seq.length - 1], ...abc], fmt)]
            : []),
    ];
}

function toCandidate(
    count: Count,
    bars: readonly Bar[],
    fmt: OverlayFormat,
    abcTag: AbcTag | null
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
        promptLine: elliottPromptLine(
            `impulse ${dir}`,
            impulseState(count, abcTag),
            points,
            impulseFacts(count, abcTag, fmt),
            count.score
        ),
        segments,
        levels: [],
        labels,
    };
}

/**
 * @internal
 * Best candidate of each structure first, then the remaining slots by score
 * (at most ELLIOTT_PER_STRUCTURE_LIMIT per structure, ELLIOTT_CANDIDATE_LIMIT
 * in all), returned best-first (spec 2026-10-02 §후보 제시·선택). Of
 * candidates sharing an id, the higher-scoring one is kept. Ties keep input
 * order, so impulse-only input yields exactly the pre-2026-10-02 top three.
 */
export function selectElliottCandidates(
    scored: readonly ElliottScoredCandidate[]
): OverlayCandidate[] {
    const seen = new Set<string>();
    const ranked = scored
        .toSorted((a, b) => b.score - a.score)
        .filter(c =>
            seen.has(c.candidate.id) ? false : (seen.add(c.candidate.id), true)
        );
    const picked = new Set(
        ranked.filter(
            (c, i) => ranked.findIndex(d => d.structure === c.structure) === i
        )
    );
    const taken = (structure: ElliottStructure) =>
        ranked.filter(c => picked.has(c) && c.structure === structure).length;
    for (const c of ranked) {
        if (picked.size >= ELLIOTT_CANDIDATE_LIMIT) break;
        if (taken(c.structure) < ELLIOTT_PER_STRUCTURE_LIMIT) picked.add(c);
    }
    return ranked.filter(c => picked.has(c)).map(c => c.candidate);
}

/**
 * @internal
 * Elliott counts offered as overlay candidates (spec 2026-09-28 §3.5, spec
 * 2026-10-02): impulses passing the three absolute rules (complete or still
 * running at the right edge, with an A–B–C attached when one follows a
 * complete impulse), diagonals (rule 3 broken in a wedge), triangles,
 * combinations and standalone A–B–Cs — each only when listed in `enabled`.
 * Pivot sensitivity is the screener's (1.5 ATR); counts are hypotheses, and
 * the model picks among them rather than drawing its own.
 *
 * @param enabled - Structures to offer; defaults to the gated
 * ELLIOTT_ENABLED_STRUCTURES (the synthetic gate passes the full list to
 * measure structures before they are enabled).
 */
export function buildElliottCandidates(
    bars: readonly Bar[],
    atr: number,
    fmt: OverlayFormat,
    enabled: readonly ElliottStructure[] = ELLIOTT_ENABLED_STRUCTURES
): OverlayCandidate[] {
    if (atr <= 0 || bars.length < 2) return [];
    const offset = Math.max(0, bars.length - SCREEN_LOOKBACK_BARS);
    const pivots = extractPivots(bars.slice(offset), atr, {
        includeProvisional: true,
    }).map(p => ({ ...p, index: p.index + offset }));
    if (pivots.length < EW_MIN_STRUCTURE_PIVOTS) return [];
    // Every structure counts over merged pivots (see mergeShortLegs).
    const merged = mergeShortLegs(pivots);
    const lastBarIndex = bars.length - 1;
    const on = (s: ElliottStructure) => enabled.includes(s);
    const tagAbc = (c: Count): AbcTag | null => {
        if (c.abc.length === 0) return null;
        const cInProgress = isLastPivotInList(c.abc, merged);
        return {
            type: classifyAbc([c.seq[c.seq.length - 1], ...c.abc], cInProgress),
            cInProgress,
        };
    };
    const scored: ElliottScoredCandidate[] = [
        ...(on('impulse')
            ? enumerate(merged, lastBarIndex, atr).map(c => ({
                  structure: 'impulse' as const,
                  score: c.score,
                  candidate: toCandidate(c, bars, fmt, tagAbc(c)),
              }))
            : []),
        ...(on('diagonal')
            ? buildDiagonalCandidates(merged, bars, atr, fmt)
            : []),
        ...(on('triangle')
            ? buildTriangleCandidates(merged, bars, atr, fmt)
            : []),
        ...(on('combination')
            ? buildCombinationCandidates(merged, bars, atr, fmt)
            : []),
        ...(on('abc') ? buildAbcCandidates(merged, bars, fmt) : []),
    ];
    return selectElliottCandidates(scored);
}
