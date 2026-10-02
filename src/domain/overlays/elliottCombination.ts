import type {
    Bar,
    ElliottScoredCandidate,
    OverlayFormat,
    PivotPoint,
} from '@/domain/types';
import {
    EW_COMBO_SIMPLE_PIVOTS,
    EW_COMBO_X_MAX_RETRACE,
    EW_COMBO_X_PREFERRED_MAX,
    EW_COMBO_X_PREFERRED_MIN,
    EW_COMBO_Y_TO_W_MAX,
    EW_COMBO_Y_TO_W_MIN,
    EW_MIN_WAVE_ATR,
    EW_PRIOR_TREND_FULL,
    EW_PRIOR_TREND_MIN,
} from '@/domain/overlays/constants';
import {
    classifyAbc,
    elliottPromptLine,
    firstLegDir,
    isLastPivotInList,
    legSegments,
    legSizes,
    namedPoints,
    pivotLabels,
    pivotRuns,
    priorTrend,
    recency,
    within,
} from '@/domain/overlays/elliottShared';
import { formatOverlayPrice } from '@/domain/overlays/format';

/** Boundary labels of a combination with `simples` simple corrections. */
const comboLabels = (simples: number) =>
    simples === 2 ? ['W', 'X', 'Y'] : ['W', 'X', 'Y', 'X', 'Z'];

/**
 * Size of each boundary leg, X as a share of the simple before it:
 * `W 12.30, X 4.50 (36.6% of W), Y 11.80`.
 */
function comboSizes(
    boundaries: readonly PivotPoint[],
    labels: readonly string[],
    fmt: OverlayFormat
): string {
    const w = legSizes(boundaries);
    return w
        .map((size, i) => {
            const text = `${labels[i]} ${formatOverlayPrice(size, fmt)}`;
            return labels[i] === 'X'
                ? `${text} (${((size / w[i - 1]) * 100).toFixed(1)}% of ${labels[i - 1]})`
                : text;
        })
        .join(', ');
}

/**
 * @internal
 * Combinations W–X–Y (8 pivots) and W–X–Y–X–Z (12) (spec 2026-10-02 §2):
 * each simple correction is 4 pivots that `classifyAbc` names, all move the
 * same way; each X retraces less than EW_COMBO_X_MAX_RETRACE of the simple
 * before it; Y and Z run EW_COMBO_Y_TO_W_MIN–MAX × W. A run ending at the
 * right edge has its last simple's C in progress (only the upper size bound
 * applies then). It must follow a trend into its start (`priorTrend` ≥
 * EW_PRIOR_TREND_MIN over W's bars, in units of W's first leg) and every finished leg spans
 * EW_MIN_WAVE_ATR ATR — without these, random walks offered one on 44% of
 * charts. Drawn boundary-to-boundary with W/X/Y(/X/Z) labels only.
 */
export function buildCombinationCandidates(
    pivots: readonly PivotPoint[],
    bars: readonly Bar[],
    atr: number,
    fmt: OverlayFormat
): ElliottScoredCandidate[] {
    const lastBarIndex = bars.length - 1;
    return [2, 3].flatMap(simples =>
        pivotRuns(pivots, simples * EW_COMBO_SIMPLE_PIVOTS).flatMap(seq => {
            const inProgress = isLastPivotInList(seq, pivots);
            const sign = seq[1].price > seq[0].price ? 1 : -1;
            const parts = Array.from({ length: simples }, (_, j) =>
                seq.slice(
                    j * EW_COMBO_SIMPLE_PIVOTS,
                    (j + 1) * EW_COMBO_SIMPLE_PIVOTS
                )
            );
            const net = parts.map(
                p => sign * (p[p.length - 1].price - p[0].price)
            );
            const types = parts.map((p, j) =>
                classifyAbc(p, inProgress && j === simples - 1)
            );
            // X between simple j-1 and j, as a share of simple j-1's net move.
            const xRetrace = parts
                .slice(1)
                .map(
                    (p, j) => (sign * (parts[j][3].price - p[0].price)) / net[j]
                );
            const ratio = net.slice(1).map(v => v / net[0]);
            const legs = legSizes(seq);
            const trend = priorTrend(
                bars,
                seq,
                seq[3].index - seq[0].index,
                legs[0]
            );
            const ok =
                trend >= EW_PRIOR_TREND_MIN &&
                (inProgress ? legs.slice(0, -1) : legs).every(
                    l => l >= EW_MIN_WAVE_ATR * atr
                ) &&
                net.every(v => v > 0) &&
                types.every(t => t !== null) &&
                xRetrace.every(r => r > 0 && r < EW_COMBO_X_MAX_RETRACE) &&
                ratio.every(
                    (r, j) =>
                        r <= EW_COMBO_Y_TO_W_MAX &&
                        ((inProgress && j === ratio.length - 1) ||
                            r >= EW_COMBO_Y_TO_W_MIN)
                );
            if (!ok) return [];
            const boundaries = parts.flatMap(p => [p[0], p[3]]);
            const symmetry =
                ratio.reduce(
                    (s, r) =>
                        s +
                        Math.max(
                            0,
                            1 -
                                Math.abs(Math.log(r)) /
                                    Math.log(EW_COMBO_Y_TO_W_MAX)
                        ),
                    0
                ) / ratio.length;
            const xFit =
                xRetrace.reduce(
                    (s, r) =>
                        s +
                        within(
                            r,
                            EW_COMBO_X_PREFERRED_MIN,
                            EW_COMBO_X_PREFERRED_MAX
                        ),
                    0
                ) / xRetrace.length;
            const score =
                (symmetry +
                    xFit +
                    Math.min(1, trend / EW_PRIOR_TREND_FULL) +
                    recency(seq[seq.length - 1].index, lastBarIndex)) /
                4;
            const labels = comboLabels(simples);
            const dir = firstLegDir(seq);
            const last = labels[labels.length - 1];
            return [
                {
                    structure: 'combination' as const,
                    score,
                    candidate: {
                        id: `ew:${dir}:${bars[seq[0].index].time}:${simples === 2 ? 'combo' : 'combo3'}`,
                        kind: 'elliott' as const,
                        skill: 'elliott-wave',
                        promptLine: elliottPromptLine(
                            `combination ${labels.join('–')} (${types.join(' + ')}), W ${dir}`,
                            inProgress ? `${last} in progress` : 'complete',
                            namedPoints(
                                bars,
                                boundaries,
                                ['0', ...labels],
                                fmt
                            ),
                            [comboSizes(boundaries, labels, fmt)],
                            score
                        ),
                        segments: legSegments(
                            bars,
                            boundaries,
                            labels.map((l, i) =>
                                i === 3 ? 'wave_X2' : `wave_${l}`
                            )
                        ),
                        levels: [],
                        labels: pivotLabels(bars, boundaries.slice(1), labels),
                    },
                },
            ];
        })
    );
}
