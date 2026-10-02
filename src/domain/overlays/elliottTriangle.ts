import type {
    Bar,
    ElliottScoredCandidate,
    OverlayFormat,
    PivotPoint,
} from '@/domain/types';
import {
    EW_TIME_BALANCE_MIN,
    EW_TRI_A_START_TOLERANCE_ATR,
    EW_TRI_E_MIN_REACH,
    EW_TRI_E_OVERSHOOT,
    EW_TRI_LEG_RATIO_MIN,
    EW_TRI_LEG_TOLERANCE,
    EW_TRIANGLE_MIN_PIVOTS,
    EW_TRIANGLE_PIVOTS,
    EW_UNJUDGED_SCORE,
} from '@/domain/overlays/constants';
import {
    boundaryLine,
    elliottPromptLine,
    firstLegDir,
    isLastPivotInList,
    legSegments,
    legSizes,
    legSign,
    lineAt,
    namedPoints,
    pivotLabels,
    pivotRuns,
    recency,
    timeBalance,
} from '@/domain/overlays/elliottShared';
import { formatOverlayPrice } from '@/domain/overlays/format';

const TRIANGLE_LABELS = ['A', 'B', 'C', 'D', 'E'] as const;

/**
 * Each leg shorter than the one two back, not (beyond tolerance) longer than
 * the previous, and retracing at least EW_TRI_LEG_RATIO_MIN of it. A leg
 * still `forming` at the right edge skips the checks it may yet grow into.
 */
const contracting = (w: readonly number[], forming: boolean) =>
    w.every((l, i) => {
        if (i === 0) return true;
        const grown = forming && i === w.length - 1;
        return (
            l <= w[i - 1] * (1 + EW_TRI_LEG_TOLERANCE) &&
            (grown || l >= w[i - 1] * EW_TRI_LEG_RATIO_MIN) &&
            (i < 2 || l < w[i - 2])
        );
    });

/**
 * A contracting triangle's ends: wave A starts beyond the B–D line, and E
 * ends near the A–C line — at most EW_TRI_E_OVERSHOOT ATR past it and, once
 * complete, at least EW_TRI_E_MIN_REACH of the way to it from D (a D that
 * already sits on the line rejects). `sign` is
 * the first leg's direction.
 */
function contractingEndsOk(
    seq: readonly PivotPoint[],
    sign: number,
    atr: number,
    eForming: boolean
): boolean {
    const startOutside =
        -sign * (seq[0].price - lineAt(seq[2], seq[4], seq[0].index)) >=
        -EW_TRI_A_START_TOLERANCE_ATR * atr;
    if (!startOutside || seq.length < EW_TRIANGLE_PIVOTS) return startOutside;
    const acAtE = lineAt(seq[1], seq[3], seq[5].index);
    const overshoot = sign * (seq[5].price - acAtE);
    // D's end on the A–C line leaves no distance to cover: degenerate, not a reach.
    const toLine = Math.abs(acAtE - seq[4].price);
    const reached =
        toLine > 0 &&
        Math.abs(seq[5].price - seq[4].price) / toLine >= EW_TRI_E_MIN_REACH;
    return overshoot <= EW_TRI_E_OVERSHOOT * atr && (eForming || reached);
}

/**
 * Each triangle leg may not pass the end of the leg two back, so with D
 * forming the count breaks past B's end, and with E forming or done past
 * C's end — or past the last leg's own end when the flat-side tolerance
 * (EW_TRI_LEG_TOLERANCE) already let it edge beyond. A complete triangle
 * adds the post-triangle thrust: its widest width (A's end to the B–D line
 * at A's end) projected from E, against A.
 */
