import { calculateBuySellVolume } from '@/domain/indicators/buySellVolume';
import type { Bar, BarsData, BuySellVolumeResult } from '@/domain/types';

/** Bars and the parallel buy/sell volume that Fear & Greed is computed from. */
export interface FearGreedInputs {
    /** Daily bars, oldest-first. */
    bars: Bar[];
    /** Per-bar buy/sell volume, index-aligned with `bars`. */
    buySellVolume: BuySellVolumeResult[];
}

/**
 * The series every Fear & Greed computation for an instrument should use.
 *
 * When the data carries the longer `fearGreedBars` history (`1Day` results of
 * `fetchBarsWithIndicators`), that history is used with its own buy/sell
 * volume — the score is a percentile against the instrument's past, so every
 * surface must measure against the **same** past or the same day reads two
 * different scores. Otherwise it falls back to the standard `bars` and their
 * already-computed `indicators.buySellVolume`.
 *
 * Buy/sell volume is a per-bar split (no lookback), so recomputing it on the
 * longer series yields the same values for the overlapping tail. The result is
 * not memoised — call this once per request and reuse it when computing both
 * the snapshot and the history.
 *
 * @param data - Bars data, typically from `fetchBarsWithIndicators`.
 * @returns Bars and index-aligned buy/sell volume to pass to
 *   `computeFearGreedIndex` / `computeFearGreedHistory`.
 */
export function fearGreedInputs(data: BarsData): FearGreedInputs {
    const longBars = data.fearGreedBars;
    if (longBars !== undefined && longBars.length > 0) {
        return {
            bars: longBars,
            buySellVolume: calculateBuySellVolume(longBars),
        };
    }
    return { bars: data.bars, buySellVolume: data.indicators.buySellVolume };
}
