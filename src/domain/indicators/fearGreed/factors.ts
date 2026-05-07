import type { Bar, BuySellVolumeResult } from '@/domain/types';
import { calculateVolumeProfile } from '@/domain/indicators/volume-profile';
import type { FactorValues } from '@/domain/indicators/fearGreed/types';

const VOL_Z_WINDOW = 20;
const POC_WINDOW_DEFAULT = 60;
const MA200_WINDOW = 200;
const RANGE_WINDOW = 252;

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
 * @internal Used internally by walkForward.ts for snapshot/history computation.
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

    // Volume z (signed) — rolling 20, 현재 t 미포함
    const wStart = Math.max(0, t - VOL_Z_WINDOW);
    const window = bars.slice(wStart, t).map(b => b.volume);
    if (window.length < 5) return null;
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance =
        window.reduce((a, v) => a + (v - mean) ** 2, 0) / window.length;
    const std = Math.sqrt(variance);
    const dailyReturn = bar.close - prev.close;
    const sign = dailyReturn === 0 ? 0 : Math.sign(dailyReturn);
    // std=0 means uniform volume in window — z is undefined.
    // Fall back to sign(bar.volume - mean) so spikes still register as ±1.
    const z =
        std === 0 ? Math.sign(bar.volume - mean) : (bar.volume - mean) / std;
    const volumeZ = z * sign;

    // Buy/Sell 불균형 — t bar 자체 분류
    let buySellImb = 0;
    const bsv = buySellVolume[t];
    if (bsv) {
        const total = bsv.buyVolume + bsv.sellVolume;
        if (total > 0) {
            buySellImb = (bsv.buyVolume - bsv.sellVolume) / total;
        }
    }

    // POC 거리 — 60-bar window (현재 미포함). VP가 산출 불가능하면 중립(0).
    const pocStart = Math.max(0, t - pocWindow);
    const pocBars = bars.slice(pocStart, t);
    if (pocBars.length < 5) return null;
    const vp = calculateVolumeProfile(pocBars);
    const pocDist = vp && vp.poc !== 0 ? (bar.close - vp.poc) / vp.poc : 0;

    // MA200 거리 — 직전 200 close (현재 미포함). 5 미만이면 null.
    const ma200Start = Math.max(0, t - MA200_WINDOW);
    const ma200Closes = bars.slice(ma200Start, t).map(b => b.close);
    if (ma200Closes.length < 5) return null;
    const ma200 =
        ma200Closes.reduce((a, b) => a + b, 0) / ma200Closes.length;
    const ma200Dist = (bar.close - ma200) / ma200;

    // 52w 위치 — 현재 bar 포함 252 윈도우 (factor 정의상). 5 미만이면 null.
    const rangeStart = Math.max(0, t - RANGE_WINDOW + 1);
    const rangeBars = bars.slice(rangeStart, t + 1);
    if (rangeBars.length < 5) return null;
    const high = Math.max(...rangeBars.map(b => b.high));
    const low = Math.min(...rangeBars.map(b => b.low));
    const rangePosition =
        high === low ? 0.5 : (bar.close - low) / (high - low);

    return { volumeZ, buySellImb, pocDist, ma200Dist, rangePosition };
}
