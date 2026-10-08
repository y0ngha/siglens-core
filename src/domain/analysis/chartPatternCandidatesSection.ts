import { computeCandidateGeometry } from '@/domain/patterns';
import {
    computePatternTargets,
    decimalPlacesOf,
    printedPatternGeometry,
} from '@/domain/analysis/patternTargets';
import {
    formatBarDate,
    formatNullableNumber,
    formatSignedPercent,
} from '@/domain/analysis/promptFormat';
import { patternOverlayId } from '@/domain/overlays/patternOverlays';
import type {
    Bar,
    ChartPatternId,
    PatternGeometry,
    PatternTargetGeometry,
    QualifiedPattern,
    QualifiedPatternGeometry,
    Timeframe,
    UndirectedPatternGeometry,
} from '@/domain/types';

/** @internal Section header — exported so callers/tests reference the exact string (spec 2026-09-18 §A1). */
export const CHART_PATTERN_CANDIDATES_SECTION_HEADER =
    '## Chart Pattern Candidates (computed)';

/**
 * @internal Section intro (spec 2026-09-18 addendum, "hints not a verdict";
 * spec 2026-10-07 for the drawable / shape-hint split). The listing must
 * never read as a cap on what the model may report. Exported so the test can
 * assert the exact hint/no-restriction wording survives edits.
 */
export const CHART_PATTERN_CANDIDATES_SECTION_INTRO =
    'These candidates come from a heuristic pre-screener. They are hints, not an exhaustive list and not a verdict: confirm or reject each by the actual shape, and report any other pattern you can clearly see even if it is not listed here — an approximate textbook shape is enough. For a listed candidate you confirm, copy its geometry; for any other pattern you report, fill geometry from the bars yourself. For a candidate you confirm, set that pattern\'s candidateId to its Candidate id. A line marked "shape hint — not drawable" is a loose shape match that failed the drawing checks (confirmed swings, boundary touches, slope, size): it has no Candidate id and no computed levels, so leave candidateId empty if you report that pattern.';

/** @internal The one-line marker of a pre-screener hit that did not qualify for drawing (spec 2026-10-07 §1). */
export const SHAPE_HINT_MARKER = 'shape hint — not drawable';

/**
 * `<price> (from ±x.xx% distance line)` — this file's shared "level + %
 * distance from the last close" line format. `N/A` when `level` is `null`.
 */
function formatLevelLine(
    label: string,
    level: number | null,
    lastClose: number,
    priceDp: number
): string {
    // A target at or below zero (a down pattern taller than its breakout
    // level) is not a price — N/A, never a negative quotable "target".
    if (level === null || !Number.isFinite(level) || level <= 0)
        return `- ${label}: N/A`;
    const distance =
        Number.isFinite(lastClose) && lastClose > 0
            ? ` (${formatSignedPercent(((level - lastClose) / lastClose) * 100)} from last close)`
            : '';
    return `- ${label}: ${formatNullableNumber(level, priceDp)}${distance}`;
}

/** Whether the last close has already moved past the (printed, rounded) breakout level, in the pattern's own breakout direction. */
function isBroken(
    direction: PatternGeometry['direction'],
    breakoutLevel: number,
    lastClose: number
): boolean {
    return direction === 'up'
        ? lastClose > breakoutLevel
        : lastClose < breakoutLevel;
}

/** Key points whose spacing the pattern skills gate on (double/triple tops and bottoms, head and shoulders). */
const SPACED_POINT =
    /^(?:peak \d+|trough \d+|left shoulder|head|right shoulder)$/;

/**
 * @internal `- Spacing (bars): trough 1 → trough 2: 5` — bars between consecutive
 * structural points, or `null` when fewer than two apply. The skills gate on
 * this (double bottom troughs ≥ 10 bars apart, …) and the model miscounted it
 * from dates — and still from per-point "N bars ago" (8 → 3 read as "14봉",
 * 2026-10-02 A/B) — so the subtraction is done here.
 */
export function spacingLine(
    keyPoints: PatternGeometry['keyPoints']
): string | null {
    const pts = keyPoints
        .filter(p => SPACED_POINT.test(p.label) && Number.isInteger(p.index))
        .toSorted((a, b) => a.index - b.index);
    if (pts.length < 2) return null;
    const gaps = pts
        .slice(1)
        .map(
            (p, i) => `${pts[i].label} → ${p.label}: ${p.index - pts[i].index}`
        );
    return `- Spacing (bars): ${gaps.join(' / ')}`;
}

/** `- Key points: label price (date), …`, or `N/A` when there are none. */
function keyPointsLine(
    keyPoints: PatternGeometry['keyPoints'],
    priceDp: number,
    timeframe: Timeframe
): string {
    return keyPoints.length > 0
        ? `- Key points: ${keyPoints
              .map(
                  p =>
                      `${p.label} ${formatNullableNumber(p.price, priceDp)} (${formatBarDate(p.time, timeframe)})`
              )
              .join(', ')}`
        : '- Key points: N/A';
}

