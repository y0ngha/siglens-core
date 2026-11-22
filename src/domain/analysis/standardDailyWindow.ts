import { TIMEFRAME_LOOKBACK_DAYS } from '@/domain/constants/market';
import { MS_PER_SECOND } from '@/domain/constants/time';
import type { Bar } from '@/domain/types';

/**
 * @internal The standard `1Day` window (`TIMEFRAME_LOOKBACK_DAYS['1Day']` calendar days back
 * from `now`'s UTC date, inclusive) of a longer daily history: what a plain `1Day` fetch
 * returns as `bars`. A `1Week` analysis reads its daily-scale facts (the risk grade) from
 * this slice of `fearGreedBars`, so one instrument gets one grade whatever chart is open.
 *
 * Daily bars are compared by `Bar.time` with the cutoff at UTC midnight, so they must be
 * stamped at UTC-midnight seconds (the convention every daily source follows). Pure.
 *
 * @param dailyBars - Daily bars, oldest first.
 * @param now - The same reference instant the fetch used.
 */
export function standardDailyWindow(
    dailyBars: readonly Bar[],
    now: Date
): Bar[] {
    const cutoffSec =
        Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() - TIMEFRAME_LOOKBACK_DAYS['1Day']
        ) / MS_PER_SECOND;
    return dailyBars.filter(bar => bar.time >= cutoffSec);
}
