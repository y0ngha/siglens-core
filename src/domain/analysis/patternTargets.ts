import type {
    PatternBreakoutDirection,
    PatternGeometry,
    PatternTargetGeometry,
} from '@/domain/types';
import { roundPriceAtDp } from '@/domain/analysis/promptFormat';

/** Upper bound on decimals kept for an app-computed pattern target. */
const MAX_TARGET_DECIMALS = 8;

/**
 * @internal Decimal places `n` is written with (`348.33` → 2), capped at
 * {@link MAX_TARGET_DECIMALS}.
 */
export function decimalPlacesOf(n: number): number {
    const text = String(n);
    if (text.includes('e')) return MAX_TARGET_DECIMALS;
    const dot = text.indexOf('.');
    return dot === -1
        ? 0
        : Math.min(text.length - dot - 1, MAX_TARGET_DECIMALS);
}

/**
 * @internal Rounds binary-float noise off a target (`338.34 + 9.99` is
 * `348.3299999999999`) to the precision its inputs were given at — `extra`
 * adds a place where the arithmetic needs one (halving a 2-decimal height).
 */
export function roundToInputPrecision(
    value: number,
    inputs: readonly number[],
    extra = 0
): number {
    const decimals = Math.min(
        Math.max(...inputs.map(decimalPlacesOf)) + extra,
        MAX_TARGET_DECIMALS
    );
    return Number(value.toFixed(decimals));
}

/** Deterministic measured-move numbers derived from a breakout/extreme pair. */
export interface PatternTargets {
    height: number;
    measuredTarget: number;
    conservativeTarget: number;
}

/**
 * @internal
 * Deterministic measured-move targets from a breakout level + extreme level
 * + direction — the ONE piece of math shared by `## Chart Pattern Candidates
 * (computed)` and the app-appended `keyPrices` entries (spec 2026-09-18).
 * Before this was extracted, `patternGeometry.ts`'s own
 * family-specific formulas computed the candidates-section numbers with no
 * rounding, while `ai-levels.ts` rounded to input precision when a model
 * copies `breakoutLevel`/`extremeLevel` into its own `geometry` — the two
 * could disagree by float noise on the same inputs. Both now call this.
 *
 * @param breakoutLevel - The neckline/boundary/rim/channel-edge price.
 * @param extremeLevel - The textbook measured-move anchor (head, peak/trough
 *   average, cup bottom, flagpole start, or the opposite boundary).
 * @param direction - Expected breakout direction; `'up'` projects targets
 *   above `breakoutLevel`, `'down'` below it.
 */
export function computePatternTargets(
    breakoutLevel: number,
    extremeLevel: number,
    direction: PatternBreakoutDirection
): PatternTargets {
    const height = Math.abs(extremeLevel - breakoutLevel);
    const sign = direction === 'up' ? 1 : -1;
    const inputs = [breakoutLevel, extremeLevel];
    return {
        height,
        measuredTarget: roundToInputPrecision(
            breakoutLevel + sign * height,
            inputs
        ),
        // `extra: 1` — halving a 2-decimal height can need a 3rd decimal
        // (e.g. height 0.03 -> half 0.015) the inputs themselves never had.
        conservativeTarget: roundToInputPrecision(
            breakoutLevel + sign * (height / 2),
            inputs,
            1
        ),
    };
}

/**
 * @internal
 * The geometry a candidate block PRINTS, as a {@link PatternTargetGeometry} —
 * the ONE place the printed numbers are derived, shared by the prompt section,
 * the drawn pattern levels (`patternOverlays.ts`) and the post-call override that replaces a resolved pattern card's
 * model-copied geometry with it (so the app's targets match the drawn line).
 *
 * Breakout/extreme are rounded to the printed precision FIRST: the model
 * copies what it reads, so every printed number (and the app's
 * recomputation) starts from the rounded values, not from the raw (often
 * non-terminating OLS / averaged) geometry. The extreme is breakout ∓ height
 * (height = |extreme − breakout|), so copying breakout/extreme/direction
 * makes `computePatternTargets` reproduce the listed targets. The
 * invalidation level is included at printed precision only when the block
 * prints a number for it (finite and > 0 — `N/A` otherwise).
 *
 * @param geometry - The candidate's computed geometry (`computeCandidateGeometry`).
 * @param priceDp - Decimal places the section prints prices with.
 * @returns The printed breakout/extreme/direction(/invalidation).
 */
export function printedPatternGeometry(
    geometry: PatternGeometry,
    priceDp: number
): PatternTargetGeometry {
    const round = (n: number): number =>
        Number(roundPriceAtDp(n, priceDp).toFixed(priceDp));
    const invalidation = geometry.invalidationLevel;
    return {
        breakoutLevel: round(geometry.breakoutLevel),
        extremeLevel: round(
            geometry.direction === 'up'
                ? geometry.breakoutLevel - geometry.height
                : geometry.breakoutLevel + geometry.height
        ),
        direction: geometry.direction,
        ...(Number.isFinite(invalidation) && invalidation > 0
            ? { invalidationLevel: round(invalidation) }
            : {}),
    };
}
