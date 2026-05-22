import { aggregateOpenInterest } from './aggregateOpenInterest';
import { aggregateVolume } from './aggregateVolume';
import { calculateImpliedMove } from './calculateImpliedMove';
import { calculateMaxPain } from './calculateMaxPain';
import { calculatePutCallRatio } from './calculatePutCallRatio';
import type {
    OptionsChain,
    OptionsContract,
    OptionsExpirationMetrics,
    TopOiQuote,
} from './types';

/**
 * Number of top strikes (by combined call+put OI or volume) to surface in
 * the LLM summary. Three is enough for the analyst to anchor a narrative
 * around the two or three highest-attention strikes without bloating the
 * prompt with marginal levels. Matches the JSDoc contract on
 * {@link OptionsExpirationMetrics.topOpenInterestStrikes}.
 *
 * OI top과 Volume top 모두 동수 유지 — 프롬프트 내 두 섹션 균형.
 */
const TOP_STRIKES_COUNT = 3;

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
        .slice(0, TOP_STRIKES_COUNT);

    const volumeByStrike = aggregateVolume(chain);
    const topVolume = volumeByStrike
        .toSorted(
            (a, b) => b.callVolume + b.putVolume - (a.callVolume + a.putVolume)
        )
        .slice(0, TOP_STRIKES_COUNT);

    const topOiBidAskSummary = top.map(({ strike }) =>
        buildTopOiQuote(strike, chain)
    );

    return {
        expirationDate: chain.expirationDate,
        maxPain: calculateMaxPain(chain),
        putCallRatio: calculatePutCallRatio(chain),
        atmImpliedVolatility: atmIv,
        topOpenInterestStrikes: top,
        impliedMovePercent: calculateImpliedMove(atmIv, chain.daysToExpiration),
        topVolumeStrikes: topVolume,
        topOiBidAskSummary,
    };
}

interface MidAndSpread {
    mid: number | null;
    spread: number | null;
}

/** Build a bid/ask quote snapshot for one strike from the first matching call and put. */
function buildTopOiQuote(strike: number, chain: OptionsChain): TopOiQuote {
    const callContract = chain.calls.find(c => c.strike === strike);
    const putContract = chain.puts.find(p => p.strike === strike);
    const callQuote = computeMidAndSpread(callContract);
    const putQuote = computeMidAndSpread(putContract);
    return {
        strike,
        callMidPrice: callQuote.mid,
        callSpread: callQuote.spread,
        putMidPrice: putQuote.mid,
        putSpread: putQuote.spread,
    };
}

/**
 * Derive mid price and spread from a contract's bid/ask. Returns `null`
 * for both fields when:
 * - the contract is missing,
 * - either bid or ask is `null` (one-sided market),
 * - the resulting spread is negative (crossed/locked quote — treated as
 *   bad data rather than a real market state).
 */
function computeMidAndSpread(
    contract: OptionsContract | undefined
): MidAndSpread {
    if (!contract) return { mid: null, spread: null };
    const { bid, ask } = contract;
    if (bid === null || ask === null) return { mid: null, spread: null };
    const spread = ask - bid;
    if (spread < 0) return { mid: null, spread: null };
    return { mid: (bid + ask) / 2, spread };
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
    //
    // `!` non-null assertion rationale:
    //   - TS limitation: TypeScript cannot relate the `all.length === 0`
    //     early-return guard above to `medianStrike`'s `number | undefined`
    //     signature across the function boundary, so it still widens the
    //     branch to include `undefined`.
    //   - Runtime invariant: `medianStrike` returns `undefined` only when
    //     its input array is empty; the early-return above ensures `all` is
    //     non-empty here, so the result is guaranteed defined.
    const anchor =
        typeof underlyingPrice === 'number' && Number.isFinite(underlyingPrice)
            ? underlyingPrice
            : medianStrike(all)!;

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

function medianStrike(
    contracts: ReadonlyArray<OptionsContract>
): number | undefined {
    if (contracts.length === 0) return undefined;
    const strikes = contracts.map(c => c.strike).toSorted((a, b) => a - b);
    return strikes[Math.floor(strikes.length / 2)];
}
