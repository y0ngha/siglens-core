/** Single options contract (call or put). */
export interface OptionsContract {
    contractSymbol: string;
    strike: number;
    lastPrice: number | null;
    bid: number | null;
    ask: number | null;
    volume: number;
    openInterest: number;
    /** Fraction 0~1 (e.g., 0.25 = 25% IV). */
    impliedVolatility: number | null;
    inTheMoney: boolean;
}

/** Options chain for a single expiration. */
export interface OptionsChain {
    /** ISO date 'YYYY-MM-DD'. */
    expirationDate: string;
    /** Days to expiration, ET-midnight reference. */
    daysToExpiration: number;
    /** Sorted ascending by strike. */
    calls: ReadonlyArray<OptionsContract>;
    puts: ReadonlyArray<OptionsContract>;
}

/** Full snapshot of all chains for a symbol at one point in time. */
export interface OptionsSnapshot {
    symbol: string;
    underlyingPrice: number;
    chains: ReadonlyArray<OptionsChain>;
    /** Provider timestamp (ISO datetime). */
    capturedAt: string;
}

/** Per-expiration computed metrics. */
export interface OptionsExpirationMetrics {
    expirationDate: string;
    maxPain: number;
    /** sum(put OI) / sum(call OI). */
    putCallRatio: number;
    /** ATM IV as fraction (e.g., 0.28). null if unavailable. */
    atmImpliedVolatility: number | null;
    /** Top 3 strikes by combined OI, sorted descending. */
    topOpenInterestStrikes: ReadonlyArray<{
        strike: number;
        callOpenInterest: number;
        putOpenInterest: number;
    }>;
    /** Implied move in ±% units (4.2 means ±4.2%). null if unavailable. */
    impliedMovePercent: number | null;
}

/** Symbol-level aggregated metrics. */
export interface OptionsSymbolMetrics {
    symbol: string;
    /** Reserved for future use; Phase 1 always returns null (no historical IV). */
    ivRank: number | null;
    perExpiration: ReadonlyArray<OptionsExpirationMetrics>;
    capturedAt: string;
}

/** AI options analysis response (normalized). */
export interface OptionsAnalysisResponse {
    summary: string;
    perExpiration: ReadonlyArray<{
        expirationDate: string;
        commentary: string;
        tone: OptionsTone;
    }>;
    signals: ReadonlyArray<{
        kind: OptionsSignalKind;
        message: string;
    }>;
    /** ISO datetime when analysis was produced. */
    analyzedAt: string;
}

export type OptionsTone = 'bullish' | 'bearish' | 'neutral' | 'cautious';
export type OptionsSignalKind = 'bullish' | 'bearish' | 'neutral' | 'volatility';

/** @internal Raw response shape before normalization. */
export interface RawOptionsAnalysisResponse {
    summary?: unknown;
    perExpiration?: unknown;
    signals?: unknown;
    analyzedAt?: unknown;
}
