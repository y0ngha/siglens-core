import type { Bar } from '@/domain/types';
import { sampleVariance } from './statistics';
import {
    YANG_ZHANG_PERIOD,
    YANG_ZHANG_K_NUM,
    YANG_ZHANG_K_DEN_BASE,
} from './constants';

/**
 * @internal Per-bar log terms used by the Yang-Zhang estimator.
 * `null` when any required ratio is non-positive (`ln` undefined).
 */
interface YangZhangTerms {
    /** Overnight return: ln(open_i / close_{i-1}). */
    overnight: number;
    /** Open-to-close return: ln(close_i / open_i). */
    openClose: number;
    /** Rogers-Satchell term for bar i. */
    rogersSatchell: number;
}

/**
 * @internal Compute the three Yang-Zhang log terms for bar `i` (needs bars[i-1]).
 * Returns `null` if any high/low/open/close ratio is non-positive.
 */
function yangZhangTerms(curr: Bar, prevClose: number): YangZhangTerms | null {
    const { open, high, low, close } = curr;
    // Guard: every ratio fed to ln must be strictly positive.
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || prevClose <= 0) {
        return null;
    }

    const overnight = Math.log(open / prevClose);
    const openClose = Math.log(close / open);
    const rogersSatchell =
        Math.log(high / close) * Math.log(high / open) +
        Math.log(low / close) * Math.log(low / open);

    return { overnight, openClose, rogersSatchell };
}

/**
 * @internal Yang-Zhang volatility (Yang & Zhang, 2000) — drift-independent,
 * open-jump-aware realized volatility from OHLC bars.
 *
 * For each bar i ≥ 1 (needs the previous close), compute:
 *   overnight        o_i  = ln(open_i / close_{i-1})
 *   open-to-close    c_i  = ln(close_i / open_i)
 *   Rogers-Satchell  rs_i = ln(high_i/close_i)·ln(high_i/open_i)
 *                         + ln(low_i/close_i)·ln(low_i/open_i)
 *
 * Over a trailing window of `period` bars (n = period):
 *   σ²_o  = sampleVariance(o)        (Bessel-corrected, n−1)
 *   σ²_c  = sampleVariance(c)        (Bessel-corrected, n−1)
 *   σ²_rs = mean(rs)
 *   k     = 0.34 / (1.34 + (period+1)/(period−1))
 *   σ²_yz = σ²_o + k·σ²_c + (1−k)·σ²_rs
 * Result = sqrt(max(0, σ²_yz)).
 *
 * Warm-up: the first `period` bars are `null` (each window needs `period` bars
 * of terms, and term i needs close_{i-1}, so the first window ends at index
 * `period`). Any window containing a non-positive price → `null` for that bar.
 */
export function calculateYangZhang(
    bars: Bar[],
    period = YANG_ZHANG_PERIOD
): (number | null)[] {
    const n = bars.length;
    if (n === 0) return [];
    if (period <= 1) return new Array(n).fill(null);

    // k weight depends only on `period` (Yang & Zhang minimum-variance weight).
    const k =
        YANG_ZHANG_K_NUM /
        (YANG_ZHANG_K_DEN_BASE + (period + 1) / (period - 1));

    // terms[i] holds the log terms derived from bars[i] and bars[i-1];
    // terms[0] is null (no prior close).
    const terms: (YangZhangTerms | null)[] = bars.map((bar, i) =>
        i === 0 ? null : yangZhangTerms(bar, bars[i - 1].close)
    );

    return bars.map((_, i) => {
        // Window of `period` terms ending at bar i: indices [i-period+1 .. i].
        // Requires i >= period so the earliest term (i-period+1 >= 1) is valid.
        if (i < period) return null;

        const windowTerms = terms.slice(i - period + 1, i + 1);
        // Any non-positive price inside the window invalidates the estimate.
        if (windowTerms.some(t => t === null)) return null;
        // The .some(t => t === null) guard above proves no null elements remain;
        // TS cannot narrow (YangZhangTerms|null)[] to YangZhangTerms[] through .some(), so this cast is the documented workaround.
        const valid = windowTerms as YangZhangTerms[];
        const overnight = valid.map(t => t.overnight);
        const openClose = valid.map(t => t.openClose);
        const rs = valid.map(t => t.rogersSatchell);

        const varO = sampleVariance(overnight);
        const varC = sampleVariance(openClose);
        if (varO === null || varC === null) return null;

        const meanRs = rs.reduce((sum, v) => sum + v, 0) / rs.length;
        const varYz = varO + k * varC + (1 - k) * meanRs;

        return Math.sqrt(Math.max(0, varYz));
    });
}
