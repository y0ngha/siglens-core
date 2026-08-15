import {
    FEAR_GREED_CONFIDENCE_THRESHOLDS,
    scoreToLabel,
} from '@/domain/indicators/fearGreed/composition';
import { percentile } from '@/domain/indicators/fearGreed/percentile';
import {
    MARKET_FEAR_GREED_FACTOR_KEYS,
    type MarketFactorValues,
    type MarketFearGreedFactor,
    type MarketFearGreedFactorKey,
    type MarketFearGreedSnapshot,
} from '@/domain/indicators/marketFearGreed/types';

/** Maps each public factor key to its field on the internal raw bundle. */
const FACTOR_FIELD: Record<MarketFearGreedFactorKey, keyof MarketFactorValues> =
    {
        momentum: 'momentum',
        volatility: 'volatility',
        safe_haven: 'safeHaven',
        junk_bond: 'junkBond',
        breadth: 'breadth',
    };

/**
 * Compose a market-wide score from the current raw factors and the
 * walk-forward sample of prior sessions.
 *
 * Each factor is self-normalised into a percentile against its own history, so
 * factors measured in different units (a moving-average distance, a return
 * spread) combine on one comparable 0..100 scale. The composite is their
 * equal-weight mean — the same weighting CNN applies to its own inputs.
 *
 * @param current - Raw factor values for the session being scored.
 * @param sample - Raw factor values from strictly earlier sessions.
 * @returns The snapshot minus `asOf` — the caller owns the session date — or
 *   `null` when the sample is below the LIMITED confidence threshold and
 *   percentile ranks would be noise.
 *
 * @internal Used by the walk-forward module.
 */
export function composeMarketSnapshot(
    current: MarketFactorValues,
    sample: MarketFactorValues[]
): Omit<MarketFearGreedSnapshot, 'asOf'> | null {
    const sampleSize = sample.length;
    if (sampleSize < FEAR_GREED_CONFIDENCE_THRESHOLDS.LIMITED) return null;

    const factors: MarketFearGreedFactor[] = MARKET_FEAR_GREED_FACTOR_KEYS.map(
        key => {
            const field = FACTOR_FIELD[key];
            return {
                key,
                rawValue: current[field],
                percentile: percentile(
                    current[field],
                    sample.map(s => s[field])
                ),
            };
        }
    );

    const score =
        factors.reduce((sum, f) => sum + f.percentile, 0) / factors.length;

    return {
        score,
        label: scoreToLabel(score),
        factors,
        confidence:
            sampleSize >= FEAR_GREED_CONFIDENCE_THRESHOLDS.NORMAL
                ? 'normal'
                : 'limited',
        sampleSize,
    };
}
