import type { ForwardDirection, ForwardEdgeResult } from '@/domain/types';
import {
    collectValidReturns,
    computeBaseline,
    statsFromReturns,
} from './baseline';

const MIN_SAMPLES_FOR_TSTAT = 2;
/**
 * Minimum absolute standard deviation below which we treat the distribution as
 * zero-variance and guard tStat to 0. Chosen to be safely above the ~3e-17
 * floating-point rounding noise produced by nominally identical percentage
 * returns in IEEE-754 double arithmetic, while being far below any economically
 * meaningful spread (smallest realistic return difference: ~1e-6 for a 0.0001%
 * tick).
 */
const MIN_STD_FOR_TSTAT = 1e-10;

/** @internal Sample (n−1) standard deviation. Returns 0 for fewer than 2 points. */
export function sampleStd(xs: readonly number[], mean: number): number {
    if (xs.length < MIN_SAMPLES_FOR_TSTAT) return 0;
    const variance =
        xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (xs.length - 1);
    return Math.sqrt(variance);
}

/**
 * @internal Forward-edge of a signal's trigger indices vs the unconditional
 * baseline. The signal's returns are collected once and reused for both the
 * aggregate stats and the t-stat. `tStat` is a one-sample t of the signal's
 * directional returns against the baseline mean; guarded to 0 when n < 2 or
 * variance is ~0.
 */
export function computeForwardEdge(
    closes: readonly number[],
    triggerIndices: readonly number[],
    horizon: number,
    direction: ForwardDirection
): ForwardEdgeResult {
    const baseline = computeBaseline(closes, horizon, direction);

    const sigReturns = collectValidReturns(
        closes,
        triggerIndices,
        horizon,
        direction
    );
    const signal = statsFromReturns(sigReturns);

    const sd = sampleStd(sigReturns, signal.meanReturn);
    const n = sigReturns.length;
    const tStat =
        n >= MIN_SAMPLES_FOR_TSTAT && sd >= MIN_STD_FOR_TSTAT
            ? (signal.meanReturn - baseline.meanReturn) / (sd / Math.sqrt(n))
            : 0;

    return {
        horizon,
        direction,
        triggerCount: signal.count,
        signal,
        baseline,
        excessHitRate: signal.hitRate - baseline.hitRate,
        excessMeanReturn: signal.meanReturn - baseline.meanReturn,
        tStat,
    };
}
