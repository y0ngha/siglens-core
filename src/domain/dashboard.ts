import {
    ISO_DATE_HOUR_PREFIX_LENGTH,
    ISO_DATE_PREFIX_LENGTH,
} from '@/domain/constants/format';
import { MS_PER_DAY } from '@/domain/constants/time';
import { calculateIndicators } from '@/domain/indicators';
import { classifyTrend, detectSignals } from '@/domain/signals';
import type {
    Bar,
    DashboardTimeframe,
    MarketQuote,
    SectorStock,
    StockSignalResult,
} from '@/domain/types';

const FIFTEEN_MIN_BUCKET = 15;
const MIN_BARS_FOR_PERCENT_CHANGE = 2;
const PERCENT_FACTOR = 100;

const LOOKBACK_DAYS_BY_TIMEFRAME: Record<DashboardTimeframe, number> = {
    // 일봉: 약 1.5년치 (지표 워밍업 + SMC 룩백 여유)
    '1Day': 400,
    // 시봉: 약 5주치 (squeeze lookback 120봉 + 트레이딩 시간 고려)
    '1Hour': 40,
    // 15분봉: 약 10일치 (시장 시간 기준 ~5거래일)
    '15Min': 10,
};

/**
 * Compute a deterministic time-bucket key for cache lookups.
 *
 * Each `DashboardTimeframe` maps to a bucket granularity:
 * - `'1Day'` → ISO date prefix (e.g. `"2026-04-26"`).
 * - `'1Hour'` → ISO date+hour prefix (e.g. `"2026-04-26T14"`).
 * - `'15Min'` → date+hour with the minute floored to a 15-minute boundary
 *   (e.g. `"2026-04-26T14:30"`).
 *
 * Concurrent dashboard loads within the same bucket share a single cache
 * entry; bucket rollover guarantees a recompute on the boundary.
 *
 * @param timeframe - Dashboard bar resolution.
 * @param now - The "now" reference in UTC.
 * @returns The bucket key string.
 *
 * @see lookbackIsoFromNow
 * @see getSectorSignals
 */
export function bucketedTimestamp(
    timeframe: DashboardTimeframe,
    now: Date
): string {
    const iso = now.toISOString();
    if (timeframe === '1Day') return iso.slice(0, ISO_DATE_PREFIX_LENGTH);
    if (timeframe === '1Hour') return iso.slice(0, ISO_DATE_HOUR_PREFIX_LENGTH);
    const minutes = now.getUTCMinutes();
    const bucketMin =
        Math.floor(minutes / FIFTEEN_MIN_BUCKET) * FIFTEEN_MIN_BUCKET;
    const minStr = bucketMin.toString().padStart(2, '0');
    return `${iso.slice(0, ISO_DATE_HOUR_PREFIX_LENGTH)}:${minStr}`;
}

/**
 * Compute the ISO timestamp `now` minus the timeframe-specific lookback window.
 *
 * Lookback days are tuned per timeframe to satisfy indicator warm-up plus
 * SMC structure history requirements:
 * - `'1Day'` → 400 days (≈1.5 years for SMC + warm-up)
 * - `'1Hour'` → 40 days (≈5 weeks for ~120-bar squeeze lookback)
 * - `'15Min'` → 10 calendar days (≈5 trading days)
 *
 * @param timeframe - Dashboard bar resolution.
 * @param now - The "now" reference.
 * @returns The lookback start as an ISO 8601 timestamp.
 *
 * @see bucketedTimestamp
 * @see getSectorSignals
 */
export function lookbackIsoFromNow(
    timeframe: DashboardTimeframe,
    now: Date
): string {
    const msToSubtract = LOOKBACK_DAYS_BY_TIMEFRAME[timeframe] * MS_PER_DAY;
    return new Date(now.getTime() - msToSubtract).toISOString();
}

/**
 * Reduce a single sector stock's bars + quote into a dashboard signal entry.
 *
 * Returns `null` when:
 * - fewer than 2 bars are available (cannot compute a percent change), or
 * - {@link detectSignals} fires nothing (no actionable signal to display).
 *
 * Otherwise computes indicators, signals, and trend, and prefers the live
 * `quote` for `price` and `changePercent`. Falls back to the last bar's
 * close-vs-prev-close when no quote is provided.
 *
 * @param stock - Sector-stock metadata (symbol, Korean name, parent sector).
 * @param bars - OHLCV bars sorted oldest-first.
 * @param quote - Optional live quote; `null` falls back to bar-derived
 *   price and change.
 * @returns A `StockSignalResult` ready for the dashboard, or `null` to skip.
 *
 * @see getSectorSignals
 */
export function computeStockSignalResult(
    stock: SectorStock,
    bars: Bar[],
    quote: MarketQuote | null
): StockSignalResult | null {
    if (bars.length < MIN_BARS_FOR_PERCENT_CHANGE) return null;
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];

    const indicators = calculateIndicators(bars);
    const signals = detectSignals(bars, indicators);
    if (signals.length === 0) return null;

    const trend = classifyTrend(bars, indicators);
    const price = quote?.price ?? last.close;
    const changePercent =
        quote?.changesPercentage ??
        (prev.close === 0
            ? 0
            : ((last.close - prev.close) / prev.close) * PERCENT_FACTOR);

    return {
        symbol: stock.symbol,
        koreanName: stock.koreanName,
        sectorSymbol: stock.sectorSymbol,
        price,
        changePercent,
        trend,
        signals,
    };
}
