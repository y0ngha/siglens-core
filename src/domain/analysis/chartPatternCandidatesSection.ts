import { computeCandidateGeometry } from '@/domain/patterns';
import { lineValueAt } from '@/domain/patterns/boundaryLines';
import { BOUNDARY_CONTAINMENT_ATR } from '@/domain/patterns/constants';
import {
    computePatternTargets,
    decimalPlacesOf,
    printedPatternGeometry,
} from '@/domain/analysis/patternTargets';
import {
    formatBarDate,
    formatNullableNumber,
    formatQuotedPrice,
    formatSignedPercent,
    roundQuotedPrice,
    type PriceQuoting,
} from '@/domain/analysis/promptFormat';
import { patternOverlayId } from '@/domain/overlays/patternOverlays';
import { COMPUTED_SECTIONS_HEADING } from '@/domain/analysis/computedSectionsHeading';
import type {
    Bar,
    PatternGeometry,
    PatternLine,
    PatternTargetGeometry,
    QualifiedPattern,
    QualifiedPatternGeometry,
    Timeframe,
    UndirectedPatternGeometry,
} from '@/domain/types';

/** @internal Section header — exported so callers/tests reference the exact string. */
export const CHART_PATTERN_CANDIDATES_SECTION_HEADER =
    '## Chart Pattern Candidates (computed)';

/**
 * @internal Section intro ("hints not a verdict" for pre-screener\n * hits; the measured patterns are qualified). The listing must never read as
 * a cap on what the model may report. Exported so the test can assert the
 * exact wording survives edits.
 *
 * Model-facing wording only: it never names how the list is produced
 * (screening, qualification, drawing checks), and how to write about it is
 * the general rule in ## Analysis Guidelines (`COMPUTED_SECTIONS_RULES` in
 * prompt.ts) — one rule for every computed section. The 2026-10-08 A/B found
 * process wording copied into user-facing text (8 of 18 runs: "사전 스크리너가
 * … 그리기 검증을 통과하지 못해"), and a later run retold the one-line list of
 * unconfirmed shape resemblances that used to close this section (4 of 18:
 * "확정 경계 없는 모양 유사 수준으로만 잡혀 있어 …"). Those loose hits still pick
 * skill docs (`selectionIds` in prompt.ts); they are no longer named here.
 */
export const CHART_PATTERN_CANDIDATES_SECTION_INTRO = `Each pattern below is measured from confirmed swing points. The list is not exhaustive and not a verdict: confirm or reject each by the actual shape, and you may also report a pattern this section does not name if you can clearly see it in the bars. For a listed pattern you confirm, copy its geometry and set its candidateId to its Candidate id; for any other pattern you report, leave candidateId empty and set geometry to null — only listed patterns carry levels and targets. Write about them as ${COMPUTED_SECTIONS_HEADING} in ## Analysis Guidelines says.`;

/** @internal Block status of a pattern whose breakout failed (see {@link isFailedBreakout}). */
export const FAILED_BREAKOUT_STATUS = 'failed breakout';

/** @internal The line printed when the section lists nothing. */
export const NO_CHART_PATTERNS_LINE = '- No pattern listed';

/**
 * `<price> (from ±x.xx% distance line)` — this file's shared "level + %
 * distance from the last close" line format. `N/A` when `level` is `null`.
 */
