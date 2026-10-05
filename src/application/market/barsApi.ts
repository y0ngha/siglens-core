import { hasUsablePrices } from '@/domain/analysis/analysisUtils';
import { calculateIndicators } from '@/domain/indicators';
import type { BarsData, Timeframe } from '@/domain/types';
import {
    FEAR_GREED_LOOKBACK_DAYS,
    TIMEFRAME_BARS_LIMIT,
    TIMEFRAME_LOOKBACK_DAYS,
} from '@/domain/constants/market';
import { ISO_DATE_PREFIX_LENGTH } from '@/domain/constants/format';
import { MS_PER_SECOND } from '@/domain/constants/time';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';

function computeFromDay(lookbackDays: number, now: Date): string {
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
 * For `1Day` the provider is asked once for the longer
 * `FEAR_GREED_LOOKBACK_DAYS` window. `bars` and `indicators` are still the
 * standard `TIMEFRAME_LOOKBACK_DAYS` slice — identical to a standard-window
 * fetch — and the full history is returned separately as `fearGreedBars` for
 * Fear & Greed only (read it via `fearGreedInputs`). The re-cut compares
 * `Bar.time` with the standard `from` date at UTC midnight, so daily bars must
 * be stamped at UTC-midnight seconds (every current provider does; the
 * provider's own `from` is inclusive and so is the re-cut).
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
 *   downstream prompt builders or signal detectors; for `1Day`, also the
 *   longer `fearGreedBars` history.
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
    const standardFrom = computeFromDay(
        TIMEFRAME_LOOKBACK_DAYS[timeframe],
        now
    );
    const withFearGreedHistory = timeframe === '1Day';
    // One provider call either way — the daily endpoint is date-ranged, so a
    // longer window costs payload, not an extra request.
    const fromDay = withFearGreedHistory
        ? computeFromDay(FEAR_GREED_LOOKBACK_DAYS, now)
        : standardFrom;
    const limit = TIMEFRAME_BARS_LIMIT[timeframe];
    const rawBars = await provider.getBars({
        symbol: fmpSymbol ?? symbol,
        timeframe,
        limit,
        from: fromDay,
    });
    // Single choke point for every analysis path and both consumers — see
    // `hasUsablePrices` for the placeholder bars this removes.
    const usableBars = rawBars.filter(hasUsablePrices);
    if (usableBars.length < rawBars.length) {
        console.warn('[barsApi] dropped bars without usable OHLC prices', {
            symbol,
            timeframe,
            dropped: rawBars.length - usableBars.length,
            kept: usableBars.length,
        });
    }

    if (!withFearGreedHistory) {
        return {
            bars: usableBars,
            indicators: calculateIndicators(usableBars),
        };
    }
    // Re-cut the standard window so charts, indicators and analysis prompts
    // see exactly what a standard-window fetch returns — only Fear & Greed
    // reads the longer history.
    const standardFromSec = Date.parse(standardFrom) / MS_PER_SECOND;
    const bars = usableBars.filter(bar => bar.time >= standardFromSec);
    return {
        bars,
        indicators: calculateIndicators(bars),
        fearGreedBars: usableBars,
    };
}
