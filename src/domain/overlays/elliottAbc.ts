import type {
    Bar,
    ElliottLevel,
    ElliottScoredCandidate,
    OverlayFormat,
    PivotPoint,
} from '@/domain/types';
import {
    EW_ABC_C_TARGETS,
    EW_ABC_C_TOLERANCE,
    EW_ABC_STANDALONE_PIVOTS,
    EW_STANDALONE_ABC_SCORE_FACTOR,
    EW_UNJUDGED_SCORE,
    OVERLAY_LEVEL_LABELS,
} from '@/domain/overlays/constants';
import {
    type AbcType,
    abcTargetLevels,
    abcTargets,
    breachOf,
    classifyAbc,
    elliottPromptLine,
    firstLegDir,
    isLastPivotInList,
    structureLevels,
    legSegments,
    legSign,
    legSizes,
    namedPoints,
    pivotLabels,
    pivotRuns,
    projectedAbcLevels,
    recency,
} from '@/domain/overlays/elliottShared';
import { formatOverlayPrice } from '@/domain/overlays/format';

/**
 * The levels of an A–B–C: C's 100% / 161.8% targets (reached as C runs on
 * with A) and — for a zigzag, whose B may not pass A's start — that start as
 * the invalidation level (passed by B moving against A). Flats have none:
 * their B may run past it.
 */
const abcLevels = (
    seq: readonly PivotPoint[],
    type: AbcType
): ElliottLevel[] => [
    ...abcTargetLevels(seq),
    ...(type === 'zigzag'
        ? [
              {
                  label: OVERLAY_LEVEL_LABELS.invalidation,
                  price: seq[0].price,
                  // B passing A's start, against A.
                  breach: breachOf(-legSign(seq)),
              },
          ]
        : []),
];

/**
 * The same values as prompt facts: the C targets while C forms, and a
 * zigzag's `invalidation <price>`.
 */
function abcFacts(
    seq: readonly PivotPoint[],
    type: AbcType,
    cInProgress: boolean,
    fmt: OverlayFormat
): string[] {
    return [
        // A done C's targets are history, not projections (`projectedAbcLevels`).
        ...(cInProgress ? [abcTargets(seq, fmt)] : []),
        ...(type === 'zigzag'
            ? [`invalidation ${formatOverlayPrice(seq[0].price, fmt)}`]
            : []),
    ];
}

/** 1 when C/A lands near a common target ratio; unjudged while C is forming. */
const cTargetFit = (seq: readonly PivotPoint[], cInProgress: boolean) => {
    if (cInProgress) return EW_UNJUDGED_SCORE;
    const [a, , c] = legSizes(seq);
    return EW_ABC_C_TARGETS.some(
        t => Math.abs(c / a / t - 1) <= EW_ABC_C_TOLERANCE
    )
        ? 1
        : 0;
};

/** Shorter / longer of A's and C's bar counts. */
const aVsCTime = (seq: readonly PivotPoint[]) => {
    const a = seq[1].index - seq[0].index;
    const c = seq[3].index - seq[2].index;
    return Math.min(a, c) / Math.max(a, c);
};

/**
 * @internal
 * Standalone A–B–C corrections (no impulse required before them): every
 * 4-pivot run whose shape `classifyAbc` names. A run ending at the right
 * edge has C in progress. Scored below impulse-anchored counts
 * (EW_STANDALONE_ABC_SCORE_FACTOR).
 */
export function buildAbcCandidates(
    pivots: readonly PivotPoint[],
    bars: readonly Bar[],
    fmt: OverlayFormat
): ElliottScoredCandidate[] {
    const lastBarIndex = bars.length - 1;
    return pivotRuns(pivots, EW_ABC_STANDALONE_PIVOTS).flatMap(seq => {
        const inProgress = isLastPivotInList(seq, pivots);
        const type = classifyAbc(seq, inProgress);
        if (type === null) return [];
        const score =
            EW_STANDALONE_ABC_SCORE_FACTOR *
            ((cTargetFit(seq, inProgress) +
                aVsCTime(seq) +
                recency(seq[3].index, lastBarIndex)) /
                3);
        const dir = firstLegDir(seq);
        const levels = abcLevels(seq, type);
        const drawn = projectedAbcLevels(levels, inProgress);
        return [
            {
                structure: 'abc',
                score,
                levels,
                candidate: {
                    id: `ew:${dir}:${bars[seq[0].index].time}:abc`,
                    kind: 'elliott',
                    skill: 'elliott-wave',
                    promptLine: elliottPromptLine(
                        `A–B–C ${type}, A ${dir}`,
                        inProgress ? 'C in progress' : 'complete',
                        namedPoints(bars, seq, ['0', 'A', 'B', 'C'], fmt),
                        abcFacts(seq, type, inProgress, fmt),
                        score
                    ),
                    segments: legSegments(bars, seq, [
                        'wave_A',
                        'wave_B',
                        'wave_C',
                    ]),
                    levels: structureLevels(bars, seq, drawn, fmt),
                    labels: pivotLabels(bars, seq.slice(1), ['A', 'B', 'C']),
                },
            },
        ];
    });
}
