import {
    walkForwardHistory,
    walkForwardSnapshot,
} from '@/domain/indicators/fearGreed/equalWeight';
import { alignSeries } from '@/domain/indicators/marketFearGreed/align';
import { computeMarketFactorsAtT } from '@/domain/indicators/marketFearGreed/factors';
import {
    MARKET_FEAR_GREED_FACTOR_KEYS,
    type AlignedMarketSeries,
    type MarketFactorValues,
    type MarketFearGreedHistoryPoint,
    type MarketFearGreedInput,
    type MarketFearGreedSnapshot,
} from '@/domain/indicators/marketFearGreed/types';

function buildFactorTS(
    series: AlignedMarketSeries
): Array<MarketFactorValues | null> {
    return Array.from({ length: series.dates.length }, (_, t) =>
        computeMarketFactorsAtT(series, t)
    );
}

/**
 * Market-wide Fear & Greed snapshot for the latest common session.
 *
 * The six input series are inner-joined on their calendar date first, so a
 * session missing from any one series is excluded from all of them. Each factor
 * is then ranked against its own prior history (walk-forward — the current
 * session is never part of its own distribution), and the five percentiles are
 * averaged.
 *
 * Returns `null` when:
 * - the series share no common session,
 * - the latest session is still inside a factor warm-up window, or
 * - fewer earlier sessions are available to rank against than
 *   `FEAR_GREED_CONFIDENCE_THRESHOLDS.LIMITED`.
 *
 * @param input - One daily close series per semantic key. Roughly two years of
 *   history is the practical minimum: `MARKET_FEAR_GREED_WINDOWS.MOMENTUM_MA`
 *   sessions warm up the momentum window, and
 *   `FEAR_GREED_CONFIDENCE_THRESHOLDS.NORMAL` more are needed before
 *   `confidence` reaches `'normal'`.
 * @returns {MarketFearGreedSnapshot | null} The snapshot, or `null` when the data is insufficient.
 */
export function computeMarketFearGreedIndex(
    input: MarketFearGreedInput
): MarketFearGreedSnapshot | null {
    const series = alignSeries(input);
    return walkForwardSnapshot(
        MARKET_FEAR_GREED_FACTOR_KEYS,
        series.dates,
        buildFactorTS(series)
    );
}

/**
 * Walk-forward market Fear & Greed history, one point per common session.
 *
 * For each session `t` the distribution is the valid factor bundles in `[0, t)`,
 * so appending later sessions never changes an earlier point. Points inside the
 * warm-up window — or before `FEAR_GREED_CONFIDENCE_THRESHOLDS.LIMITED` prior
 * samples accumulate — carry `score: null`, which the UI renders as a gap.
 *
 * @param input - One daily close series per semantic key.
 * @returns {MarketFearGreedHistoryPoint[]} One point per common session, ascending by date.
 */
export function computeMarketFearGreedHistory(
    input: MarketFearGreedInput
): MarketFearGreedHistoryPoint[] {
    const series = alignSeries(input);
    return walkForwardHistory(
        MARKET_FEAR_GREED_FACTOR_KEYS,
        series.dates,
        buildFactorTS(series)
    );
}