/**
 * A boundary pair with no prior trend (spec 2026-10-07 §3.2): both
 * boundaries as they stand, no direction and no target — the status is
 * `broken` once the last close sits outside either printed boundary.
 */
function formatUndirectedCandidate(
    candidate: QualifiedPattern,
    geometry: UndirectedPatternGeometry,
    candidateIdLine: string,
    lastClose: number,
    priceDp: number,
    timeframe: Timeframe
): string {
    const upper = Number(geometry.upperLevel.toFixed(priceDp));
    const lower = Number(geometry.lowerLevel.toFixed(priceDp));
    const status =
        lastClose > upper || lastClose < lower ? 'broken' : 'forming';
    return [
        `### ${candidate.id} (${status})${candidateIdLine}`,
        keyPointsLine(geometry.keyPoints, priceDp, timeframe),
        formatLevelLine('Upper boundary', upper, lastClose, priceDp),
        formatLevelLine('Lower boundary', lower, lastClose, priceDp),
        '- Direction: undetermined (no prior trend) — no measured target until a close outside a boundary',
        `- Height: ${formatNullableNumber(geometry.height, priceDp)}`,
    ].join('\n');
}

function formatCandidate(
    candidate: QualifiedPattern,
    geometry: QualifiedPatternGeometry | null,
    overlayId: string | null,
    offeredOverlayIds: ReadonlySet<string>,
    lastClose: number,
    priceDp: number,
    timeframe: Timeframe
): string {
    if (geometry === null) {
        return `### ${candidate.id} — geometry unavailable`;
    }

    // Only print the id when a matching overlay candidate was actually
    // offered — `patternOverlayId` names it deterministically even for a
    // pattern `buildOverlayCandidates` dropped (a segment that does not run
    // forward), and printing an unoffered id would let the model reference
    // something `resolveChartOverlays` cannot find.
    const candidateIdLine =
        overlayId !== null && offeredOverlayIds.has(overlayId)
            ? `\n- Candidate id: ${overlayId}`
            : '';
    if (geometry.direction === null) {
        return formatUndirectedCandidate(
            candidate,
            geometry,
            candidateIdLine,
            lastClose,
            priceDp,
            timeframe
        );
    }
    const spacing = spacingLine(geometry.keyPoints);

    // Recompute the anchor/targets through `computePatternTargets` — the ONE
    // shared math `ai-levels.ts` uses when a model copies breakout/extreme/
    // direction into its own `geometry` (spec 2026-09-18). Reusing
    // `geometry.measuredTarget`/`conservativeTarget` here (each family's own
    // raw, unrounded formula in `patternGeometry.ts`) could byte-mismatch
    // what the app later appends from the exact same two numbers.
    const { breakoutLevel, extremeLevel } = printedPatternGeometry(
        geometry,
        priceDp
    );
    const targets = computePatternTargets(
        breakoutLevel,
        extremeLevel,
        geometry.direction
    );
    // Status from the SAME rounded breakout the block prints, so a close equal
    // to the printed level never reads "broken".
    const status = isBroken(geometry.direction, breakoutLevel, lastClose)
        ? 'broken'
        : 'forming';
    // The conservative target (a halved height) can need one more decimal
    // than `priceDp` carries — print it at whichever precision is wider so
    // the listed number is the exact one `ai-levels.ts` would also produce.
    const conservativeDp = Math.max(
        priceDp,
        decimalPlacesOf(targets.conservativeTarget)
    );

    return [
        `### ${candidate.id} (${status})${candidateIdLine}`,
        keyPointsLine(geometry.keyPoints, priceDp, timeframe),
        ...(spacing === null ? [] : [spacing]),
        formatLevelLine('Breakout level', breakoutLevel, lastClose, priceDp),
        // The measured-move anchor, printed as breakout ∓ height so a model
        // that copies breakout/extreme/direction into `geometry` makes the app
        // recompute exactly the targets listed here (height = |extreme − breakout|).
        formatLevelLine('Extreme level', extremeLevel, lastClose, priceDp),
        `- Direction: ${geometry.direction}`,
        `- Height: ${formatNullableNumber(targets.height, priceDp)}`,
        formatLevelLine(
            'Measured target',
            targets.measuredTarget,
            lastClose,
            priceDp
        ),
        formatLevelLine(
            'Conservative target (50%)',
            targets.conservativeTarget,
            lastClose,
            conservativeDp
        ),
        formatLevelLine(
            'Invalidation level',
            geometry.invalidationLevel,
            lastClose,
            priceDp
        ),
    ].join('\n');
}

/**
 * @internal
 * `computeCandidateGeometry` for each qualified pattern, in order. A prompt
 * build computes this once and hands it to both
 * {@link formatChartPatternCandidatesSection} and
 * {@link printedPatternGeometriesByOverlayId}, so the geometry is not
 * recomputed per consumer.
 */
export function candidateGeometries(
    candidates: readonly QualifiedPattern[],
    bars: readonly Bar[],
    atr: number | null
): (QualifiedPatternGeometry | null)[] {
    return candidates.map(candidate =>
        computeCandidateGeometry(candidate, bars, atr ?? 0)
    );
}

