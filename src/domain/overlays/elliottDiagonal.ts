import type {
    Bar,
    ElliottLevel,
    ElliottScoredCandidate,
    OverlayCandidate,
    OverlayFormat,
    PivotPoint,
} from '@/domain/types';
import {
    EW_DIAG_LINE_TOLERANCE,
    EW_DIAG_RETRACE_MAX,
    EW_DIAG_RETRACE_MIN,
    EW_DIAG_TREND_MIN_ATR,
    EW_DIAG_WAVE_TOLERANCE,
    EW_IMPULSE_PIVOTS,
    EW_TIME_BALANCE_MIN,
    OVERLAY_LEVEL_LABELS,
} from '@/domain/overlays/constants';
import {
    boundaryLine,
    breachOf,
    elliottPromptLine,
    isLastPivotInList,
    structureLevels,
    legSegments,
    legSizes,
    namedPoints,
    passesRules,
    pivotLabels,
    pivotRuns,
    recency,
    timeBalance,
    waveRatios,
    within,
} from '@/domain/overlays/elliottShared';
import { formatOverlayPrice } from '@/domain/overlays/format';

/** A full 0–5 count whose only broken rule is rule 3 (wave 4 into wave 1): a contracting diagonal. */
interface DiagonalCount {
    seq: PivotPoint[];
    up: boolean;
    /** ending: same-way trend before wave 0; leading: opposite; undecided when too close to call. */
    role: 'leading' | 'ending' | 'leading or ending';
    score: number;
    atRightEdge: boolean;
}

/**
 * Whether a count passing every rule but rule 3 is a contracting diagonal
 * (spec 2026-10-02 §3): wave 4 overlaps wave 1; the 1–3 and 2–4 boundary
 * lines converge (the 1–3 line rises with the trend, so the 2–4 line rises
 * faster: wave 4 stays beyond wave 2's end); waves 1 > 3 (> 5) within
 * EW_DIAG_WAVE_TOLERANCE. The wedge holds its ends (EW_DIAG_LINE_TOLERANCE)
 * and its waves take comparable time (EW_TIME_BALANCE_MIN). Expanding
 * diagonals are not counted: rare, and in the synthetic gate they only added
 * random-walk false positives.
 */
function isContractingDiagonal(
    seq: readonly PivotPoint[],
    up: boolean,
    forming: boolean
): boolean {
    const w = legSizes(seq);
    const motive = w.filter((_, i) => i % 2 === 0);
    const P = (i: number) => (up ? seq[i].price : -seq[i].price);
    const line = (a: number, b: number, x: number) =>
        P(a) +
        ((P(b) - P(a)) * (x - seq[a].index)) / (seq[b].index - seq[a].index);
    // Gap between the 1–3 and 2–4 lines (up-signed) at bar `x`.
    const width = (x: number) => line(1, 3, x) - line(2, 4, x);
    const tolerance = EW_DIAG_LINE_TOLERANCE * w[0];
    // Wave 5 past (+) or short of (−) the 1–3 line.
    const wave5Off = P(5) - line(1, 3, seq[5].index);
    return (
        // Wave 4 into wave 1's territory: the trait that makes it a diagonal
        // (the caller only knows some rule failed — it may be rule 2's).
        P(4) <= P(1) &&
        width(seq[5].index) < width(seq[1].index) &&
        motive.every(
            (m, i) =>
                i === 0 || m <= motive[i - 1] * (1 + EW_DIAG_WAVE_TOLERANCE)
        ) &&
        Math.abs(P(0) - line(2, 4, seq[0].index)) <= tolerance &&
        wave5Off <= tolerance &&
        (forming || wave5Off >= -tolerance) &&
        timeBalance(seq, forming) >= EW_TIME_BALANCE_MIN
    );
}

/** Ending when the swing before wave 0 shows a trend the same way, leading when the opposite way. */
function diagonalRole(
    pivots: readonly PivotPoint[],
    s: number,
    up: boolean,
    atr: number
): DiagonalCount['role'] {
    if (s < 2) return 'leading or ending';
    const sign = up ? 1 : -1;
    const lead = sign * (pivots[s].price - pivots[s - 2].price);
    if (lead > EW_DIAG_TREND_MIN_ATR * atr) return 'ending';
    if (lead < -EW_DIAG_TREND_MIN_ATR * atr) return 'leading';
    return 'leading or ending';
}

function diagonalScore(
    seq: readonly PivotPoint[],
    lastBarIndex: number
): number {
    const w = legSizes(seq);
    const g2 = within(w[1] / w[0], EW_DIAG_RETRACE_MIN, EW_DIAG_RETRACE_MAX);
    const g4 = within(w[3] / w[2], EW_DIAG_RETRACE_MIN, EW_DIAG_RETRACE_MAX);
    return (g2 + g4 + recency(seq[seq.length - 1].index, lastBarIndex)) / 3;
}

