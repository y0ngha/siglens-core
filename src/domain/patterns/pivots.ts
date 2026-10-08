import type { Bar, PivotPoint } from '@/domain/types';
import {
    BOUNDARY_CONTAINMENT_ATR,
    PIVOT_REVERSAL_ATR_MULT,
} from '@/domain/patterns/constants';

/**
 * An outside reversal bar (with `onePivotPerBar`): in a down leg, a bar that
 * undercuts the leg's low by no more than the containment slack AND tops the
 * swing high that started the leg, by a full reversal over the leg's low
 * (mirror for an up leg). It cannot be both a swing low and a swing high, and
 * its far end is the larger swing, so the leg's earlier low is the swing low
 * and the bar starts the up leg from its high. Without this the bar's new low
 * won and its high — the rim of a cup, the top of a range — was lost.
 */
function outsideReversal(
    bar: Bar,
    direction: 'up' | 'down',
    last: PivotPoint | undefined,
    legExtreme: number,
    atr: number | null
): boolean {
    if (last === undefined || atr === null) return false;
    const threshold = PIVOT_REVERSAL_ATR_MULT * atr;
    // The swing kept must still be the extreme of its swing, within the
    // same slack the boundary lines allow.
    const slack = BOUNDARY_CONTAINMENT_ATR * atr;
    return direction === 'down'
        ? last.kind === 'high' &&
              bar.low < legExtreme &&
              legExtreme - bar.low <= slack &&
              bar.high > last.price &&
              bar.high - legExtreme >= threshold
        : last.kind === 'low' &&
              bar.high > legExtreme &&
              bar.high - legExtreme <= slack &&
              bar.low < last.price &&
              legExtreme - bar.low >= threshold;
}

/** Whether `value` is a usable ATR reading. */
const usableAtr = (value: number | null | undefined): value is number =>
    value !== null &&
    value !== undefined &&
    Number.isFinite(value) &&
    value > 0;

/**
 * The ATR each bar's reversal is measured against: the bar's own value, the
 * previous bar's usable value when it has none (a gap mid-series), and the
 * series' first value for the warm-up bars before it. `null` everywhere when
 * the series has no usable value.
 */
function effectiveAtrSeries(
    atr: readonly (number | null)[],
    length: number
): (number | null)[] {
    const first = atr.find(usableAtr) ?? null;
    let previous: number | null = null;
    return Array.from({ length }, (_, i) => {
        const value = atr[i];
        if (usableAtr(value)) {
            previous = value;
            return value;
        }
        return previous ?? first;
    });
}

/**
 * @internal
 * ATR-relative zigzag pivot extraction — the building block the chart-pattern
 * pre-screener and qualifier run over.
 *
 * Tracks the running price extreme since the last confirmed pivot. A pivot is
 * confirmed once price retraces from that extreme by at least
 * `PIVOT_REVERSAL_ATR_MULT` × ATR in the opposite direction — highs are
 * priced off `bar.high`, lows off `bar.low`. Using an ATR-relative threshold
 * (rather than a fixed price/percent band) keeps the zigzag scale-invariant
 * across symbols and timeframes with very different volatility.
 *
 * **Causal threshold.** `atr` may be the per-bar ATR series (aligned with
 * `bars`); each reversal is then measured against the ATR at the bar that
 * confirms it, so appending bars never moves, adds or removes an earlier
 * confirmed pivot. A single number applies one threshold to the whole
 * history — the last bar's ATR re-zigzagged all of it on every new bar, so
 * historical pivots appeared and vanished as ATR drifted (2026-10-08 replay
 * sweep). Two caveats:
 * - Warm-up bars before the first ATR value borrow that first value, so a
 *   short history still has its early swings. Their pivots can change once,
 *   while the series grows into ATR coverage (the first value itself is
 *   fixed from then on).
 * - A bar with no usable value later in the series (`null`, `NaN`, ≤ 0)
 *   reuses the previous bar's value — only bars up to it decide its pivot.
 * A series with no usable value at all confirms nothing.
 *
 * **One pivot per bar (`opts.onePivotPerBar`).** A wide bar can confirm the
 * extreme it set itself (its high is a full reversal above its own new low);
 * the opposite swing then starts on the NEXT bar, so that same bar's other
 * end is never also a pivot. Without it the same bar could be a swing high
 * and a swing low at once (about 40% of real-chart pattern pivots were such
 * pairs). An outside reversal bar keeps the larger swing instead
 * ({@link outsideReversal}). The chart-pattern screener and qualifier set
 * the option; the Elliott and trendline overlay builders keep the original
 * zigzag their gates were measured on.
 *
 * The very first extreme (before any direction is established) is used only
 * to seed the initial swing direction and is never itself emitted as a pivot
 * — the algorithm has no prior bars to confirm it is a genuine turning point,
 * so treating it as one would produce a spurious pivot at `index: 0` on every
 * call.
 *
 * A non-positive scalar `atr` returns `[]` rather than treating every
 * retracement as confirmed: a zero/negative threshold degenerates into
 * flagging every single-bar wiggle as a pivot, which is pure noise, not a
 * screening signal.
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
 * @param atr - Average True Range: the per-bar series for `bars` (causal
 *   thresholds, see above) or one number for the whole series.
 * @param opts.includeProvisional - When `true` and a swing direction has
 * been established, append the current running extreme (since the last
 * confirmed pivot) as a final, unconfirmed `PivotPoint` — the running high
 * during an up leg, the running low during a down leg. Skipped when it
 * would duplicate the last confirmed pivot's index (nothing has moved past
 * that pivot yet). Default (`false`/omitted) is byte-identical to the
 * confirmed-only behavior described above.
 * @param opts.onePivotPerBar - See "One pivot per bar" above. Default
 * `false` (the original zigzag).
 * @returns Confirmed pivots in ascending bar-index order (at most one per
 * bar with `onePivotPerBar`); alternates high/low kind by construction. With
 * `includeProvisional: true`, may have one trailing provisional pivot of the
 * OPPOSITE kind to the last confirmed one (confirming a high turns the swing
 * down, so the running extreme is a low) — the list still alternates.
 */
