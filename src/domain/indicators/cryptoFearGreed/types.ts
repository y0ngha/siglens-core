import type {
    FearGreedConfidence,
    FearGreedLabel,
} from '@/domain/indicators/fearGreed/types';
import type { MarketDailyClose } from '@/domain/indicators/marketFearGreed/types';

/** One daily crypto bar. `date` is the ISO `YYYY-MM-DD` UTC day. */
export interface CryptoDailyBar {
    /** ISO `YYYY-MM-DD` UTC calendar day of the bar. */
    date: string;
    /** Close price; only relative changes are used. */
    close: number;
    /**
     * Quote volume, in one currency common to every series (e.g. USD). Only
     * ratios of summed volume are used, so the unit itself does not matter —
     * but mixing units across coins would skew the volume-flow factor.
     */
    volume: number;
}

/**
 * Raw input for the crypto-market Fear & Greed index. Series need not be
 * sorted, deduplicated, or date-aligned: the benchmark and every universe coin
 * are inner-joined on `date` (a 7-day calendar), and the safe-haven series is
 * forward-filled onto the resulting sessions.
 */
export interface CryptoFearGreedInput {
    /**
     * Benchmark coin (BTC). Drives momentum, downside volatility, safe-haven,
     * alt-season, and the up/down classification behind volume flow.
     */
    benchmark: CryptoDailyBar[];
    /**
     * Safe-haven asset closes (gold). Trades five days a week, so it is
     * forward-filled onto the crypto calendar; sessions before its first
     * observation are dropped.
     */
    safeHaven: MarketDailyClose[];
    /**
     * Other large coins, keyed by any id the consumer chooses — core never sees
     * tickers. Fewer than `CRYPTO_FEAR_GREED_MIN_UNIVERSE` coins makes breadth
     * and alt-season meaningless, and the index returns `null`.
     */
    universe: Record<string, CryptoDailyBar[]>;
}

/**
 * Discriminator for the six factors that compose the crypto-market score.
 * Every factor is oriented so a larger raw value means *greedier*.
 */
export type CryptoFearGreedFactorKey =
    /** Benchmark distance from its 125-session moving average. */
    | 'momentum'
    /** Negated 30-session downside semi-deviation of benchmark log returns. */
    | 'downside_volatility'
    /** 20-session benchmark return minus 20-session safe-haven return. */
    | 'safe_haven'
    /** Share of coins (benchmark included) closing above their own 50-session MA. */
    | 'breadth'
    /** Share of universe coins beating the benchmark over 90 sessions. */
    | 'alt_season'
    /** Share of 30-session total quote volume traded on benchmark up-days. */
    | 'volume_flow';

/** Every {@link CryptoFearGreedFactorKey}, in display order. */
export const CRYPTO_FEAR_GREED_FACTOR_KEYS = [
    'momentum',
    'downside_volatility',
    'safe_haven',
    'breadth',
    'alt_season',
    'volume_flow',
] as const satisfies readonly CryptoFearGreedFactorKey[];

/** A single factor's raw value and its walk-forward percentile rank. */
export interface CryptoFearGreedFactor {
    /** Discriminator identifying which factor this entry represents. */
    key: CryptoFearGreedFactorKey;
    /**
     * Pre-percentile raw value, oriented so that a larger value means
     * *greedier* — `downside_volatility` is therefore ≤ 0.
     */
    rawValue: number;
    /** Percentile rank in [0, 100]; the GREED side maps to 100. */
    percentile: number;
}

/**
 * Latest-session crypto-market Fear & Greed snapshot. Shares its scale, labels,
 * and confidence vocabulary with `MarketFearGreedSnapshot` so the indices can
 * be shown side by side.
 */
export interface CryptoFearGreedSnapshot {
    /** Composite score in [0, 100] — equal-weight average of the six factor percentiles. */
    score: number;
    /** Five-stage label derived from `score`. */
    label: FearGreedLabel;
    /** Per-factor breakdown, in {@link CRYPTO_FEAR_GREED_FACTOR_KEYS} order. */
    factors: CryptoFearGreedFactor[];
    /** `'normal'` when the walk-forward sample is ≥ 60 sessions, else `'limited'`. */
    confidence: Exclude<FearGreedConfidence, 'insufficient'>;
    /** Number of valid prior factor samples used to compute percentiles. */
    sampleSize: number;
    /** ISO `YYYY-MM-DD` date of the session the snapshot describes. */
    asOf: string;
}

/** @internal Raw factor bundle, keyed by factor key. */
export type CryptoFactorValues = Record<CryptoFearGreedFactorKey, number>;

/** @internal Date-aligned series, produced by `alignCryptoSeries`. */
export interface AlignedCryptoSeries {
    /** ISO dates in ascending order, common to the benchmark and every universe coin. */
    dates: string[];
    /** Benchmark closes, index-aligned to `dates`. */
    benchmark: number[];
    /** Safe-haven closes, forward-filled onto `dates`. */
    safeHaven: number[];
    /** One close array per universe coin, each index-aligned to `dates`. */
    universe: number[][];
    /** Benchmark plus universe quote volume per session, index-aligned to `dates`. */
    totalVolume: number[];
}