function formatLevelLine(
    label: string,
    level: number | null,
    lastClose: number,
    quoting: PriceQuoting
): string {
    // A target at or below zero (a down pattern taller than its breakout
    // level) is not a price — N/A, never a negative quotable "target".
    if (level === null || !Number.isFinite(level) || level <= 0)
        return `- ${label}: N/A`;
    const distance =
        Number.isFinite(lastClose) && lastClose > 0
            ? ` (${formatSignedPercent(((level - lastClose) / lastClose) * 100)} from last close)`
            : '';
    return `- ${label}: ${formatQuotedPrice(level, quoting)}${distance}`;
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

/** What {@link isFailedBreakout} reads of a pattern's geometry. */
type BreakoutGeometry =
    | Pick<PatternGeometry, 'direction' | 'breakoutLevel'>
    | Pick<UndirectedPatternGeometry, 'direction'>;

/**
 * @internal
 * Whether a pattern already broke out and failed: after the breakout line's
 * last touch (a boundary pair or flag) or the pattern's last structural point
 * (every other directed family), a close went beyond the breakout line by
 * more than the containment slack (either boundary, for an undirected pair),
 * and the last close is back inside. Printing such a pattern as plainly
 * `forming` hid that price already broke it once and came back (2026-10-08
 * sweep). The pattern stays listed and drawn — its structure is intact, and
 * only a close past its invalidation spends it (`isSpentPattern`) — and
 * prints `failed breakout`.
 *
 * The neckline families (double/triple tops and bottoms, head and shoulders,
 * cup and handle, rounding, high tight flag) read the printed breakout level
 * (a head and shoulders' neckline at its break bar, as `isBroken` does) and
 * count as back only once the last close is on the pattern's side of it, so
 * a retest from the broken side stays `broken`. They were left out at first,
 * so a double top that closed under its neckline and climbed back still
 * printed `forming` with its measured target as a live projection
 * (2026-10-18). `false` when the last close is itself outside (that is
 * `broken`) and for an undirected pattern of any other family.
 */
export function isFailedBreakout(
    candidate: QualifiedPattern,
    geometry: BreakoutGeometry,
    bars: readonly Bar[],
    atr: number | null
): boolean {
    const { shape } = candidate;
    if (atr === null || !(atr > 0) || bars.length === 0) return false;
    const slack = BOUNDARY_CONTAINMENT_ATR * atr;
    const lastIndex = bars.length - 1;
    /**
     * Broke out and came back: beyond `levelAt` by more than the slack after
     * `start`, and at the last bar back `inside` — `inside` says what counts
     * as back.
     */
    const brokeAndReturned = (
        levelAt: (i: number) => number,
        sign: number,
        start: number,
        inside: (offset: number) => boolean
    ): boolean => {
        const offset = (bar: Bar, i: number): number =>
            sign * (bar.close - levelAt(i));
        return (
            inside(offset(bars[lastIndex], lastIndex)) &&
            bars
                .slice(start, lastIndex)
                .some((bar, k) => offset(bar, start + k) > slack)
        );
    };
    const { direction } = geometry;
    if (shape.kind === 'trendline' || shape.kind === 'flag') {
        const sides: { line: PatternLine; sign: number }[] = [
            ...(direction !== 'down' ? [{ line: shape.upper, sign: 1 }] : []),
            ...(direction !== 'up' ? [{ line: shape.lower, sign: -1 }] : []),
        ];
        return sides.some(({ line, sign }) =>
            brokeAndReturned(
                i => lineValueAt(line, i),
                sign,
                line.end.index + 1,
                offset => offset <= slack
            )
        );
    }
    if (!('breakoutLevel' in geometry)) return false;
    // Back means back on the pattern's side of the breakout level — the
    // caller passes the printed (rounded) level `isBroken` reads, so the two
    // never disagree, and a
    // throwback that retests the neckline from the broken side stays
    // `broken` rather than reading as a failure.
    const { breakoutLevel } = geometry;
    return brokeAndReturned(
        () => breakoutLevel,
        geometry.direction === 'up' ? 1 : -1,
        candidate.endIndex + 1,
        offset => offset <= 0
    );
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
    quoting: PriceQuoting,
    timeframe: Timeframe
): string {
    return keyPoints.length > 0
        ? `- Key points: ${keyPoints
              .map(
                  p =>
                      `${p.label} ${formatQuotedPrice(p.price, quoting)} (${formatBarDate(p.time, timeframe)})`
              )
              .join(', ')}`
        : '- Key points: N/A';
}

/**
 * A boundary pair with no prior trend: both
 * boundaries as they stand, no direction and no target — the status is
 * `broken` once the last close sits outside either printed boundary.
 */
function formatUndirectedCandidate(
    candidate: QualifiedPattern,
    geometry: UndirectedPatternGeometry,
    candidateIdLine: string,
    lastClose: number,
    quoting: PriceQuoting,
    timeframe: Timeframe,
    failed: boolean
): string {
    const upper = Number(
        roundQuotedPrice(geometry.upperLevel, quoting).toFixed(quoting.dp)
    );
    const lower = Number(
        roundQuotedPrice(geometry.lowerLevel, quoting).toFixed(quoting.dp)
    );
    const status =
        lastClose > upper || lastClose < lower
            ? 'broken'
            : failed
              ? FAILED_BREAKOUT_STATUS
              : 'forming';
    return [
        `### ${candidate.id} (${status})${candidateIdLine}`,
        keyPointsLine(geometry.keyPoints, quoting, timeframe),
        formatLevelLine('Upper boundary', upper, lastClose, quoting),
        formatLevelLine('Lower boundary', lower, lastClose, quoting),
        '- Direction: undetermined (no prior trend) — no measured target until a close outside a boundary',
        `- Height: ${formatNullableNumber(geometry.height, quoting.dp)}`,
    ].join('\n');
}

function formatCandidate(
    candidate: QualifiedPattern,
    geometry: QualifiedPatternGeometry | null,
    overlayId: string | null,
    offeredOverlayIds: ReadonlySet<string>,
    lastClose: number,
    quoting: PriceQuoting,
    timeframe: Timeframe,
    failed: boolean
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
            quoting,
            timeframe,
            failed
        );
    }
    const spacing = spacingLine(geometry.keyPoints);

    // Recompute the anchor/targets through `computePatternTargets` — the ONE
    // shared math `ai-levels.ts` uses when a model copies breakout/extreme/
    // direction into its own `geometry`. Reusing
    // `geometry.measuredTarget`/`conservativeTarget` here (each family's own
    // raw, unrounded formula in `patternGeometry.ts`) could byte-mismatch
    // what the app later appends from the exact same two numbers.
    const { breakoutLevel, extremeLevel } = printedPatternGeometry(
        geometry,
        quoting
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
        : failed
          ? FAILED_BREAKOUT_STATUS
          : 'forming';
    // The conservative target (a halved height) can need one more decimal
    // than `quoting` carries — print it at whichever precision is wider so
    // the listed number is the exact one `ai-levels.ts` would also produce.
    // A KRX price is rounded to its tick, which has no fraction, so it prints
    // at `quoting.dp` — a wider precision would print `205500.0`.
    const conservativeDp =
        quoting.krxTick !== null
            ? quoting.dp
            : Math.max(quoting.dp, decimalPlacesOf(targets.conservativeTarget));

    return [
        `### ${candidate.id} (${status})${candidateIdLine}`,
        keyPointsLine(geometry.keyPoints, quoting, timeframe),
        ...(spacing === null ? [] : [spacing]),
        formatLevelLine('Breakout level', breakoutLevel, lastClose, quoting),
        // The measured-move anchor, printed as breakout ∓ height so a model
        // that copies breakout/extreme/direction into `geometry` makes the app
        // recompute exactly the targets listed here (height = |extreme − breakout|).
        formatLevelLine('Extreme level', extremeLevel, lastClose, quoting),
        `- Direction: ${geometry.direction}`,
        `- Height: ${formatNullableNumber(targets.height, quoting.dp)}`,
        formatLevelLine(
            'Measured target',
            targets.measuredTarget,
            lastClose,
            quoting
        ),
        formatLevelLine(
            'Conservative target (50%)',
            targets.conservativeTarget,
            lastClose,
            { ...quoting, dp: conservativeDp }
        ),
        formatLevelLine(
            'Invalidation level',
            geometry.invalidationLevel,
            lastClose,
            quoting
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
    quoting: PriceQuoting,
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
                            : printedPatternGeometry(geometry, quoting),
                    ],
                ];
            }
        )
    );
}

