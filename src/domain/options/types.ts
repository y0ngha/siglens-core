/**
 * Single options contract — one strike + side (call or put) from an exchange
 * listing. Plain data only; calculations live in dedicated helpers.
 */
export interface OptionsContract {
    /** Provider-specific contract identifier (e.g. `"AAPL250620C00200000"`). */
    contractSymbol: string;
    /** Strike price in the underlying's currency. */
    strike: number;
    /** Most recent trade price, or `null` if the contract has not traded. */
    lastPrice: number | null;
    /** Highest current bid, or `null` when no bid is posted. */
    bid: number | null;
    /** Lowest current ask, or `null` when no ask is posted. */
    ask: number | null;
    /** Trade volume during the current session. */
    volume: number;
    /** Total contracts currently outstanding (not closed). */
    openInterest: number;
    /** Implied volatility as a 0–1 fraction (e.g., `0.25` = 25% IV). null if unavailable. */
    impliedVolatility: number | null;
    /** `true` when the strike is in-the-money relative to the underlying spot. */
    inTheMoney: boolean;
}

/**
 * Options chain for a single expiration — all calls + all puts grouped by
 * expiration date.
 */
export interface OptionsChain {
    /** Expiration date in ISO `'YYYY-MM-DD'` form. */
    expirationDate: string;
    /** Calendar days until expiration, anchored at ET-midnight. */
    daysToExpiration: number;
    /** Call contracts, sorted ascending by strike. */
    calls: ReadonlyArray<OptionsContract>;
    /** Put contracts, sorted ascending by strike. */
    puts: ReadonlyArray<OptionsContract>;
}

/**
 * Full options snapshot for a symbol — all available expirations captured at
 * one point in time. Returned by {@link OptionsDataProvider.fetchSnapshot}.
 */
export interface OptionsSnapshot {
    /** Underlying ticker (uppercase). */
    symbol: string;
    /** Underlying spot price at snapshot time. */
    underlyingPrice: number;
    /** All available expirations, sorted ascending by `expirationDate`. */
    chains: ReadonlyArray<OptionsChain>;
    /** Provider timestamp in ISO datetime form. */
    capturedAt: string;
}

/**
 * Per-strike aggregated open interest across the call and put sides of a
 * single expiration.
 */
export interface StrikeOpenInterest {
    /** Strike price in the underlying's currency. */
    strike: number;
    /** Sum of call contracts at this strike. */
    callOpenInterest: number;
    /** Sum of put contracts at this strike. */
    putOpenInterest: number;
}

/** Per-expiration computed metrics derived from a single {@link OptionsChain}. */
export interface OptionsExpirationMetrics {
    /** Expiration date in ISO `'YYYY-MM-DD'` form. */
    expirationDate: string;
    /** Strike at which total options-writer payoff is minimized (USD). */
    maxPain: number;
    /** `sum(put OI) / sum(call OI)`. */
    putCallRatio: number;
    /** ATM IV as fraction (e.g., 0.28). null if unavailable. */
    atmImpliedVolatility: number | null;
    /** Top 3 strikes by combined OI, sorted descending. */
    topOpenInterestStrikes: ReadonlyArray<StrikeOpenInterest>;
    /** Implied move in ±% units (4.2 means ±4.2%). null if unavailable. */
    impliedMovePercent: number | null;
}

/**
 * Symbol-level aggregated metrics — the cross-expiration view consumed by
 * dashboards. `ivRank` is reserved for the historical-IV phase.
 */
export interface OptionsSymbolMetrics {
    /** Underlying ticker. */
    symbol: string;
    /** 0–100 percentile rank of ATM IV over the trailing window. Phase 1 returns null. */
    ivRank: number | null;
    /** Per-expiration metrics, ordered the same as the source snapshot. */
    perExpiration: ReadonlyArray<OptionsExpirationMetrics>;
    /** Source snapshot timestamp (ISO datetime). */
    capturedAt: string;
}

/**
 * Per-expiration AI commentary entry — the human-readable narrative for one
 * expiration produced by the analysis model.
 */
export interface OptionsPerExpirationCommentary {
    /** Expiration date this commentary refers to (ISO `'YYYY-MM-DD'`). */
    expirationDate: string;
    /** Korean-language analyst commentary for this expiration. */
    commentary: string;
    /** Tonal classification used by the UI to color-code the commentary. */
    tone: OptionsTone;
}

/** Structured AI signal — single concise trading observation. */
export interface OptionsSignal {
    /** Signal category (bullish / bearish / neutral / volatility-focused). */
    kind: OptionsSignalKind;
    /** Korean-language signal text. */
    message: string;
}

/** Normalized AI options analysis response. */
export interface OptionsAnalysisResponse {
    /** Symbol-level summary (1–2 sentences). */
    summary: string;
    /** Per-expiration breakdown. */
    perExpiration: ReadonlyArray<OptionsPerExpirationCommentary>;
    /** Structured trading signals derived from the analysis. */
    signals: ReadonlyArray<OptionsSignal>;
    /** ISO datetime when the model produced this analysis. */
    analyzedAt: string;
}

/**
 * Tone tag attached to per-expiration commentary in AI analysis output.
 *
 * Four values (one more than `Trend`/`FundamentalSentiment`/`NewsSentiment`):
 * - `bullish` — options market positioned for upside (heavy call OI, low P/C)
 * - `bearish` — options market positioned for downside (heavy put OI, high P/C)
 * - `cautious` — defensive positioning (elevated put protection without
 *   outright bearish skew). Intentionally distinct from `neutral` because
 *   options markets can show hedging activity that is not directional.
 * - `neutral` — no clear directional positioning
 */
export type OptionsTone = 'bullish' | 'bearish' | 'neutral' | 'cautious';

/** Structured signal kind emitted alongside AI commentary. */
export type OptionsSignalKind =
    | 'bullish'
    | 'bearish'
    | 'neutral'
    | 'volatility';

/** @internal Raw response shape before normalization. */
export interface RawOptionsAnalysisResponse {
    summary?: unknown;
    perExpiration?: unknown;
    signals?: unknown;
    analyzedAt?: unknown;
}

/**
 * Stable identifier for each canonical expiration chip slot. Six fixed
 * tokens used both as React-tree keys (in consumer apps) and routing-
 * friendly URL fragments.
 */
export type ExpirationSlotKey = '1W' | '2W' | '1M' | '2M' | '3M' | '6M';

/**
 * One canonical chip slot in the options expiration picker UI. The set is
 * fixed across the codebase — adding a slot here changes which chips the
 * frontend renders.
 */
export interface ExpirationSlot {
    /** Stable identifier used as a routing-friendly token. */
    key: ExpirationSlotKey;
    /** Korean label shown to users (e.g., "1개월"). */
    label: string;
    /** Minimum days from today the chosen expiration must be at least. */
    targetDays: number;
}

/** A chip slot paired with the actual provider expiration that fills it. */
export interface SlotMapping {
    /** The canonical slot this mapping satisfies. */
    slot: ExpirationSlot;
    /** Provider expiration date in ISO `'YYYY-MM-DD'` form. */
    expirationDate: string;
}
