import type { Bar, BuySellVolumeResult } from '@/domain/types';
import { calculateVolumeProfile } from '@/domain/indicators/volume-profile';
import type { FactorValues } from '@/domain/indicators/fearGreed/types';

const VOL_Z_WINDOW = 20;
/** Default Volume Profile window for POC distance factor. Must match the value used by walkForward. */
export const POC_WINDOW_DEFAULT = 60;
const MA200_WINDOW = 200;
const RANGE_WINDOW = 252;

/** Minimum sample size required for MA200/52w-position factor windows to produce a value. */
export const FEAR_GREED_MIN_FACTOR_WINDOW = 30;

/**
 * Compute the 5-factor raw values at index `t`. Returns `null` when:
 * - t < 1
 * - the rolling window for any factor has fewer than its minimum sample size
 * - VolumeProfile fails to produce a POC (e.g. all-zero volumes in window)
 *
 * look-ahead avoidance: rolling stats use bars[wStart..t) (current bar excluded).
 * Exception per spec §2.3: 52w high/low includes the current bar by definition,
 * so the result stays within [0, 1] even on new highs/lows.
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
    if (volSamples.length < 5) return null;
    const mean = volSamples.reduce((a, b) => a + b, 0) / volSamples.length;
    const variance =
        volSamples.reduce((a, v) => a + (v - mean) ** 2, 0) / volSamples.length;
    const std = Math.sqrt(variance);
    if (std === 0) return null;
    const z = (bar.volume - mean) / std;
    const dailyReturn = bar.close - prev.close;
    const sign = dailyReturn === 0 ? 0 : Math.sign(dailyReturn);
    const volumeZ = z * sign;

    let buySellImb = 0;
    const bsv = buySellVolume[t];
    if (bsv) {
        const total = bsv.buyVolume + bsv.sellVolume;
        if (total > 0) {
            buySellImb = (bsv.buyVolume - bsv.sellVolume) / total;
        }
    }

    const pocStart = Math.max(0, t - pocWindow);
    const pocBars = bars.slice(pocStart, t);
    if (pocBars.length < 5) return null;
    const vp = calculateVolumeProfile(pocBars);
    if (!vp) return null;
    const pocDist = (bar.close - vp.poc) / vp.poc;

    const ma200Start = Math.max(0, t - MA200_WINDOW);
    const ma200Closes = bars.slice(ma200Start, t).map(b => b.close);
    if (ma200Closes.length < FEAR_GREED_MIN_FACTOR_WINDOW) return null;
    const ma200 =
        ma200Closes.reduce((a, b) => a + b, 0) / ma200Closes.length;
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
    const rangePosition =
        high === low ? 0.5 : (bar.close - low) / (high - low);

    return { volumeZ, buySellImb, pocDist, ma200Dist, rangePosition };
}
