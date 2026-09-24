import { alignCryptoSeries } from '@/domain/indicators/cryptoFearGreed/align';
import {
    computeCryptoFactorsAtT,
    CRYPTO_FEAR_GREED_MIN_UNIVERSE,
} from '@/domain/indicators/cryptoFearGreed/factors';
import {
    CRYPTO_FEAR_GREED_FACTOR_KEYS,
    type AlignedCryptoSeries,
    type CryptoFactorValues,
    type CryptoFearGreedInput,
    type CryptoFearGreedSnapshot,
} from '@/domain/indicators/cryptoFearGreed/types';
import {
    walkForwardHistory,
    walkForwardSnapshot,
} from '@/domain/indicators/fearGreed/equalWeight';
import type { FearGreedHistoryPoint } from '@/domain/indicators/fearGreed/types';

/**
 * Factor time series, all `null` when the universe is below the minimum size —
 * that single guard makes both the snapshot and every history point `null`.
 */
function buildFactorTS(
    series: AlignedCryptoSeries
): Array<CryptoFactorValues | null> {
    const tooSmall = series.universe.length < CRYPTO_FEAR_GREED_MIN_UNIVERSE;
    return Array.from({ length: series.dates.length }, (_, t) =>
        tooSmall ? null : computeCryptoFactorsAtT(series, t)
    );
}

/**
 * Crypto-market Fear & Greed snapshot for the latest common session.
 *
 * The benchmark and every universe coin are inner-joined on their UTC day, and
 * the safe-haven series is forward-filled onto those sessions. Each of the six
 * factors is then ranked against its own prior history (walk-forward — the
 * current session is never part of its own distribution), and the percentiles
 * are averaged with equal weight. Scale, labels, and confidence match
 * `computeMarketFearGreedIndex`.
 *
 * Returns `null` when:
 * - `universe` holds fewer than 5 coins (breadth and alt-season would be
 *   meaningless),
 * - the series share no common session on or after the first safe-haven close,
 * - the latest session is still inside the 124-session warm-up window, or
 * - fewer earlier sessions are available to rank against than
 *   `FEAR_GREED_CONFIDENCE_THRESHOLDS.LIMITED`.
 *
 * @param input - Benchmark (BTC), safe-haven (gold), and universe series.
 *   Roughly 125 + 60 common sessions are needed before `confidence` reaches
 *   `'normal'`.
 * @returns {CryptoFearGreedSnapshot | null} The snapshot, or `null` when the data is insufficient.
 *
 * @example
 * const snapshot = computeCryptoFearGreedIndex({
 *     benchmark: btcBars,
 *     safeHaven: goldCloses,
 *     universe: { eth: ethBars, sol: solBars, xrp: xrpBars, bnb: bnbBars, ada: adaBars },
 * });
 */
export function computeCryptoFearGreedIndex(
    input: CryptoFearGreedInput
): CryptoFearGreedSnapshot | null {
    const series = alignCryptoSeries(input);
    return walkForwardSnapshot(
        CRYPTO_FEAR_GREED_FACTOR_KEYS,
        series.dates,
        buildFactorTS(series)
    );
}

/**
 * Walk-forward crypto-market Fear & Greed history, one point per common session.
 *
 * For each session `t` the distribution is the valid factor bundles in `[0, t)`,
 * so appending later sessions never changes an earlier point. Points inside the
 * warm-up window, before `FEAR_GREED_CONFIDENCE_THRESHOLDS.LIMITED` prior
 * samples accumulate, or for a universe below the minimum size carry
 * `score: null`, which the UI renders as a gap.
 *
 * @param input - Benchmark (BTC), safe-haven (gold), and universe series.
 * @returns {FearGreedHistoryPoint[]} One point per common session, ascending by date.
 */
export function computeCryptoFearGreedHistory(
    input: CryptoFearGreedInput
): FearGreedHistoryPoint[] {
    const series = alignCryptoSeries(input);
    return walkForwardHistory(
        CRYPTO_FEAR_GREED_FACTOR_KEYS,
        series.dates,
        buildFactorTS(series)
    );
}
