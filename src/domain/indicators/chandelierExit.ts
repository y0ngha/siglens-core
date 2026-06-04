import type { Bar, ChandelierResult, ChandelierTrend } from '@/domain/types';
import { calculateATR } from './atr';
import { slidingMax, slidingMin } from './utils';
import { CHANDELIER_PERIOD, CHANDELIER_ATR_MULT } from './constants';

/**
 * @internal Chandelier Exit — ATR-based trailing stop with trend state machine.
 *
 * longStop[i]  = highest-high over `period` − multiplier × ATR[i]
 * shortStop[i] = lowest-low  over `period` + multiplier × ATR[i]
 *
 * Trend state machine (O(N) accumulator — justified: the current trend depends on the
 * previous bar's trend, making a pure map/reduce impossible without O(N²) re-scanning;
 * a sequential state-carry loop is the only O(N) solution):
 *   - Initial trend: 'long' at the first valid bar.
 *   - If trend is 'long'  and close < longStop  → flip to 'short'.
 *   - If trend is 'short' and close > shortStop → flip to 'long'.
 *   - Otherwise: carry the previous trend forward.
 *
 * All fields are null during the warm-up window (first `period` bars — ATR and
 * sliding-window primitives need `period` bars before emitting a value).
 */
export function calculateChandelierExit(
    bars: Bar[],
    period = CHANDELIER_PERIOD,
    multiplier = CHANDELIER_ATR_MULT
): ChandelierResult[] {
    if (bars.length === 0) return [];

    const n = bars.length;
    const atr = calculateATR(bars, period);
    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);
    const hhValues = slidingMax(highs, period);
    const llValues = slidingMin(lows, period);

    // O(N) state-machine accumulator — see JSDoc above for justification.
    const result: ChandelierResult[] = new Array(n);
    let trend: ChandelierTrend | null = null;

    for (let i = 0; i < n; i++) {
        const atrVal = atr[i];
        const hh = hhValues[i];
        const ll = llValues[i];

        if (atrVal === null || hh === null || ll === null) {
            result[i] = { longStop: null, shortStop: null, trend: null };
            continue;
        }

        const longStop = hh - multiplier * atrVal;
        const shortStop = ll + multiplier * atrVal;
        const close = bars[i].close;

        // Determine new trend:
        // Seed 'long' on the first valid bar, then apply flip rules.
        if (trend === null) {
            trend = 'long';
        } else if (trend === 'long' && close < longStop) {
            trend = 'short';
        } else if (trend === 'short' && close > shortStop) {
            trend = 'long';
        }
        // else: carry forward unchanged

        result[i] = { longStop, shortStop, trend };
    }

    return result;
}
