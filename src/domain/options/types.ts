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
    /**
     * Trade volume during the current session. Non-nullable by contract —
     * provider adapters (Yahoo, etc.) must coerce missing/null feed values to
     * `0` before constructing this object. The non-null type keeps callers
     * (max-pain, OI aggregation) free of null-handling boilerplate.
     */
    volume: number;
    /**
     * Total contracts currently outstanding (not closed). Same non-nullable
     * contract as `volume` — adapters coerce null to `0`.
     */
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
    /**
     * Strike at which total options-writer payoff is minimized (USD).
     * `null` when the chain has no contracts on either side (no strikes to
     * evaluate). Never `NaN` — callers can safely `JSON.stringify` this field
     * without producing the misleading literal `null` from a `NaN` value.
     */
    maxPain: number | null;
    /**
     * `sum(put OI) / sum(call OI)`. `null` when call OI is 0 (ratio is
     * mathematically undefined) or when both sides have zero OI (nothing to
     * report). Never `+Infinity` — callers can safely `JSON.stringify` this
     * field without producing the misleading literal `null` from an
     * `Infinity` value.
     */
    putCallRatio: number | null;
    /** ATM IV as fraction (e.g., 0.28). null if unavailable. */
    atmImpliedVolatility: number | null;
    /** Top 3 strikes by combined OI, sorted descending. */
    topOpenInterestStrikes: ReadonlyArray<StrikeOpenInterest>;
    /** Implied move in ±% units (4.2 means ±4.2%). null if unavailable. */
    impliedMovePercent: number | null;
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
    /**
     * ISO datetime of the most recent normalization, taken from the server's
     * reference clock. Any LLM-supplied timestamp is intentionally discarded
     * — see {@link normalizeOptionsAnalysisResponse} for the rationale.
     */
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
 * Stable identifier for each canonical expiration chip slot. Seven fixed
 * tokens used both as React-tree keys (in consumer apps) and routing-
 * friendly URL fragments. `0D` (same-week expiration, accepting
 * expirations up to `ZERO_DTE_MAX_DAYS` days out) sits before `1W` to
 * surface end-of-week expirations on weekly tickers (e.g. PLTR Fridays)
 * that otherwise wouldn't satisfy the 1W ≥ 7-day match condition.
 */
export type ExpirationSlotKey = '0D' | '1W' | '2W' | '1M' | '2M' | '3M' | '6M';

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
    /**
     * Optional upper bound (inclusive) on days-to-expiration. When set, the
     * slot only accepts expirations within `[targetDays, maxDays]`. Used by
     * `0D` so it doesn't steal a 1W-eligible expiration; standard slots
     * (1W and onward) omit this field and behave as before.
     */
    maxDays?: number;
}

/** A chip slot paired with the actual provider expiration that fills it. */
export interface SlotMapping {
    /** The canonical slot this mapping satisfies. */
    slot: ExpirationSlot;
    /** Provider expiration date in ISO `'YYYY-MM-DD'` form. */
    expirationDate: string;
}

/**
 * Input options for `buildOptionsAnalysisPrompt`.
 *
 * Exported as part of the Tier 4 public API so consumers can type-annotate
 * inputs and adapt to schema changes without inference chains.
 */
export interface BuildOptionsAnalysisPromptOptions {
    /** Target expiration filter — see {@link OptionsExpirationFilter}. */
    expirationDate: OptionsExpirationFilter;
    /** Company display name injected into the prompt header. */
    companyName: string;
    /** Pre-fetched options snapshot passed in by the caller. */
    snapshot: OptionsSnapshot;
}

/**
 * Expiration filter accepted by options analysis use-cases. `'YYYY-MM-DD'`
 * selects a single expiration; `'all'` aggregates every expiration in the
 * snapshot.
 *
 * Uses the `(string & {}) | 'all'` pattern instead of `string | 'all'`:
 * `string & {}` is structurally identical to `string` at runtime, but it
 * survives TypeScript's literal-widening pass, so IDEs surface `'all'` as an
 * autocomplete suggestion while still accepting any `string`. See
 * MISTAKES.md TypeScript section for context.
 */
export type OptionsExpirationFilter = (string & {}) | 'all';
