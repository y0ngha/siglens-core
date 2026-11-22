import { isIntraday } from '@/domain/constants/market';
import { SECONDS_PER_DAY } from '@/domain/constants/time';
import type { Bar, Timeframe } from '@/domain/types';
import { typicalPrice } from './utils';

interface VWAPState {
    cumulativeTPV: number;
    cumulativeVolume: number;
    dayKey: number;
    results: (number | null)[];
}

/** @internal Volume-Weighted Average Price — session-anchored running VWAP. */
export function calculateVWAP(bars: Bar[]): (number | null)[] {
    if (bars.length === 0) return [];

    return bars.reduce<VWAPState>(
        (acc, bar) => {
            const dayKey = Math.floor(bar.time / SECONDS_PER_DAY);
            const reset = dayKey !== acc.dayKey;
            const cumulativeTPV = reset ? 0 : acc.cumulativeTPV;
            const cumulativeVolume = reset ? 0 : acc.cumulativeVolume;
            const tp = typicalPrice(bar.high, bar.low, bar.close);
            const newTPV = cumulativeTPV + tp * bar.volume;
            const newVolume = cumulativeVolume + bar.volume;
            const vwap = newVolume === 0 ? null : newTPV / newVolume;
            return {
                cumulativeTPV: newTPV,
                cumulativeVolume: newVolume,
                dayKey,
                results: [...acc.results, vwap],
            };
        },
        { cumulativeTPV: 0, cumulativeVolume: 0, dayKey: -1, results: [] }
    ).results;
}

/**
 * @internal Whether a VWAP reading is meaningful on `timeframe`.
 *
 * {@link calculateVWAP} restarts at every UTC day, which is a session anchor only
 * when a day holds several bars. On a daily bar the "session" is that one bar, so
 * the value is its own typical price `(H+L+C)/3` — not a volume-weighted average
 * of anything, and not a level. Prompt and reference-level builders skip VWAP on
 * `1Day` and `1Week` (a weekly bar holds several daily sessions, so the reset day is not
 * a session anchor either) instead of printing it as a support/resistance.
 */
export function isSessionVwapMeaningful(timeframe: Timeframe): boolean {
    return isIntraday(timeframe);
}
