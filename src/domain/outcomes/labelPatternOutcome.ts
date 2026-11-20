import { computePatternTargets } from '@/domain/analysis/patternTargets';
import type {
    OutcomePatternSubject,
    OutcomeWindow,
    PatternBreakout,
    PatternOutcomeLabel,
    PatternRaceResult,
} from '@/domain/outcomes/types';
import { forwardBar, forwardOffsets } from '@/domain/outcomes/windowSeries';

/**
 * `sign` is `+1` for an `up` pattern and `−1` for a `down` one; multiplying every price
 * difference by it turns each comparison around, so one rule serves both directions.
 *
 * On one bar the invalidation touch (the low for `up`) is checked before the breakout
 * close: the intrabar order is unknown, and the conservative reading is that the pattern
 * failed first.
 */
function findBreakout(
    sign: 1 | -1,
    breakout: number,
    invalidation: number | null,
    window: OutcomeWindow
): PatternBreakout | 'no_breakout' | 'invalidated_before_breakout' {
    if (sign * (window.referencePrice - breakout) > 0) {
        return {
            alreadyBroken: true,
            offset: 0,
            start: window.referencePrice,
        };
    }
    const found = forwardOffsets(window)
        .map(
            (
                offset
            ): PatternBreakout | 'invalidated_before_breakout' | null => {
                const bar = forwardBar(window, offset);
                const extreme = sign === 1 ? bar.low : bar.high;
                if (
                    invalidation !== null &&
                    sign * (extreme - invalidation) <= 0
                ) {
                    return 'invalidated_before_breakout';
                }
                return sign * (bar.close - breakout) > 0
                    ? { alreadyBroken: false, offset, start: bar.close }
                    : null;
            }
        )
        .find(result => result !== null);
    return found ?? 'no_breakout';
}

/**
 * Per bar from `from`: an open past the target or the invalidation is a gap, a bar
 * touching both is `ambiguous`.
 */
function race(
    sign: 1 | -1,
    target: number,
    invalidation: number | null,
    from: number,
    window: OutcomeWindow
): PatternRaceResult {
    const raceAt = (offset: number): PatternRaceResult | null => {
        const bar = forwardBar(window, offset);
        const best = sign === 1 ? bar.high : bar.low;
        const worst = sign === 1 ? bar.low : bar.high;
        const targetHit = sign * (best - target) >= 0;
        const invalidationHit =
            invalidation !== null && sign * (worst - invalidation) <= 0;
        const resolveOffset = offset;
        if (sign * (bar.open - target) >= 0) {
            return { outcome: 'target_first', resolveOffset, gap: true };
        }
        if (invalidation !== null && sign * (bar.open - invalidation) <= 0) {
            return { outcome: 'invalidation_first', resolveOffset, gap: true };
        }
        if (targetHit && invalidationHit) {
            return { outcome: 'ambiguous', resolveOffset, gap: false };
        }
        if (targetHit) {
            return { outcome: 'target_first', resolveOffset, gap: false };
        }
        return invalidationHit
            ? { outcome: 'invalidation_first', resolveOffset, gap: false }
            : null;
    };
    return (
        forwardOffsets(window)
            .filter(offset => offset >= from)
            .map(raceAt)
            .find(result => result !== null) ?? {
            outcome: 'open_at_horizon',
            resolveOffset: null,
            gap: false,
        }
    );
}

/**
 * Labels one detected chart pattern. `pattern` is in the **subject's** basis (as stored);
 * `targetScale` (`OutcomeWindow.adjFactor`) rescales it to the window's basis inside. The
 * measured target is the one the analysis was shown (`computePatternTargets` on the stored
 * geometry) times `targetScale`, so a rescaled subject keeps the rounding the model's
 * numbers had. Written for `up`; `down` mirrors every comparison.
 *
 * - `skipped` / `geometry_invalid`: the target is not past the breakout level, or the
 *   invalidation is not on the other side of it.
 * - Breakout: the reference price already past the level is `alreadyBroken` (the race
 *   starts at offset 1 from it). Otherwise the first close past the level is the breakout
 *   bar and the race starts on the bar after it, from that close. A bar whose range
 *   reaches the invalidation is `invalidated_before_breakout` even when it also closes
 *   past the level (the intrabar order is unknown); neither by the end of the window is
 *   `no_breakout`.
 * - `skipped` / `target_reached`: the reference price was already at or past the measured
 *   target when the analysis was made. `skipped` / `target_reached_on_breakout`: the breakout
 *   bar itself closed at or past it (a breakout that reached the target within one bar, a
 *   different population).
 * - Race: an open past the target is `target_first`, an open past the invalidation is
 *   `invalidation_first` (both `gap: true`), a bar reaching both is `ambiguous`, else the
 *   one reached; nothing by the end is `open_at_horizon`.
 *
 * `rwNullTargetFirst` (`null` without an invalidation) is `(start − invalidation) /
 * (target − invalidation)`: the chance a driftless walk from the start reaches the target
 * first, with no horizon.
 *
 * @internal
 */
export function labelPatternOutcome(
    pattern: OutcomePatternSubject,
    window: OutcomeWindow,
    targetScale: number
): PatternOutcomeLabel {
    const { name, candidateId, direction, breakout, extreme, invalidation } =
        pattern;
    const sign = direction === 'up' ? 1 : -1;
    const target =
        computePatternTargets(breakout, extreme, direction).measuredTarget *
        targetScale;
    const scaledBreakout = breakout * targetScale;
    const scaledInvalidation =
        invalidation === null ? null : invalidation * targetScale;
    const base: PatternOutcomeLabel = {
        name,
        candidateId,
        direction,
        outcome: 'skipped',
        skipReason: null,
        alreadyBroken: false,
        breakoutOffset: null,
        resolveOffset: null,
        gap: null,
        measuredTarget: target,
        rwNullTargetFirst: null,
    };

    if (
        sign * (target - scaledBreakout) <= 0 ||
        (scaledInvalidation !== null &&
            sign * (scaledInvalidation - scaledBreakout) >= 0)
    ) {
        return { ...base, skipReason: 'geometry_invalid' };
    }

    const found = findBreakout(
        sign,
        scaledBreakout,
        scaledInvalidation,
        window
    );
    if (typeof found === 'string') return { ...base, outcome: found };
    if (sign * (found.start - target) >= 0) {
        return {
            ...base,
            skipReason: found.alreadyBroken
                ? 'target_reached'
                : 'target_reached_on_breakout',
            alreadyBroken: found.alreadyBroken,
            breakoutOffset: found.offset,
        };
    }

    const result = race(
        sign,
        target,
        scaledInvalidation,
        Math.max(1, found.offset + 1),
        window
    );
    return {
        ...base,
        ...result,
        alreadyBroken: found.alreadyBroken,
        breakoutOffset: found.offset,
        rwNullTargetFirst:
            scaledInvalidation === null
                ? null
                : (found.start - scaledInvalidation) /
                  (target - scaledInvalidation),
    };
}
