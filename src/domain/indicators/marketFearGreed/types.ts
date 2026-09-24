import type {
    FearGreedConfidence,
    FearGreedLabel,
} from '@/domain/indicators/fearGreed/types';

/**
 * Semantic identifiers for the six daily close series the market-wide Fear &
 * Greed index consumes. Keys are intentionally *semantic* rather than ticker
 * symbols: core owns the contract, the consumer owns the data source. A
 * consumer backed by FMP maps `sp500 → SPY`, `vix → ^VIX`, and so on; a
 * consumer backed by another provider is free to map differently as long as
 * the economic meaning holds.
 */
export type MarketFearGreedSeriesKey =
    /** Broad US large-cap equity benchmark (cap-weighted). */
    | 'sp500'
    /** CBOE volatility index. */
    | 'vix'
    /** Long-duration US treasury proxy — the safe-haven leg. */
    | 'longTreasury'
    /** High-yield ("junk") corporate bond proxy. */
    | 'highYield'
    /** Investment-grade corporate bond proxy. */
    | 'investmentGrade'
    /** Equal-weight version of the large-cap benchmark — the breadth leg. */
    | 'equalWeight';

/** Every {@link MarketFearGreedSeriesKey}, in a stable order for iteration. */
export const MARKET_FEAR_GREED_SERIES_KEYS = [
    'sp500',
    'vix',
    'longTreasury',
    'highYield',
    'investmentGrade',
    'equalWeight',
] as const satisfies readonly MarketFearGreedSeriesKey[];

/** One daily close observation. `date` is an ISO `YYYY-MM-DD` calendar date. */
export interface MarketDailyClose {
    /** ISO `YYYY-MM-DD` calendar date of the close. */
    date: string;
    /** Adjusted or raw close price; only relative changes are used. */
    close: number;
}

/**
 * Raw input: one daily close series per semantic key. Series need not be
 * sorted, deduplicated, or date-aligned — `computeMarketFearGreed*` performs an
 * inner join on `date` across all six series before computing anything, so a
 * holiday that only one venue observes simply drops out.
 */
export type MarketFearGreedInput = Record<
    MarketFearGreedSeriesKey,
    MarketDailyClose[]
>;

/**
 * Discriminator for the five factors that compose the market-wide score. Each
 * mirrors one of CNN's Fear & Greed inputs that is derivable from daily closes
 * alone — put/call ratio, NYSE 52-week high/low counts, and the McClellan
 * summation index have no daily-close equivalent and are deliberately omitted.
 */
export type MarketFearGreedFactorKey =
    /** S&P 500 distance from its 125-day moving average. */
    | 'momentum'
    /** VIX distance from its 50-day moving average, sign-inverted. */
    | 'volatility'
    /** 20-day equity return minus 20-day long-treasury return. */
    | 'safe_haven'
    /** 20-day high-yield return minus 20-day investment-grade return. */
    | 'junk_bond'
    /** 20-day equal-weight return minus 20-day cap-weight return. */
    | 'breadth';

/** Every {@link MarketFearGreedFactorKey}, in display order. */
export const MARKET_FEAR_GREED_FACTOR_KEYS = [
    'momentum',
    'volatility',
    'safe_haven',
    'junk_bond',
    'breadth',
] as const satisfies readonly MarketFearGreedFactorKey[];

/** A single factor's raw value and its walk-forward percentile rank. */
export interface MarketFearGreedFactor {
    /** Discriminator identifying which factor this entry represents. */
    key: MarketFearGreedFactorKey;
    /**
     * Pre-percentile raw value. Every factor is oriented so that a larger value
     * means *greedier* — `volatility` is therefore already sign-inverted.
     */
    rawValue: number;
    /** Percentile rank in [0, 100]; the GREED side maps to 100. */
    percentile: number;
}

/**
 * Latest-session market-wide Fear & Greed snapshot. `confidence` excludes
 * `'insufficient'` because the public API returns `null` rather than a snapshot
 * when the walk-forward sample is below the LIMITED threshold.
 */
export interface MarketFearGreedSnapshot {
    /** Composite score in [0, 100] — equal-weight average of the five factor percentiles. */
    score: number;
    /** Five-stage label derived from `score`, shared with the per-stock index. */
    label: FearGreedLabel;
    /** Per-factor breakdown, in {@link MARKET_FEAR_GREED_FACTOR_KEYS} order. */
    factors: MarketFearGreedFactor[];
    /**
     * `'normal'` when the walk-forward sample is ≥ 60 sessions, else
     * `'limited'`. Narrowed the same way as {@link FearGreedSnapshot.confidence}
     * so the two indices share one confidence vocabulary in the UI.
     */
    confidence: Exclude<FearGreedConfidence, 'insufficient'>;
    /** Number of valid prior factor samples used to compute percentiles. */
    sampleSize: number;
    /** ISO `YYYY-MM-DD` date of the session the snapshot describes. */
    asOf: string;
}

/** A single point in a walk-forward market Fear & Greed history series. */
export interface MarketFearGreedHistoryPoint {
    /** ISO `YYYY-MM-DD` calendar date of the session. */
    date: string;
    /** Score in [0, 100], or `null` during warm-up / insufficient sample. */
    score: number | null;
    /** Label derived from `score`, or `null` when `score` is `null`. */
    label: FearGreedLabel | null;
}

/** @internal Raw factor bundle, keyed by factor key, shared by the factor and walk-forward modules. */
export type MarketFactorValues = Record<MarketFearGreedFactorKey, number>;

/** @internal Date-aligned close series, produced by the inner join in `align.ts`. */
export interface AlignedMarketSeries {
    /** ISO dates in ascending order, common to all six series. */
    dates: string[];
    /** Close arrays, each the same length as `dates` and index-aligned to it. */
    closes: Record<MarketFearGreedSeriesKey, number[]>;
}