function triangleFacts(
    seq: readonly PivotPoint[],
    atEdge: boolean,
    fmt: OverlayFormat
): string[] {
    const n = seq.length;
    const twoBack = seq[n - 3];
    const last = seq[n - 1];
    // Same kind as `twoBack`: "beyond" is higher for highs, lower for lows.
    const level =
        twoBack.kind === 'high'
            ? Math.max(twoBack.price, last.price)
            : Math.min(twoBack.price, last.price);
    const facts = [`invalidation ${formatOverlayPrice(level, fmt)}`];
    if (seq.length < EW_TRIANGLE_PIVOTS || atEdge) return facts;
    const width = Math.abs(lineAt(seq[2], seq[4], seq[1].index) - seq[1].price);
    const against = -legSign(seq);
    return [
        ...facts,
        `thrust target ${formatOverlayPrice(seq[5].price + against * width, fmt)}`,
    ];
}

/**
 * @internal
 * A–B–C–D–E triangles (spec 2026-10-02 §1): 6 pivots, or 5 at the right edge
 * (D forming, E next). Contracting: every leg shorter than the one two back
 * (highs fall, lows rise; a flat barrier side is tolerated) yet retracing at
 * least half the previous one (sideways); A starts beyond the B–D line and E
 * ends near the A–C line (`contractingEndsOk`); legs take comparable time.
 * Expanding triangles are not counted: rare, and in the synthetic gate they
 * only added random-walk false positives. Drawn as 5 legs + the A–C and B–D
 * boundaries (dashed, to the last pivot).
 */
export function buildTriangleCandidates(
    pivots: readonly PivotPoint[],
    bars: readonly Bar[],
    atr: number,
    fmt: OverlayFormat
): ElliottScoredCandidate[] {
    const lastBarIndex = bars.length - 1;
    const runs = [
        ...pivotRuns(pivots, EW_TRIANGLE_PIVOTS),
        ...pivotRuns(pivots, EW_TRIANGLE_MIN_PIVOTS, true),
    ];
    return runs.flatMap(seq => {
        const n = seq.length;
        const w = legSizes(seq);
        const atEdge = isLastPivotInList(seq, pivots);
        const balance = timeBalance(seq, atEdge);
        const sign = legSign(seq);
        if (
            !contracting(w, atEdge) ||
            balance < EW_TIME_BALANCE_MIN ||
            !contractingEndsOk(seq, sign, atr, atEdge)
        )
            return [];
        const slopeAc =
            (seq[3].price - seq[1].price) / (seq[3].index - seq[1].index);
        const slopeBd =
            (seq[4].price - seq[2].price) / (seq[4].index - seq[2].index);
        const converge = slopeAc * slopeBd < 0 ? 1 : EW_UNJUDGED_SCORE;
        const shrinking =
            w.slice(1).filter((l, i) => l < w[i]).length / (w.length - 1);
        const score =
            (converge +
                shrinking +
                balance +
                recency(seq[n - 1].index, lastBarIndex)) /
            4;
        const state =
            n < EW_TRIANGLE_PIVOTS
                ? 'D forming, E next'
                : atEdge
                  ? 'E in progress'
                  : 'complete';
        const labels = TRIANGLE_LABELS.slice(0, n - 1);
        const dir = firstLegDir(seq);
        const last = seq[n - 1].index;
        return [
            {
                structure: 'triangle',
                score,
                candidate: {
                    id: `ew:${dir}:${bars[seq[0].index].time}:tri`,
                    kind: 'elliott',
                    skill: 'elliott-wave',
                    promptLine: elliottPromptLine(
                        `triangle (contracting), A ${dir}`,
                        state,
                        namedPoints(bars, seq, ['0', ...labels], fmt),
                        triangleFacts(seq, atEdge, fmt),
                        score
                    ),
                    segments: [
                        ...legSegments(
                            bars,
                            seq,
                            labels.map(l => `wave_${l}`)
                        ),
                        boundaryLine(bars, seq[1], seq[3], last, 'boundary_ac'),
                        boundaryLine(bars, seq[2], seq[4], last, 'boundary_bd'),
                    ],
                    levels: [],
                    labels: pivotLabels(bars, seq.slice(1), labels),
                },
            },
        ];
    });
}
