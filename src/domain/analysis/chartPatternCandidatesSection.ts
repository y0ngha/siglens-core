import { computeCandidateGeometry } from '@/domain/patterns';
import {
    computePatternTargets,
    decimalPlacesOf,
} from '@/domain/analysis/patternTargets';
import {
    formatBarDateTime,
    formatNullableNumber,
    formatSignedPercent,
} from '@/domain/analysis/promptFormat';
import { MS_PER_SECOND } from '@/domain/constants/time';
import type {
    Bar,
    PatternCandidate,
    PatternGeometry,
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
    'These candidates come from a heuristic pre-screener. They are hints, not an exhaustive list and not a verdict: confirm or reject each by the actual shape, and report any other pattern you can clearly see even if it is not listed here — an approximate textbook shape is enough. For a listed candidate you confirm, copy its geometry; for any other pattern you report, fill geometry from the bars yourself.';

/**
 * @internal `YYYY-MM-DD` from a bar's Unix-seconds `time` on a daily chart,
 * `YYYY-MM-DD HH:MM UTC` on an intraday one — a date-only stamp collapses
 * every key point of an hourly pattern onto the same calendar day (real-data
 * defect: an hourly double bottom printed both troughs and the neckline all
 * dated the same day, with no way to tell them apart).
 */
function barDate(unixSeconds: number, timeframe: Timeframe): string {
    const date = new Date(unixSeconds * MS_PER_SECOND);
    if (timeframe === '1Day') return date.toISOString().slice(0, 10);
    return `${formatBarDateTime(date.getTime())} UTC`;
}

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
                          `${p.label} ${formatNullableNumber(p.price, priceDp)} (${barDate(p.time, timeframe)})`
                  )
                  .join(', ')}`
            : '- Key points: N/A';

    // Recompute the anchor/targets through `computePatternTargets` — the ONE
    // shared math `ai-levels.ts` uses when a model copies breakout/extreme/
    // direction into its own `geometry` (spec 2026-09-18 review R6). Reusing
    // `geometry.measuredTarget`/`conservativeTarget` here (each family's own
    // raw, unrounded formula in `patternGeometry.ts`) could byte-mismatch
    // what the app later appends from the exact same two numbers.
    //
    // Round breakout/extreme to the printed precision FIRST and derive every
    // printed number from those rounded values: the model copies what it
    // reads, so the app's recomputation starts from the printed numbers, not
    // from the raw (often non-terminating OLS / averaged) geometry.
    const breakoutLevel = Number(geometry.breakoutLevel.toFixed(priceDp));
    const extremeLevel = Number(
        (geometry.direction === 'up'
            ? geometry.breakoutLevel - geometry.height
            : geometry.breakoutLevel + geometry.height
        ).toFixed(priceDp)
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
        `### ${candidate.id} (${status})`,
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
 * Renders `## Chart Pattern Candidates (computed)` — the pre-screener's hits
 * with deterministic measured-move geometry (spec 2026-09-18 §A1), so the
 * siglens pattern skills can cite a computed target instead of asking the
 * model to work one out. `- None detected by the pre-screener` when the
 * screener found nothing; a candidate whose geometry is unavailable (no
 * `pivots` on the candidate — not expected from a real classifier hit) still
 * gets a one-line block rather than being dropped.
 *
 * @param candidates - Pre-screener hits, already screened once by the caller
 *   (spec 2026-09-18 review R19 — this used to run `screenChartPatterns`
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
 */
export function formatChartPatternCandidatesSection(
    candidates: readonly PatternCandidate[],
    bars: readonly Bar[],
    atr: number | null,
    priceDp: number,
    timeframe: Timeframe
): string {
    if (candidates.length === 0) {
        return [
            CHART_PATTERN_CANDIDATES_SECTION_HEADER,
            CHART_PATTERN_CANDIDATES_SECTION_INTRO,
            '- None detected by the pre-screener',
        ].join('\n');
    }

    const lastClose = bars.length > 0 ? bars[bars.length - 1].close : NaN;
    const blocks = candidates.map(candidate =>
        formatCandidate(
            candidate,
            computeCandidateGeometry(candidate, bars, atr ?? 0),
            lastClose,
            priceDp,
            timeframe
        )
    );

    return [
        CHART_PATTERN_CANDIDATES_SECTION_HEADER,
        CHART_PATTERN_CANDIDATES_SECTION_INTRO,
        ...blocks,
    ].join('\n');
}