const WAVE_LABELS = ['1', '2', '3', '4', '5'] as const;

/**
 * A contracting diagonal's wave 5 must stay shorter than wave 3: its cap is
 * wave 4's end + wave 3's length. Wave 5 forming: invalidated past wave 4's
 * end, with that cap; complete: broken once price runs past the cap.
 */
function diagonalLevels(d: DiagonalCount): ElliottLevel[] {
    const w = legSizes(d.seq);
    const trend = d.up ? 1 : -1;
    const cap = d.seq[4].price + trend * w[2];
    // The cap is passed with the trend — even when wave 5 already edged past
    // it within EW_DIAG_WAVE_TOLERANCE; wave 4's end is passed against it.
    const capLevel = (label: string): ElliottLevel => ({
        label,
        price: cap,
        breach: breachOf(trend),
    });
    return d.atRightEdge
        ? [
              {
                  label: OVERLAY_LEVEL_LABELS.invalidation,
                  price: d.seq[4].price,
                  breach: breachOf(-trend),
              },
              capLevel(OVERLAY_LEVEL_LABELS.wave5Cap),
          ]
        : [capLevel(OVERLAY_LEVEL_LABELS.invalidation)];
}

/** `invalidation 98.20`, `wave 5 cap 120.40`, then the wave ratios. */
function diagonalFacts(
    d: DiagonalCount,
    levels: readonly ElliottLevel[],
    fmt: OverlayFormat
): string[] {
    return [
        ...levels.map(
            l =>
                `${l.label === OVERLAY_LEVEL_LABELS.wave5Cap ? 'wave 5 cap' : l.label} ${formatOverlayPrice(l.price, fmt)}`
        ),
        waveRatios(d.seq, d.atRightEdge),
    ];
}

function toDiagonalCandidate(
    d: DiagonalCount,
    bars: readonly Bar[],
    fmt: OverlayFormat
): OverlayCandidate {
    const dir = d.up ? 'up' : 'down';
    const last = d.seq[d.seq.length - 1].index;
    const state = d.atRightEdge ? 'wave 5 in progress' : 'complete';
    const levels = diagonalLevels(d);
    return {
        id: `ew:${dir}:${bars[d.seq[0].index].time}:diag`,
        kind: 'elliott',
        skill: 'elliott-wave',
        promptLine: elliottPromptLine(
            `diagonal ${dir} (${d.role}, contracting)`,
            state,
            namedPoints(bars, d.seq, ['0', ...WAVE_LABELS], fmt),
            diagonalFacts(d, levels, fmt),
            d.score
        ),
        segments: [
            ...legSegments(
                bars,
                d.seq,
                WAVE_LABELS.map(l => `wave_${l}`)
            ),
            boundaryLine(bars, d.seq[1], d.seq[3], last, 'boundary_13'),
            boundaryLine(bars, d.seq[2], d.seq[4], last, 'boundary_24'),
        ],
        levels: structureLevels(bars, d.seq, levels, fmt),
        labels: pivotLabels(bars, d.seq.slice(1), WAVE_LABELS),
    };
}

/**
 * @internal
 * Contracting diagonals (spec 2026-10-02 §3): full 0–5 counts that pass
 * every impulse rule but rule 3 and form a wedge (`isContractingDiagonal`).
 * A forming wave 4 cannot be told from noise yet, so only counts with wave 5
 * complete or forming qualify. Drawn as waves 1–5 + the 1–3 and 2–4
 * boundaries (dashed, to the last pivot).
 */
export function buildDiagonalCandidates(
    pivots: readonly PivotPoint[],
    bars: readonly Bar[],
    atr: number,
    fmt: OverlayFormat
): ElliottScoredCandidate[] {
    const lastBarIndex = bars.length - 1;
    return pivotRuns(pivots, EW_IMPULSE_PIVOTS).flatMap(seq => {
        const up = seq[0].kind === 'low';
        const atRightEdge = isLastPivotInList(seq, pivots);
        if (
            passesRules(seq, up) ||
            !passesRules(seq, up, true) ||
            !isContractingDiagonal(seq, up, atRightEdge)
        )
            return [];
        const d: DiagonalCount = {
            seq,
            up,
            role: diagonalRole(pivots, pivots.indexOf(seq[0]), up, atr),
            score: diagonalScore(seq, lastBarIndex),
            atRightEdge,
        };
        return [
            {
                structure: 'diagonal' as const,
                score: d.score,
                levels: diagonalLevels(d),
                candidate: toDiagonalCandidate(d, bars, fmt),
            },
        ];
    });
}