/**
 * @internal
 * Renders `## Chart Pattern Candidates (computed)` — the qualified patterns
 * with deterministic measured-move geometry, so the siglens pattern skills can cite a computed target
 * instead of asking the model to work one out. Pre-screener hits that did not
 * qualify are not named (see {@link CHART_PATTERN_CANDIDATES_SECTION_INTRO}).
 * {@link NO_CHART_PATTERNS_LINE} when nothing qualified; a qualified pattern whose geometry is unavailable
 * (boundaries crossed by the last bar) still gets a one-line block rather
 * than being dropped.
 *
 * @param candidates - Qualified patterns (`qualifyPatterns`), computed once
 *   by the caller and shared with the overlay builder.
 * @param bars - Full bar series, oldest-first (same series the technical
 *   prompt's indicators were computed from).
 * @param atr - Average True Range for `bars`; `null`/non-positive degrades
 *   geometry to unavailable for every candidate, matching
 *   `computeCandidateGeometry` itself.
 * @param quoting - How every price in this section is quoted (same quoting
 *   the rest of the technical prompt uses).
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
    bars: readonly Bar[],
    atr: number | null,
    quoting: PriceQuoting,
    timeframe: Timeframe,
    offeredOverlayIds: ReadonlySet<string>,
    geometries: readonly (QualifiedPatternGeometry | null)[] = candidateGeometries(
        candidates,
        bars,
        atr
    )
): string {
    if (candidates.length === 0) {
        return [
            CHART_PATTERN_CANDIDATES_SECTION_HEADER,
            CHART_PATTERN_CANDIDATES_SECTION_INTRO,
            NO_CHART_PATTERNS_LINE,
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
            quoting,
            timeframe,
            geometry !== null &&
                isFailedBreakout(
                    candidate,
                    // The printed (rounded) breakout, as `isBroken` reads it.
                    geometry.direction === null
                        ? geometry
                        : {
                              direction: geometry.direction,
                              breakoutLevel: printedPatternGeometry(
                                  geometry,
                                  quoting
                              ).breakoutLevel,
                          },
                    bars,
                    atr
                )
        );
    });

    return [
        CHART_PATTERN_CANDIDATES_SECTION_HEADER,
        CHART_PATTERN_CANDIDATES_SECTION_INTRO,
        ...blocks,
    ].join('\n');
}