/**
 * @internal
 * {@link printedPatternGeometry} for every candidate whose `- Candidate id:`
 * line the section prints, keyed by that overlay id — the geometry a pattern
 * card resolved to that overlay must carry so its app-computed targets match
 * the breakout line the chart draws. Same inputs and same offered-id filter
 * as {@link formatChartPatternCandidatesSection}. An undirected pattern (no
 * prior trend) has no breakout side and no target: its entry is `null`, so
 * `alignPatternGeometry` strips a resolved card's geometry instead of keeping
 * the model's own.
 *
 * @returns Overlay id → printed geometry (`null` for an undirected pattern).
 */
export function printedPatternGeometriesByOverlayId(
    candidates: readonly QualifiedPattern[],
    bars: readonly Bar[],
    atr: number | null,
    priceDp: number,
    offeredOverlayIds: ReadonlySet<string>,
    geometries: readonly (QualifiedPatternGeometry | null)[] = candidateGeometries(
        candidates,
        bars,
        atr
    )
): Map<string, PatternTargetGeometry | null> {
    return new Map(
        candidates.flatMap(
            (candidate, i): [string, PatternTargetGeometry | null][] => {
                const geometry = geometries[i] ?? null;
                if (geometry === null) return [];
                const overlayId = patternOverlayId(candidate, bars);
                if (!offeredOverlayIds.has(overlayId)) return [];
                return [
                    [
                        overlayId,
                        geometry.direction === null
                            ? null
                            : printedPatternGeometry(geometry, priceDp),
                    ],
                ];
            }
        )
    );
}

/**
 * @internal
 * Renders `## Chart Pattern Candidates (computed)` — the qualified patterns
 * with deterministic measured-move geometry (spec 2026-09-18 §A1, spec
 * 2026-10-07), so the siglens pattern skills can cite a computed target
 * instead of asking the model to work one out, followed by one
 * `### <id> — shape hint — not drawable` line per pre-screener hit that did
 * not qualify (no Candidate id, no numbers). `- None detected by the
 * pre-screener` when there is neither; a qualified pattern whose geometry is
 * unavailable (boundaries crossed by the last bar) still gets a one-line
 * block rather than being dropped.
 *
 * @param candidates - Qualified patterns (`qualifyPatterns`), computed once
 *   by the caller and shared with the overlay builder.
 * @param shapeHints - Pre-screener ids with no qualified pattern
 *   (`qualifyPatterns`' `shapeHints`).
 * @param bars - Full bar series, oldest-first (same series the technical
 *   prompt's indicators were computed from).
 * @param atr - Average True Range for `bars`; `null`/non-positive degrades
 *   geometry to unavailable for every candidate, matching
 *   `computeCandidateGeometry` itself.
 * @param priceDp - Decimal places for every price in this section (same
 *   precision the rest of the technical prompt uses).
 * @param timeframe - Bar resolution; key-point dates render date-only on
 *   `'1Day'` and `YYYY-MM-DD HH:MM UTC` on every intraday timeframe.
 * @param offeredOverlayIds - Ids of the `kind: 'pattern'` overlay candidates
 *   the caller already built (`buildOverlayCandidates`). `patternOverlayId`
 *   names a candidate deterministically even when its overlay was dropped
 *   (a segment that does not run forward) — the `- Candidate id:` line only
 *   prints when the id is actually in this set, so the model never
 *   references an id `resolveChartOverlays` cannot resolve.
 */
export function formatChartPatternCandidatesSection(
    candidates: readonly QualifiedPattern[],
    shapeHints: readonly ChartPatternId[],
    bars: readonly Bar[],
    atr: number | null,
    priceDp: number,
    timeframe: Timeframe,
    offeredOverlayIds: ReadonlySet<string>,
    geometries: readonly (QualifiedPatternGeometry | null)[] = candidateGeometries(
        candidates,
        bars,
        atr
    )
): string {
    if (candidates.length === 0 && shapeHints.length === 0) {
        return [
            CHART_PATTERN_CANDIDATES_SECTION_HEADER,
            CHART_PATTERN_CANDIDATES_SECTION_INTRO,
            '- None detected by the pre-screener',
        ].join('\n');
    }

    const lastClose = bars.length > 0 ? bars[bars.length - 1].close : NaN;
    const blocks = candidates.map((candidate, i) => {
        const geometry = geometries[i] ?? null;
        return formatCandidate(
            candidate,
            geometry,
            geometry !== null ? patternOverlayId(candidate, bars) : null,
            offeredOverlayIds,
            lastClose,
            priceDp,
            timeframe
        );
    });

    return [
        CHART_PATTERN_CANDIDATES_SECTION_HEADER,
        CHART_PATTERN_CANDIDATES_SECTION_INTRO,
        ...blocks,
        ...shapeHints.map(id => `### ${id} — ${SHAPE_HINT_MARKER}`),
    ].join('\n');
}
