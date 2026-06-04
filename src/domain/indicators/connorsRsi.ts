import { calculateRSI } from './rsi';
import {
    CRSI_RSI_PERIOD,
    CRSI_STREAK_PERIOD,
    CRSI_PCTRANK_PERIOD,
    CRSI_COMPONENT_COUNT,
} from './constants';

/**
 * @internal Build the signed consecutive-direction streak series.
 *
 * streak[0] = 0 (no prior bar).
 * streak[i] = streak[i-1] + 1 if close[i] > close[i-1]
 *           = streak[i-1] - 1 if close[i] < close[i-1]
 *           = 0                if close[i] === close[i-1]
 *
 * O(N) accumulator — streak state depends on the previous value, so a
 * recursive reduce would work but an explicit loop with a length-cached
 * constant avoids N copies of the accumulator closure.
 */
function buildStreakSeries(closes: number[]): number[] {
    const len = closes.length;
    const streaks = new Array<number>(len);
    streaks[0] = 0;
    for (let i = 1; i < len; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) {
            streaks[i] = (streaks[i - 1] > 0 ? streaks[i - 1] : 0) + 1;
        } else if (diff < 0) {
            streaks[i] = (streaks[i - 1] < 0 ? streaks[i - 1] : 0) - 1;
        } else {
            streaks[i] = 0;
        }
    }
    return streaks;
}

/**
 * @internal 1-day rate-of-change series: roc[0] = 0; roc[i] = (closes[i] - closes[i-1]) / closes[i-1] * 100.
 * Returns 0 when the prior close is 0 (guard against division by zero).
 */
function buildRocSeries(closes: number[]): number[] {
    return closes.map((c, i) => {
        if (i === 0) return 0;
        const prev = closes[i - 1];
        return prev !== 0 ? ((c - prev) / prev) * 100 : 0;
    });
}

/**
 * @internal Compute the percent-rank of `roc[i]` over the prior `period` values of `roc`.
 *
 * percentRank[i] = 100 * count(roc[j] < roc[i], j in [i-period, i-1]) / period.
 * Null until `i >= period + 1` (need period prior values starting from i=1).
 * First valid pctRank index: period + 1 (index `period` has only `period` prior ROC entries).
 *
 * Implemented as a `for` loop (CONVENTIONS.md: sliding windows prefer for-loops) to avoid
 * per-bar O(period) slice allocation that the `.slice().map()` approach would incur.
 */
function buildPctRankSeries(roc: number[], period: number): (number | null)[] {
    const len = roc.length;
    const result: (number | null)[] = new Array(len);
    for (let i = 0; i < len; i++) {
        // Need indices [i-period .. i-1] to all exist; i-period >= 0 → i >= period
        // Also i must be >= 1 (roc[0] = 0 is sentinel, not a real return)
        if (i < period + 1) {
            result[i] = null;
            continue;
        }
        const currentRoc = roc[i];
        let countBelow = 0;
        for (let j = i - period; j < i; j++) {
            if (roc[j] < currentRoc) countBelow++;
        }
        result[i] = (countBelow / period) * 100;
    }
    return result;
}

/**
 * @internal Connors RSI — average of three momentum components:
 * 1. RSI(close, rsiPeriod)
 * 2. RSI(streak, streakRsiPeriod) — streak = signed consecutive-direction count
 * 3. PercentRank of the 1-day ROC over pctRankPeriod bars
 *
 * All three must be non-null for a bar's CRSI to be defined.
 */
export function calculateConnorsRsi(
    closes: number[],
    rsiPeriod = CRSI_RSI_PERIOD,
    streakRsiPeriod = CRSI_STREAK_PERIOD,
    pctRankPeriod = CRSI_PCTRANK_PERIOD
): (number | null)[] {
    const n = closes.length;
    if (n === 0) return [];
    if (rsiPeriod <= 0 || streakRsiPeriod <= 0 || pctRankPeriod <= 0)
        return new Array(n).fill(null);

    const rsiClose = calculateRSI(closes, rsiPeriod);
    const streaks = buildStreakSeries(closes);
    const rsiStreak = calculateRSI(streaks, streakRsiPeriod);
    const roc = buildRocSeries(closes);
    const pctRank = buildPctRankSeries(roc, pctRankPeriod);

    return closes.map((_, i) => {
        const rc = rsiClose[i];
        const rs = rsiStreak[i];
        const pr = pctRank[i];
        if (rc === null || rs === null || pr === null) return null;
        return (rc + rs + pr) / CRSI_COMPONENT_COUNT;
    });
}
