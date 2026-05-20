import { aggregateOpenInterest } from './aggregateOpenInterest';
import { calculateImpliedMove } from './calculateImpliedMove';
import { calculateMaxPain } from './calculateMaxPain';
import { calculatePutCallRatio } from './calculatePutCallRatio';
import type {
    OptionsChain,
    OptionsContract,
    OptionsExpirationMetrics,
} from './types';

/**
 * Reduce an OptionsChain (potentially hundreds of strikes) to a compact set
 * of metrics suitable for LLM prompt input. The result extracts single-
 * number aggregates (Max Pain, P/C ratio, ATM IV) plus the top-3 strikes
 * by combined OI, keeping token count bounded regardless of chain depth.
 *
 * @param chain - The expiration's chain.
 * @param underlyingPrice - When the caller knows the spot price (typically
 *   from the parent snapshot), pass it so `pickAtmIv` anchors on the actual
 *   ATM strike. Without it, the helper falls back to the median strike,
 *   which is a rougher proxy and can be misleading on skewed chains.
 * @returns Single-expiration metrics including Max Pain, P/C ratio, ATM IV,
 *   the top 3 OI strikes, and implied move %.
 */
export function summarizeChainForLlm(
    chain: OptionsChain,
    underlyingPrice?: number
): OptionsExpirationMetrics {
    const atmIv = pickAtmIv(chain, underlyingPrice);
    const oiByStrike = aggregateOpenInterest(chain);
    const top = oiByStrike
        .toSorted(
            (a, b) =>
                b.callOpenInterest +
                b.putOpenInterest -
                (a.callOpenInterest + a.putOpenInterest)
        )
        .slice(0, 3);

    return {
        expirationDate: chain.expirationDate,
        maxPain: calculateMaxPain(chain),
        putCallRatio: calculatePutCallRatio(chain),
        atmImpliedVolatility: atmIv,
        topOpenInterestStrikes: top,
        impliedMovePercent: calculateImpliedMove(atmIv, chain.daysToExpiration),
    };
}

function pickAtmIv(
    chain: OptionsChain,
    underlyingPrice: number | undefined
): number | null {
    const all = [...chain.calls, ...chain.puts];
    if (all.length === 0) return null;
    // ATM proxy: contract with smallest |strike - anchor|. Prefer the real
    // underlying spot when provided; otherwise fall back to the median
    // strike (good enough for balanced chains).
    const anchor =
        typeof underlyingPrice === 'number' && Number.isFinite(underlyingPrice)
            ? underlyingPrice
            : medianStrike(all);

    const best = all.reduce<{ distance: number; iv: number } | null>(
        (acc, c) => {
            if (c.impliedVolatility === null) return acc;
            const distance = Math.abs(c.strike - anchor);
            return acc === null || distance < acc.distance
                ? { distance, iv: c.impliedVolatility }
                : acc;
        },
        null
    );
    return best?.iv ?? null;
}

function medianStrike(contracts: ReadonlyArray<OptionsContract>): number {
    const strikes = contracts.map(c => c.strike).toSorted((a, b) => a - b);
    return strikes[Math.floor(strikes.length / 2)];
}
