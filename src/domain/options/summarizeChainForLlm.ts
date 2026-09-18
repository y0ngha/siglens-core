import { aggregateOpenInterest } from './aggregateOpenInterest';
import { aggregateVolume } from './aggregateVolume';
import { calculateImpliedMove } from './calculateImpliedMove';
import { calculateMaxPain } from './calculateMaxPain';
import { calculatePutCallRatio } from './calculatePutCallRatio';
import type {
    LlmStrikeOpenInterest,
    MidAndSpread,
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

/** @internal `|distancePct| < 0.5` counts as `'at'` the underlying price rather than above/below it. */
const AT_PRICE_DISTANCE_PCT = 0.5;

const PERCENT_FACTOR = 100;

/** Decimal places every `*Pct` field in this module rounds to (spec 2026-09-18 §B5). */
const PCT_DECIMAL_PLACES = 2;
const PCT_ROUND_FACTOR = 10 ** PCT_DECIMAL_PLACES;

function isFinitePositive(n: number | null | undefined): n is number {
    return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * @internal Round `n` to {@link PCT_DECIMAL_PLACES}, stripping `-0` (a value
 * that rounds to exactly zero loses its sign — never `-0`, per spec §0).
 * `null` passes through unchanged.
 */
function roundPct(n: number | null): number | null {
    if (n === null) return null;
    const rounded = Math.round(n * PCT_ROUND_FACTOR) / PCT_ROUND_FACTOR;
    return rounded === 0 ? 0 : rounded;
}

/**
 * @internal Signed `% distance` of `value` from a positive `base`, rounded to
 * {@link PCT_DECIMAL_PLACES}, or `null` when either input cannot support a
 * ratio (null rule, spec §0).
 */
function signedDistancePct(
    value: number | null,
    base: number | undefined
): number | null {
    if (value === null || !Number.isFinite(value)) return null;
    if (!isFinitePositive(base)) return null;
    return roundPct(((value - base) / base) * PERCENT_FACTOR);
}

/** @internal `'above'` / `'below'` / `'at'` (within {@link AT_PRICE_DISTANCE_PCT}) from a signed distance, or `null`. */
function sideFromDistance(
    distancePct: number | null
): 'above' | 'below' | 'at' | null {
    if (distancePct === null) return null;
    if (Math.abs(distancePct) < AT_PRICE_DISTANCE_PCT) return 'at';
    return distancePct > 0 ? 'above' : 'below';
}

/**
 * @internal Bid/ask `spread / mid × 100`, rounded to
 * {@link PCT_DECIMAL_PLACES}, or `null` when either input is unusable.
 */
function spreadPct(mid: number | null, spread: number | null): number | null {
    if (mid === null || spread === null) return null;
    if (!Number.isFinite(mid) || !Number.isFinite(spread) || mid <= 0)
        return null;
    return roundPct((spread / mid) * PERCENT_FACTOR);
}

/**
 * @internal `underlyingPrice × (1 ∓ impliedMovePercent / 100)`, rounded to
 * {@link PCT_DECIMAL_PLACES} like every other field in this module (spec
 * 2026-09-18), or `null` when the price or the implied move is
 * unavailable — or when `impliedMovePercent >= 100`, which would put `low`
 * at or below zero (an implied move that size is itself an unusable/bad
 * input, not a real "the stock could go to $0 or below" range).
 */
function computeImpliedMoveRange(
    underlyingPrice: number | undefined,
    impliedMovePercent: number | null
): { low: number; high: number } | null {
    if (!isFinitePositive(underlyingPrice)) return null;
    if (impliedMovePercent === null || !Number.isFinite(impliedMovePercent))
        return null;
    if (impliedMovePercent >= PERCENT_FACTOR) return null;
    const low = roundPct(
        underlyingPrice * (1 - impliedMovePercent / PERCENT_FACTOR)
    );
    const high = roundPct(
        underlyingPrice * (1 + impliedMovePercent / PERCENT_FACTOR)
    );
    if (low === null || high === null) return null;
    return { low, high };
}

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
 *   the top 3 OI strikes, top 3 volume strikes, top-OI bid/ask quotes, and
 *   implied move %.
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
    const topWithDistance: LlmStrikeOpenInterest[] = top.map(s => {
        const distancePct = signedDistancePct(s.strike, underlyingPrice);
        return { ...s, distancePct, side: sideFromDistance(distancePct) };
    });

    const volumeByStrike = aggregateVolume(chain);
    const topVolume = volumeByStrike
        .toSorted(
            (a, b) => b.callVolume + b.putVolume - (a.callVolume + a.putVolume)
        )
        .slice(0, TOP_STRIKES_COUNT);

    const topOiBidAskSummary = top.map(({ strike }) =>
        buildTopOiQuote(strike, chain)
    );

    const maxPain = calculateMaxPain(chain);
    const impliedMovePercent = calculateImpliedMove(
        atmIv,
        chain.daysToExpiration
    );

    return {
        expirationDate: chain.expirationDate,
        daysToExpiration: chain.daysToExpiration,
        maxPain,
        maxPainDistancePct: signedDistancePct(maxPain, underlyingPrice),
        putCallRatio: calculatePutCallRatio(chain),
        atmImpliedVolatility: atmIv,
        topOpenInterestStrikes: topWithDistance,
        impliedMovePercent,
        impliedMoveRange: computeImpliedMoveRange(
            underlyingPrice,
            impliedMovePercent
        ),
        topVolumeStrikes: topVolume,
        topOiBidAskSummary,
    };
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
        callSpreadPct: spreadPct(callQuote.mid, callQuote.spread),
        putSpreadPct: spreadPct(putQuote.mid, putQuote.spread),
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
