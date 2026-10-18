import type { Bar, BuySellVolumeResult } from '@/domain/types';
import { calculateMA } from '@/domain/indicators/ma';
import { calculateVolumeProfile } from '@/domain/indicators/volume-profile';
import type { FactorValues } from '@/domain/indicators/fearGreed/types';

const VOL_Z_WINDOW = 20;
/**
 * Default Volume Profile window (in bars) for the POC distance factor. Must
 * match the value used by walkForward. Public so consumers can label the factor
 * window consistently (e.g. "POC distance (60 bar)").
 */
export const POC_WINDOW_DEFAULT = 60;
const MA200_WINDOW = 200;
const RANGE_WINDOW = 252;

/**
 * Minimum sample count for short rolling windows (volume z, POC bars).
 *
 * @internal Local guard for narrow-window factor computations; not part of the public API.
 */
const MIN_ROLLING_GUARD = 5;

/**
 * Minimum sample size required for MA200/52w-position factor windows to produce a value.
 *
 * @internal Imported by walkForward.ts; not part of the public API.
 */
export const FEAR_GREED_MIN_FACTOR_WINDOW = 30;

/**
 * Display distance (percent) of the last close from the 200-day SMA computed
 * INCLUSIVE of the last bar — the same value as `calculateMA(bars, 200)` on the
 * last bar and `evaluatePullback().closeVsMa200Pct`.
 *
 * The scored `ma200Dist` factor in {@link computeFactorsAtT} deliberately
 * excludes the current bar (look-ahead-free percentile ranking), so it differs
 * slightly from what the analysis screens show. This helper exists only for
 * display and never feeds a score.
 *
 * @returns percent, or `null` when there are fewer than 200 bars, the last close
 *   is not finite, or the SMA is not positive.
 *
 * @internal Used by computeFearGreedIndex; not part of the public API.
 */
export function computeMa200DisplayDistancePct(bars: Bar[]): number | null {
    const last = bars[bars.length - 1];
    if (!last || !Number.isFinite(last.close)) return null;
    const smas = calculateMA(bars, MA200_WINDOW);
    const ma200 = smas[smas.length - 1];
    if (ma200 === null || ma200 === undefined || ma200 <= 0) return null;
    return ((last.close - ma200) / ma200) * 100;
}

/**
 * Compute the 5-factor raw values at index `t`. Returns `null` when:
 * - t < 1
 * - the rolling window for any factor has fewer than its minimum sample size
 * - VolumeProfile fails to produce a POC (e.g. all-zero volumes in window)
 *
 * look-ahead avoidance: rolling stats use bars[wStart..t) (current bar excluded).
 * Exception per spec §2.3: 52w high/low includes the current bar by definition,
 * so the result stays within [0, 1] even on new highs/lows.
 *
 * @internal Used by walkForward; not part of the public API.
 */
export function computeFactorsAtT(
    bars: Bar[],
    buySellVolume: BuySellVolumeResult[],
    t: number,
    pocWindow: number = POC_WINDOW_DEFAULT
): FactorValues | null {
    if (t < 1) return null;
    const bar = bars[t];
    const prev = bars[t - 1];
    if (!bar || !prev) return null;

    const wStart = Math.max(0, t - VOL_Z_WINDOW);
    const volSamples = bars.slice(wStart, t).map(b => b.volume);
    const volCount = volSamples.length;
    if (volCount < MIN_ROLLING_GUARD) return null;
    const mean = volSamples.reduce((a, b) => a + b, 0) / volCount;
    const variance =
        volSamples.reduce((a, v) => a + (v - mean) ** 2, 0) / volCount;
    const std = Math.sqrt(variance);
    if (std === 0) return null;
    const z = (bar.volume - mean) / std;
    const dailyReturn = bar.close - prev.close;
    const sign = dailyReturn === 0 ? 0 : Math.sign(dailyReturn);
    const volumeZ = z * sign;

    const bsv = buySellVolume[t];
    const total = bsv ? bsv.buyVolume + bsv.sellVolume : 0;
    const buySellImb =
        bsv && total > 0 ? (bsv.buyVolume - bsv.sellVolume) / total : 0;

    const pocStart = Math.max(0, t - pocWindow);
    const pocBars = bars.slice(pocStart, t);
    if (pocBars.length < MIN_ROLLING_GUARD) return null;
    const vp = calculateVolumeProfile(pocBars);
    if (!vp) return null;
    if (vp.poc === 0) return null;
    const pocDist = (bar.close - vp.poc) / vp.poc;

    const ma200Start = Math.max(0, t - MA200_WINDOW);
    const ma200Closes = bars.slice(ma200Start, t).map(b => b.close);
    const ma200Count = ma200Closes.length;
    if (ma200Count < FEAR_GREED_MIN_FACTOR_WINDOW) return null;
    const ma200 = ma200Closes.reduce((a, b) => a + b, 0) / ma200Count;
    if (ma200 === 0) return null;
    const ma200Dist = (bar.close - ma200) / ma200;

    const rangeStart = Math.max(0, t - RANGE_WINDOW + 1);
    const rangeBars = bars.slice(rangeStart, t + 1);
    if (rangeBars.length < FEAR_GREED_MIN_FACTOR_WINDOW) return null;
    const high = rangeBars.reduce(
        (acc, b) => (b.high > acc ? b.high : acc),
        -Infinity
    );
    const low = rangeBars.reduce(
        (acc, b) => (b.low < acc ? b.low : acc),
        Infinity
    );
    const rangePosition = high === low ? 0.5 : (bar.close - low) / (high - low);

    return { volumeZ, buySellImb, pocDist, ma200Dist, rangePosition };
}
