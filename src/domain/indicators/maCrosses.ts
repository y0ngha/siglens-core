import type { Bar } from '@/domain/types';
import { calculateMA } from '@/domain/indicators/ma';

/** One crossing of a fast simple moving average over a slow one. */
export interface MaCross {
    /** Bar time (Unix seconds) of the first session on the new side. */
    time: number;
    /** `golden`: fast crosses above slow; `dead`: fast crosses below slow. */
    kind: 'golden' | 'dead';
    /** Fast and slow SMA values on that bar. */
    fast: number;
    slow: number;
}

/** Result of {@link findMaCrosses}: the crossings plus how much of the window could be checked. */
export interface MaCrossScan {
    /** Crossings inside the window, oldest first. */
    crosses: MaCross[];
    /** How many of the requested `lookbackBars` bars had both SMAs available. */
    evaluatedBars: number;
    /**
     * True when the whole window was checked: every window bar has both SMAs AND the bar before
     * the window does too (so a flip on the window's first bar has a prior side to flip from).
     * That needs at least `lookbackBars + slowPeriod` bars — one more than evaluating the window
     * bars alone. When false, an empty `crosses` does NOT mean no crossing happened in the
     * window — the data does not reach that far.
     */
    complete: boolean;
}

/**
 * Fast/slow SMA crossings within the last `lookbackBars` bars (default 50/200 over 252 bars,
 * about a year of daily bars).
 *
 * A crossing is recorded on the bar where the fast SMA first sits strictly on the other side
 * of the slow one from the last bar where it was strictly on one side: golden = below → above,
 * dead = above → below. Bars where the two are equal are skipped, so touching and returning to
 * the same side is not a crossing, and starting level with the slow SMA and then moving apart is
 * not one either. Bars before the slow SMA exists are skipped and reported through
 * `complete`/`evaluatedBars`, so a short history is never presented as "no crossing".
 *
 * @param bars - Bars ordered oldest → newest.
 * @param fastPeriod - Fast SMA period (default 50).
 * @param slowPeriod - Slow SMA period (default 200).
 * @param lookbackBars - How many of the most recent bars to search (default 252).
 * @returns The crossings and the window coverage.
 */
export function findMaCrosses(
    bars: Bar[],
    fastPeriod = 50,
    slowPeriod = 200,
    lookbackBars = 252
): MaCrossScan {
    const fast = calculateMA(bars, fastPeriod);
    const slow = calculateMA(bars, slowPeriod);
    const windowStart = Math.max(0, bars.length - lookbackBars);
    const crosses: MaCross[] = [];
    let evaluatedBars = 0;
    // Last strict side (+1 fast above, -1 below). Equal bars do not change it, so touching and
    // returning to the same side is not a crossing. The side is tracked from before the window
    // so a flip on the window's first bar still counts.
    let lastSide = 0;
    for (let i = 0; i < bars.length; i++) {
        const f = fast[i];
        const sl = slow[i];
        if (
            f == null ||
            sl == null ||
            !Number.isFinite(f) ||
            !Number.isFinite(sl)
        )
            continue;
        if (i >= windowStart) evaluatedBars += 1;
        const side = f > sl ? 1 : f < sl ? -1 : 0;
        if (side === 0) continue;
        if (lastSide !== 0 && side !== lastSide && i >= windowStart)
            crosses.push({
                time: bars[i].time,
                kind: side > 0 ? 'golden' : 'dead',
                fast: f,
                slow: sl,
            });
        lastSide = side;
    }
    return {
        crosses,
        evaluatedBars,
        complete:
            bars.length >= lookbackBars + slowPeriod &&
            evaluatedBars === lookbackBars,
    };
}