export function extractPivots(
    bars: readonly Bar[],
    atr: number | readonly (number | null)[],
    opts?: { includeProvisional?: boolean; onePivotPerBar?: boolean }
): PivotPoint[] {
    if (bars.length < 2) return [];
    if (typeof atr === 'number' && !(atr > 0)) return [];

    // The ATR each bar's reversal is measured against (`null` without one).
    const perBar: readonly (number | null)[] =
        typeof atr === 'number'
            ? Array.from({ length: bars.length }, () => atr)
            : effectiveAtrSeries(atr, bars.length);
    const atrAt = (i: number): number | null => perBar[i];
    const pivots: PivotPoint[] = [];

    let runningHigh = bars[0].high;
    let runningHighIndex = 0;
    let runningLow = bars[0].low;
    let runningLowIndex = 0;
    let direction: 'up' | 'down' | null = null;

    for (let i = 1; i < bars.length; i++) {
        const bar = bars[i];
        if (opts?.onePivotPerBar === true && direction !== null) {
            const outside = outsideReversal(
                bar,
                direction,
                pivots[pivots.length - 1],
                direction === 'down' ? runningLow : runningHigh,
                atrAt(i)
            );
            if (outside) {
                // The leg's running extreme (an earlier bar) is the swing;
                // this bar's far end starts the next leg.
                pivots.push(
                    direction === 'down'
                        ? {
                              index: runningLowIndex,
                              price: runningLow,
                              kind: 'low',
                          }
                        : {
                              index: runningHighIndex,
                              price: runningHigh,
                              kind: 'high',
                          }
                );
                direction = direction === 'down' ? 'up' : 'down';
                runningHigh = bar.high;
                runningHighIndex = i;
                runningLow = bar.low;
                runningLowIndex = i;
                continue;
            }
        }
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
        const atrValue = atrAt(i);
        if (atrValue === null) continue;
        const threshold = PIVOT_REVERSAL_ATR_MULT * atrValue;
        const highReversed = runningHigh - bar.low >= threshold;
        const lowReversed = bar.high - runningLow >= threshold;

        if (direction === null) {
            // Seed the initial direction without emitting a pivot for the
            // pre-direction extreme — see JSDoc above.
            if (highReversed) {
                direction = 'down';
                runningLow = bar.low;
                runningLowIndex = i;
            } else if (lowReversed) {
                direction = 'up';
                runningHigh = bar.high;
                runningHighIndex = i;
            }
        } else if (direction === 'up') {
            if (highReversed) {
                pivots.push({
                    index: runningHighIndex,
                    price: runningHigh,
                    kind: 'high',
                });
                direction = 'down';
                // A bar that confirmed its own high starts the down leg on
                // the next bar (see JSDoc: one pivot per bar).
                const selfConfirmed =
                    opts?.onePivotPerBar === true && runningHighIndex === i;
                runningLow = selfConfirmed ? Infinity : bar.low;
                runningLowIndex = selfConfirmed ? -1 : i;
            }
        } else if (lowReversed) {
            pivots.push({
                index: runningLowIndex,
                price: runningLow,
                kind: 'low',
            });
            direction = 'up';
            const selfConfirmed =
                opts?.onePivotPerBar === true && runningLowIndex === i;
            runningHigh = selfConfirmed ? -Infinity : bar.high;
            runningHighIndex = selfConfirmed ? -1 : i;
        }
    }

    // With `onePivotPerBar`, a last bar that confirmed its own extreme has
    // started no leg yet (index -1). In the original zigzag the running
    // extreme can sit on the last confirmed pivot's own bar; it is skipped
    // there rather than listed twice.
    if (opts?.includeProvisional && direction !== null) {
        const provisional: PivotPoint =
            direction === 'up'
                ? { index: runningHighIndex, price: runningHigh, kind: 'high' }
                : { index: runningLowIndex, price: runningLow, kind: 'low' };
        const lastConfirmed = pivots[pivots.length - 1];
        if (
            provisional.index >= 0 &&
            (lastConfirmed === undefined ||
                provisional.index !== lastConfirmed.index)
        ) {
            pivots.push(provisional);
        }
    }

    return pivots;
}
