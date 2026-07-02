import type { Bar } from '@/domain/types';
import type { PivotPoint } from '@/domain/patterns/types';
import { PIVOT_REVERSAL_ATR_MULT } from '@/domain/patterns/constants';

/**
 * @internal
 * ATR-relative zigzag pivot extraction — the recall-biased building block the
 * chart-pattern pre-screener runs its shape matchers over.
 *
 * Tracks the running price extreme since the last confirmed pivot. A pivot is
 * confirmed once price retraces from that extreme by at least
 * `PIVOT_REVERSAL_ATR_MULT * atr` in the opposite direction — highs are priced
 * off `bar.high`, lows off `bar.low`. Using an ATR-relative threshold (rather
 * than a fixed price/percent band) keeps the zigzag scale-invariant across
 * symbols and timeframes with very different volatility.
 *
 * The very first extreme (before any direction is established) is used only
 * to seed the initial swing direction and is never itself emitted as a pivot
 * — the algorithm has no prior bars to confirm it is a genuine turning point,
 * so treating it as one would produce a spurious pivot at `index: 0` on every
 * call.
 *
 * `atr <= 0` returns `[]` rather than treating every retracement as
 * confirmed: a zero/negative threshold degenerates into flagging every
 * single-bar wiggle as a pivot, which is pure noise, not a screening signal.
 *
 * The final, still-forming leg (the running extreme since the last confirmed
 * pivot, which has not yet retraced by the reversal threshold) is
 * intentionally omitted by default — it is not a confirmed turning point.
 * Downstream classifiers that need to see the in-progress extreme (e.g. to
 * recognize a pattern that is actively forming at the right edge of the
 * chart) must opt in via `opts.includeProvisional`; see below.
 *
 * Pure and deterministic: never mutates `bars`.
 *
 * @param bars - OHLCV bars sorted oldest-first.
 * @param atr - Average True Range for the same bars (scale reference).
 * @param opts.includeProvisional - When `true` and a swing direction has
 * been established, append the current running extreme (since the last
 * confirmed pivot) as a final, unconfirmed `PivotPoint` — the running high
 * during an up leg, the running low during a down leg. Skipped when it
 * would duplicate the last confirmed pivot's index (nothing has moved past
 * that pivot yet). Default (`false`/omitted) is byte-identical to the
 * confirmed-only behavior described above.
 * @returns Confirmed pivots in ascending bar-index order; alternates
 * high/low kind by construction. With `includeProvisional: true`, may have
 * one trailing provisional pivot of the same kind as the last confirmed one.
 */
export function extractPivots(
    bars: readonly Bar[],
    atr: number,
    opts?: { includeProvisional?: boolean }
): PivotPoint[] {
    if (atr <= 0 || bars.length < 2) return [];

    const threshold = PIVOT_REVERSAL_ATR_MULT * atr;
    const pivots: PivotPoint[] = [];

    let runningHigh = bars[0].high;
    let runningHighIndex = 0;
    let runningLow = bars[0].low;
    let runningLowIndex = 0;
    let direction: 'up' | 'down' | null = null;

    for (let i = 1; i < bars.length; i++) {
        const bar = bars[i];
        // Strict `>`/`<`: on an exact tie with the running extreme, the
        // index is NOT updated, so the FIRST bar to reach a given extreme
        // price wins and later bars merely equaling it are ignored.
        if (bar.high > runningHigh) {
            runningHigh = bar.high;
            runningHighIndex = i;
        }
        if (bar.low < runningLow) {
            runningLow = bar.low;
            runningLowIndex = i;
        }

        if (direction === null) {
            // Seed the initial direction without emitting a pivot for the
            // pre-direction extreme — see JSDoc above.
            if (runningHigh - bar.low >= threshold) {
                direction = 'down';
                runningLow = bar.low;
                runningLowIndex = i;
            } else if (bar.high - runningLow >= threshold) {
                direction = 'up';
                runningHigh = bar.high;
                runningHighIndex = i;
            }
        } else if (direction === 'up') {
            if (runningHigh - bar.low >= threshold) {
                pivots.push({
                    index: runningHighIndex,
                    price: runningHigh,
                    kind: 'high',
                });
                direction = 'down';
                runningLow = bar.low;
                runningLowIndex = i;
            }
        } else {
            if (bar.high - runningLow >= threshold) {
                pivots.push({
                    index: runningLowIndex,
                    price: runningLow,
                    kind: 'low',
                });
                direction = 'up';
                runningHigh = bar.high;
                runningHighIndex = i;
            }
        }
    }

    if (opts?.includeProvisional && direction !== null) {
        const provisional: PivotPoint =
            direction === 'up'
                ? { index: runningHighIndex, price: runningHigh, kind: 'high' }
                : { index: runningLowIndex, price: runningLow, kind: 'low' };
        const lastConfirmed = pivots[pivots.length - 1];
        if (
            lastConfirmed === undefined ||
            provisional.index !== lastConfirmed.index
        ) {
            pivots.push(provisional);
        }
    }

    return pivots;
}
