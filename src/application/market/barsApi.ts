import { hasUsablePrices } from '@/domain/analysis/analysisUtils';
import { calculateIndicators } from '@/domain/indicators';
import type { BarsData, Timeframe } from '@/domain/types';
import {
    TIMEFRAME_BARS_LIMIT,
    TIMEFRAME_LOOKBACK_DAYS,
} from '@/domain/constants/market';
import { ISO_DATE_PREFIX_LENGTH } from '@/domain/constants/format';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';

function computeFromDay(timeframe: Timeframe, now: Date): string {
    const lookbackDays = TIMEFRAME_LOOKBACK_DAYS[timeframe];
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - lookbackDays);
    return (
        from.toISOString().substring(0, ISO_DATE_PREFIX_LENGTH) + 'T00:00:00Z'
    );
}

/**
 * Fetch recent OHLCV bars for `symbol`/`timeframe` and compute the full indicator suite.
 *
 * The lookback window and bar count are derived from the timeframe via
 * `TIMEFRAME_LOOKBACK_DAYS` and `TIMEFRAME_BARS_LIMIT`.
 *
 * @param provider - Market data provider injected by the consumer (siglens app).
 * @param symbol - U.S. equity ticker used as the canonical identifier (e.g. `"AAPL"`).
 * @param timeframe - Bar resolution literal (`"5Min" | "15Min" | "1Hour" | "1Day" | ...`).
 * @param fmpSymbol - Optional override symbol passed to the provider when FMP
 *   uses a different identifier (e.g. an index that exposes itself as `^GSPC`
 *   instead of `SPY`). Defaults to `symbol`.
 * @param now - Override the "now" reference used to compute the lookback window.
 *   Useful in tests; defaults to `new Date()`.
 * @returns Bars and the computed indicator results, ready to be passed to
 *   downstream prompt builders or signal detectors.
 *
 * @throws {Error} If the injected provider's `getBars` call fails
 *   (e.g. network error, upstream rate limit).
 *
 * @example
 * ```ts
 * const { bars, indicators } = await fetchBarsWithIndicators(provider, 'AAPL', '1Day');
 * const signals = detectSignals(bars, indicators);
 * ```
 *
 * @see calculateIndicators
 */
export async function fetchBarsWithIndicators(
    provider: MarketDataProvider,
    symbol: string,
    timeframe: Timeframe,
    fmpSymbol?: string,
    now = new Date()
): Promise<BarsData> {
    const fromDay = computeFromDay(timeframe, now);
    const limit = TIMEFRAME_BARS_LIMIT[timeframe];
    const rawBars = await provider.getBars({
        symbol: fmpSymbol ?? symbol,
        timeframe,
        limit,
        from: fromDay,
    });
    // Single choke point for every analysis path and both consumers — see
    // `hasUsablePrices` for the placeholder bars this removes.
    const bars = rawBars.filter(hasUsablePrices);
    if (bars.length < rawBars.length) {
        console.warn('[barsApi] dropped bars without usable OHLC prices', {
            symbol,
            timeframe,
            dropped: rawBars.length - bars.length,
            kept: bars.length,
        });
    }

    const indicators = calculateIndicators(bars);
    return { bars, indicators };
}
