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
    PatternCandidate,
    PatternGeometry,
    PatternTargetGeometry,
    Timeframe,
} from '@/domain/types';

/** @internal Section header — exported so callers/tests reference the exact string (spec 2026-09-18 §A1). */
export const CHART_PATTERN_CANDIDATES_SECTION_HEADER =
    '## Chart Pattern Candidates (computed)';

/**
 * @internal Section intro (spec 2026-09-18 addendum, "hints not a verdict").
 * The pre-screener is a recall-biased shape matcher, not a source of truth:
 * it must never read as a cap on what the model may report. Exported so the
 * test can assert the exact hint/no-restriction wording survives edits.
 */
export const CHART_PATTERN_CANDIDATES_SECTION_INTRO =
    "These candidates come from a heuristic pre-screener. They are hints, not an exhaustive list and not a verdict: confirm or reject each by the actual shape, and report any other pattern you can clearly see even if it is not listed here — an approximate textbook shape is enough. For a listed candidate you confirm, copy its geometry; for any other pattern you report, fill geometry from the bars yourself. For a candidate you confirm, set that pattern's candidateId to its Candidate id.";

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

function formatCandidate(
    candidate: PatternCandidate,
    geometry: PatternGeometry | null,
    overlayId: string | null,
    offeredOverlayIds: ReadonlySet<string>,
    lastClose: number,
    priceDp: number,
    timeframe: Timeframe
): string {
    if (geometry === null) {
        return `### ${candidate.id} — geometry unavailable`;
    }

    const keyPointsLine =
        geometry.keyPoints.length > 0
            ? `- Key points: ${geometry.keyPoints
                  .map(
                      p =>
                          `${p.label} ${formatNullableNumber(p.price, priceDp)} (${formatBarDate(p.time, timeframe)})`
                  )
                  .join(', ')}`
            : '- Key points: N/A';
    // Only print the id when a matching overlay candidate was actually
    // offered — `patternOverlayId` names it deterministically even for a
    // hit `buildPatternOverlayCandidates` skipped (e.g. a flag with
    // `endIndex <= startIndex`, or fewer than 2 in-range pivots), and
    // printing an unoffered id would let the model reference something
    // `resolveChartOverlays` cannot find.
    const candidateIdLine =
        overlayId !== null && offeredOverlayIds.has(overlayId)
            ? `\n- Candidate id: ${overlayId}`
            : '';

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
        keyPointsLine,
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
 * `computeCandidateGeometry` for each candidate, in order. A prompt build
 * computes this once and hands it to both
 * {@link formatChartPatternCandidatesSection} and
 * {@link printedPatternGeometriesByOverlayId}, so the geometry is not
 * recomputed per consumer.
 */
export function candidateGeometries(
    candidates: readonly PatternCandidate[],
    bars: readonly Bar[],
    atr: number | null
): (PatternGeometry | null)[] {
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
 * as {@link formatChartPatternCandidatesSection}.
 *
 * @returns Overlay id → printed geometry.
 */
export function printedPatternGeometriesByOverlayId(
    candidates: readonly PatternCandidate[],
    bars: readonly Bar[],
    atr: number | null,
    priceDp: number,
    offeredOverlayIds: ReadonlySet<string>,
    geometries: readonly (PatternGeometry | null)[] = candidateGeometries(
        candidates,
        bars,
        atr
    )
): Map<string, PatternTargetGeometry> {
    return new Map(
        candidates.flatMap((candidate, i) => {
            const geometry = geometries[i] ?? null;
            if (geometry === null) return [];
            const overlayId = patternOverlayId(candidate, bars);
            return offeredOverlayIds.has(overlayId)
                ? [[overlayId, printedPatternGeometry(geometry, priceDp)]]
                : [];
        })
    );
}

/**
 * @internal
 * Renders `## Chart Pattern Candidates (computed)` — the pre-screener's hits
 * with deterministic measured-move geometry (spec 2026-09-18 §A1), so the
 * siglens pattern skills can cite a computed target instead of asking the
 * model to work one out. `- None detected by the pre-screener` when the
 * screener found nothing; a candidate whose geometry is unavailable (no
 * `pivots` on the candidate — not expected from a real classifier hit) still
 * gets a one-line block rather than being dropped.
 *
 * @param candidates - Pre-screener hits, already screened once by the caller
 *   (spec 2026-09-18 — this used to run `screenChartPatterns`
 *   itself, a second, redundant screener pass every prompt build already
 *   paid for once during skill selection).
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
 *   the caller already built (`buildOverlayCandidates`/`buildPatternOverlayCandidates`).
 *   `patternOverlayId` names a candidate deterministically even when no
 *   drawable overlay was built for it (flag with `endIndex <= startIndex`,
 *   fewer than 2 in-range pivots) — the `- Candidate id:` line only prints
 *   when the id is actually in this set, so the model never references an id
 *   `resolveChartOverlays` cannot resolve.
 */
export function formatChartPatternCandidatesSection(
    candidates: readonly PatternCandidate[],
    bars: readonly Bar[],
    atr: number | null,
    priceDp: number,
    timeframe: Timeframe,
    offeredOverlayIds: ReadonlySet<string>,
    geometries: readonly (PatternGeometry | null)[] = candidateGeometries(
        candidates,
        bars,
        atr
    )
): string {
    if (candidates.length === 0) {
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
    ].join('\n');
}
