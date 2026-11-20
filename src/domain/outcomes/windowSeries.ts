import {
    BASELINE_MIN_SAMPLES,
    OUTCOME_WINDOW_BARS,
} from '@/domain/outcomes/constants';
import type { ForwardBar, OutcomeWindow } from '@/domain/outcomes/types';

/**
 * @internal
 * Forward bars the labels scan: all of the window's, capped at `OUTCOME_WINDOW_BARS`.
 * A window from `buildOutcomeWindow` always holds exactly that many.
 */
export function scannedBars(window: OutcomeWindow): number {
    return Math.min(window.forward.length, OUTCOME_WINDOW_BARS);
}

/** @internal Forward offsets `1..n`, the 1-based positions in `window.forward`. */
export function forwardOffsets(window: OutcomeWindow): readonly number[] {
    return Array.from({ length: scannedBars(window) }, (_, i) => i + 1);
}

/**
 * @internal
 * The forward bar at a 1-based `offset` (offset 0 is the anchor, which is not a forward
 * bar).
 */
export function forwardBar(window: OutcomeWindow, offset: number): ForwardBar {
    const [, open, high, low, close] = window.forward[offset - 1];
    return { open, high, low, close };
}

/**
 * @internal
 * The close series `S`: the closes up to and including the anchor, then the forward
 * closes. The anchor is the last of the former, so offset `h` is `S[anchorIndex + h]`.
 */
export function closeSeries(window: OutcomeWindow): readonly number[] {
    return [
        ...window.preCloses,
        ...window.forward
            .slice(0, scannedBars(window))
            .map(([, , , , close]) => close),
    ];
}

/** @internal Index of the anchor in {@link closeSeries}. */
export function anchorIndex(window: OutcomeWindow): number {
    return window.preCloses.length - 1;
}

/** @internal `100 × (to / from − 1)`, `null` unless both are finite and `from > 0`. */
export function pctChange(from: number, to: number): number | null {
    return Number.isFinite(from) && Number.isFinite(to) && from > 0
        ? (to / from - 1) * 100
        : null;
}

/**
 * @internal
 * Mean `h`-bar return over every start `j` of `series` with `j + h` inside it, and how
 * many starts that is. The mean is `null` below `BASELINE_MIN_SAMPLES`: a baseline of a
 * handful of overlapping returns is not a baseline.
 */
export function baselineMean(
    series: readonly number[],
    h: number
): { pct: number | null; n: number } {
    const returns = series
        .slice(0, Math.max(0, series.length - h))
        .map((from, j) => pctChange(from, series[j + h]))
        .filter((value): value is number => value !== null);
    return {
        pct:
            returns.length < BASELINE_MIN_SAMPLES
                ? null
                : returns.reduce((sum, value) => sum + value, 0) /
                  returns.length,
        n: returns.length,
    };
}
