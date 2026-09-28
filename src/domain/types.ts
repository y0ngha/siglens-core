import type { OptionsAnalysisResponse } from './options/types';

/** Bar resolution literal accepted by the market data providers and indicator pipeline. */
export type Timeframe = '5Min' | '15Min' | '30Min' | '1Hour' | '4Hour' | '1Day';

/** U.S. regular-session state — weekend, regular-session-open, or weekday-closed. */
export type EtSessionStatus = 'weekend' | 'open' | 'closed';

/**
 * Generic market-session state alias for the spec-driven session helpers
 * ({@link getSessionStatus}, {@link isRegularSessionOpen}).
 *
 * Identical to {@link EtSessionStatus} at the type level — introduced as a
 * forward-compatible alias so callers of the generic helpers can annotate with
 * the semantically neutral name without a breaking rename of `EtSessionStatus`.
 * Both names remain valid; `EtSessionStatus` is kept for backward compatibility.
 *
 * @see {@link EtSessionStatus} for the underlying union (`'weekend' | 'open' | 'closed'`).
 */
export type MarketSessionStatus = EtSessionStatus;

/** Top-level asset class. Controls prompt framing across the analysis and chat layers. */
export type AssetClass = 'equity' | 'crypto';

/**
 * Currency used to render prices in generated prose.
 *
 * Core never infers this from the symbol. That `005930.KS` is quoted in won is
 * a market-profile fact, not analysis-domain knowledge, and the exchange
 * catalog lives in the consumer (siglens `shared/config/marketProfile`) — so
 * the currency is *supplied*, never derived. Callers that omit it get `'USD'`,
 * byte-for-byte the output produced before this type existed.
 */
export type CurrencyCode = 'USD' | 'KRW';

/**
 * Coarse unrealized profit/loss band for a member's holding in a symbol
 * (personalized-analysis-by-position-bucket spec, Subsystem C).
 *
 * Deliberately a 5-level qualitative band — not a raw return percentage or
 * average price — so the value is safe to fold into the shared analysis
 * cache key and prompt without leaking a per-member number: members in the
 * same band share both the cache entry and the prompt hint. See
 * {@link bucketizePosition} (pure derivation) and `positionKeySuffix` /
 * `buildAnalysisCacheKey` (cache-key composition) in `infrastructure/cache/config.ts`.
 */
export type PositionBucket =
    'deep-profit' | 'profit' | 'near-breakeven' | 'loss' | 'deep-loss';

/**
 * Declarative trading-session schedule. `always-open` = 24/7 (crypto);
 * `scheduled` = a regional regular session (US ET today, KST later).
 * Pure data so callers can branch without per-market code.
 *
 * DST is handled automatically by `Intl.DateTimeFormat` with the IANA
 * `timeZone` — no `dst` field is needed on the spec.
 */
export type MarketSessionSpec =
    | { kind: 'always-open' }
    | {
          kind: 'scheduled';
          /** IANA timezone, e.g. `'America/New_York'`. */
          timeZone: string;
          /** Open time in minutes from local midnight (inclusive), e.g. 570 for 09:30. */
          openMinute: number;
          /** Close time in minutes from local midnight (exclusive), e.g. 960 for 16:00. */
          closeMinute: number;
          /** Local weekday indexes treated as weekend (0 = Sun … 6 = Sat). */
          weekendDays: readonly number[];
          /**
           * Optional exchange calendar: per-day close override.
           *
           * Returns the close minute for the local calendar day containing the
           * instant, or `0` when the exchange is closed that day (a holiday).
           * Omit it and the session is a pure weekday schedule — which is what
           * NYSE specs used to be, and why a half day read as open for the three
           * hours after the 13:00 bell.
           */
          closeMinuteFor?: (now: Date) => number;
      };

/** Definition of a market index tracked by the dashboard. */
export interface IndexTicker {
    symbol: string;
    fmpSymbol: string;
    displayName: string;
    koreanName: string;
}

/** Definition of a sector ETF tracked by the dashboard. */
export interface SectorEtf {
    symbol: string;
    sectorName: string;
    koreanName: string;
}

/** Real-time quote returned by the market data provider. */
export interface MarketQuote {
    /** Provider symbol (FMP-style; matches the request symbol). */
    symbol: string;
    /** Last traded price. */
    price: number;
    /** Day-over-day change as a percentage (e.g. `1.23` for +1.23%). */
    changesPercentage: number;
    /** Display name returned by the provider. */
    name: string;
    /**
     * Unix seconds of the provider's quote time, when it reports one (spec
     * 2026-09-18) — used to compute an `asOf` freshness label for the quote.
     * Optional and additive: a provider adapter that does not carry a
     * timestamp through simply omits it.
     */
    timestamp?: number;
}

/** Quote-enriched index entry used by the dashboard summary. */
export interface MarketIndexData {
    /** Canonical ticker (e.g. `"SPY"`). */
    symbol: string;
    /** FMP symbol used by the provider (e.g. `"^GSPC"` for S&P 500). */
    fmpSymbol: string;
    /** English display name. */
    displayName: string;
    /** Korean display name. */
    koreanName: string;
    /** Last traded price; `0` if the quote could not be fetched. */
    price: number;
    /** Day-over-day percent change; `0` if the quote could not be fetched. */
    changesPercentage: number;
}

/** Quote-enriched sector ETF entry used by the dashboard summary. */
export interface MarketSectorData {
    /** Sector ETF ticker (e.g. `"XLK"`). */
    symbol: string;
    /** English sector name. */
    sectorName: string;
    /** Korean sector name. */
    koreanName: string;
    /** Last traded price; `0` if the quote could not be fetched. */
    price: number;
    /** Day-over-day percent change; `0` if the quote could not be fetched. */
    changesPercentage: number;
}

/** Combined indices + sector ETFs view used by the dashboard summary endpoint. */
export interface MarketSummaryData {
    /** Quoted market indices (S&P, Nasdaq, etc.). */
    indices: MarketIndexData[];
    /** Quoted sector ETFs (XLK, XLF, XLE, ...). */
    sectors: MarketSectorData[];
}

/**
 * Sector ranking + descriptive commentary fragment of a market briefing.
 */
export interface MarketBriefingSectorAnalysis {
    /**
     * Leading sector **display names** (Korean), ordered by relative strength.
     *
     * The prompt requires these to be copied verbatim from the sector rows it
     * was given, so they are always names the caller actually passed in — not
     * tickers, and never a sector from another market. Display-only: nothing
     * keys off these strings.
     */
    leadingSectors: string[];
    /** Lagging sector display names, ordered by relative weakness. Same rule. */
    laggingSectors: string[];
    /** Korean prose describing the rotation between leaders and laggards. */
    performanceDescription: string;
}

/**
 * Volatility (VIX) commentary fragment of a market briefing.
 */
export interface MarketBriefingVolatilityAnalysis {
    /** Last VIX level; `undefined` when the value could not be parsed. */
    vixLevel?: number;
    /** Korean prose interpreting the VIX level. */
    description: string;
}

/**
 * Which market a briefing describes, plus the volatility reading (if any) the
 * caller can supply for it.
 *
 * **Why the caller owns this.** This library knows economic roles, not
 * exchanges: it has no idea whether the rows it was handed are S&P sectors or
 * KOSPI sectors, and no idea whether a volatility index exists for them. Before
 * this type existed the prompt hardcoded US framing — a `'XLK'` ticker example
 * and a mandatory "VIX 지수 값" field — so a Korean summary came back with US
 * tickers and an invented VIX number. The model was doing what it was asked:
 * the schema demanded a field the input never contained.
 *
 * `volatility: null` removes the volatility block from the prompt entirely
 * rather than asking for a value nobody supplied.
 */
export interface MarketBriefingContext {
    /** Market name for the prompt framing, e.g. `'미국 증시'`, `'한국 증시'`. */
    marketLabel: string;
    /**
     * The market's volatility index reading, or `null` when it has none the
     * caller can source. Never ask the model to produce this number — it is
     * given, not inferred.
     */
    volatility: { label: string; level: number } | null;
}

/** Normalized AI market briefing. Always present in `done` poll outcomes. */
export interface MarketBriefingResponse {
    /** One-sentence Korean overall-market summary. */
    summary: string;
    /** Headline themes driving the day's price action. */
    dominantThemes: string[];
    /** Sector leaders/laggards and a short narrative. */
    sectorAnalysis: MarketBriefingSectorAnalysis;
    /**
     * Volatility level + commentary.
     *
     * When the caller passed {@link MarketBriefingContext.volatility} as `null`
     * — the market has no volatility index to source — the prompt omits the key
     * entirely and this normalizes to `{ vixLevel: undefined, description: '' }`.
     * That is indistinguishable from "the model returned nothing", so a consumer
     * that wants to explain *why* the section is empty must look at the context
     * it supplied, not at this field.
     */
    volatilityAnalysis: MarketBriefingVolatilityAnalysis;
    /** Risk-on / risk-off / neutral verdict in Korean. */
    riskSentiment: string;
}

/** Outcome of {@link submitBriefing}: cached result or a `jobId` to poll. */
export type SubmitBriefingResult =
    | {
          status: 'cached';
          briefing: MarketBriefingResponse;
          generatedAt: string;
      }
    | { status: 'submitted'; jobId: string };

/** Outcome of {@link pollBriefing}: still processing, finished, or errored. */
export type PollBriefingResult =
    | { status: 'processing' }
    | { status: 'done'; briefing: MarketBriefingResponse; generatedAt: string }
    | { status: 'error'; error: string };

/**
 * Definition of a sector grouping (label + member symbols).
 */
export interface SectorGroupDef {
    /** Human-readable sector label (e.g. `"Technology"`). */
    label: string;
    /** Constituent ticker symbols belonging to this sector group. */
    symbols: readonly string[];
}

/** OHLCV price bar — the canonical input for every indicator and signal. */
export interface Bar {
    /** Unix timestamp (seconds since epoch). */
    time: number;
    /** Open price. */
    open: number;
    /** High price. */
    high: number;
    /** Low price. */
    low: number;
    /** Close price. */
    close: number;
    /** Trading volume for the bar. */
    volume: number;
    /** Volume-weighted average price; provided by Alpaca only. */
    vwap?: number;
}

/**
 * Per-bar MACD output: line, signal, histogram. `null` during the warm-up window.
 */
export interface MACDResult {
    macd: number | null;
    signal: number | null;
    histogram: number | null;
}

/**
 * Per-bar Bollinger Band output: upper / middle / lower. `null` during the warm-up window.
 */
export interface BollingerResult {
    upper: number | null;
    middle: number | null;
    lower: number | null;
}

/**
 * Per-bar DMI output: +DI, -DI, ADX. `null` during the warm-up window.
 */
export interface DMIResult {
    diPlus: number | null;
    diMinus: number | null;
    adx: number | null;
}

/**
 * Per-bar Stochastic output: %K, %D. `null` during the warm-up window.
 */
export interface StochasticResult {
    percentK: number | null;
    percentD: number | null;
}

/**
 * Result of `calculateStochRSI`. `null` during the warm-up window.
 */
export interface StochRSIResult {
    k: number | null;
    d: number | null;
}

/**
 * Single price-level row of a volume profile histogram.
 */
export interface VolumeProfileRow {
    price: number;
    volume: number;
}

/**
 * Result of `calculateVolumeProfile`: POC + value-area boundaries + histogram.
 */
export interface VolumeProfileResult {
    /** Point of Control — price level with the largest traded volume. */
    poc: number;
    /** Value-Area High — upper boundary of the value area. */
    vah: number;
    /** Value-Area Low — lower boundary of the value area. */
    val: number;
    /** Per-price-level volume distribution. */
    profile: VolumeProfileRow[];
}

/**
 * Result of `calculateIchimoku`. `null` during the warm-up window.
 */
export interface IchimokuResult {
    tenkan: number | null;
    kijun: number | null;
    senkouA: number | null;
    senkouB: number | null;
    chikou: number | null;
}

/** Forward-projected Ichimoku cloud point used for chart rendering. */
export interface IchimokuFuturePoint {
    senkouA: number | null;
    senkouB: number | null;
}

/**
 * Direction of price movement (up / down).
 */
export type PriceTrend = 'up' | 'down';

/**
 * Indicator trend direction; `null` indicates "not yet determined".
 */
export type TrendDirection = PriceTrend | null;

/**
 * Result of `calculateParabolicSAR`. `null` during the warm-up window.
 */
export interface ParabolicSARResult {
    sar: number | null;
    trend: TrendDirection;
}

/**
 * Result of `calculateSupertrend`. `null` during the warm-up window.
 */
export interface SupertrendResult {
    supertrend: number | null;
    trend: TrendDirection;
}

/**
 * Result of `calculateKeltnerChannel`. `null` during the warm-up window.
 */
export interface KeltnerChannelResult {
    upper: number | null;
    middle: number | null;
    lower: number | null;
}

/**
 * Result of `calculateDonchianChannel`. `null` during the warm-up window.
 */
export interface DonchianChannelResult {
    upper: number | null;
    middle: number | null;
    lower: number | null;
}

/** Buy-side and sell-side volume split for a single bar. */
export interface BuySellVolumeResult {
    buyVolume: number;
    sellVolume: number;
}

export type {
    FearGreedLabel,
    FearGreedConfidence,
    FearGreedWarning,
    FearGreedFactorKey,
    FearGreedGroupName,
    FearGreedFactor,
    FearGreedGroup,
    FearGreedSnapshot,
    FearGreedHistoryPoint,
    ComputeFearGreedOptions,
} from '@/domain/indicators/fearGreed/types';

export type {
    MarketFearGreedSeriesKey,
    MarketFearGreedFactorKey,
    MarketDailyClose,
    MarketFearGreedInput,
    MarketFearGreedFactor,
    MarketFearGreedSnapshot,
    MarketFearGreedHistoryPoint,
} from '@/domain/indicators/marketFearGreed/types';

export type {
    CryptoDailyBar,
    CryptoFearGreedInput,
    CryptoFearGreedFactorKey,
    CryptoFearGreedFactor,
    CryptoFearGreedSnapshot,
} from '@/domain/indicators/cryptoFearGreed/types';

// ─── Smart Money Concepts ────────────────────────────────────────────────────
// Concept reference: Smart Money Concepts (SMC) / ICT methodology
// Original TradingView indicator: "Smart Money Concepts [LuxAlgo]" by LuxAlgo
// This is an independent TypeScript implementation based on publicly documented
// SMC trading concepts. Not a port of LuxAlgo's PineScript source code.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Direction of an SMC structure break or order block.
 */
export type SMCStructureDirection = 'bullish' | 'bearish';
/**
 * SMC structure break type: BOS = Break of Structure; CHoCH = Change of Character.
 */
export type SMCBreakType = 'bos' | 'choch';
/**
 * Whether an SMC swing point is a high or a low.
 */
export type SMCSwingPointType = 'high' | 'low';
/**
 * SMC zone classification.
 */
export type SMCZoneType = 'premium' | 'discount' | 'equilibrium';

/**
 * A detected swing high or swing low used by SMC structure analysis.
 */
export interface SMCSwingPoint {
    index: number;
    price: number;
    type: SMCSwingPointType;
}

/**
 * A detected order block. `isMitigated` flips when price returns through it.
 */
export interface SMCOrderBlock {
    startIndex: number;
    high: number;
    low: number;
    type: SMCStructureDirection;
    isMitigated: boolean;
}

/**
 * A detected fair-value gap. `isMitigated` flips when price fills the gap.
 */
export interface SMCFairValueGap {
    index: number;
    high: number;
    low: number;
    type: SMCStructureDirection;
    isMitigated: boolean;
}

/**
 * A clustered equal-level liquidity zone (equal highs / equal lows) — a price
 * level revisited by ≥2 swing points within an ATR threshold.
 *
 * `firstIndex`/`secondIndex` span the cluster: the first-touch and the
 * most-recent-touch swing indices (firstIndex < secondIndex). `price` is the
 * average price of the swings in the cluster.
 */
export interface SMCEqualLevel {
    /** Average price of the swings in the cluster. */
    price: number;
    /** Index of the first (oldest) swing that touched the level. */
    firstIndex: number;
    /** Index of the most-recent swing that touched the level. */
    secondIndex: number;
}

/**
 * A premium / discount / equilibrium price band on the chart.
 */
export interface SMCZone {
    high: number;
    low: number;
    type: SMCZoneType;
}

/**
 * A structure break event (BOS or CHoCH) at a specific bar/price.
 */
export interface SMCStructureBreak {
    index: number;
    price: number;
    type: SMCStructureDirection;
    breakType: SMCBreakType;
}

/**
 * Aggregated SMC analysis output produced by `calculateSmc`.
 */
export interface SMCResult {
    swingHighs: SMCSwingPoint[];
    swingLows: SMCSwingPoint[];
    orderBlocks: SMCOrderBlock[];
    fairValueGaps: SMCFairValueGap[];
    equalHighs: SMCEqualLevel[];
    equalLows: SMCEqualLevel[];
    premiumZone: SMCZone | null;
    discountZone: SMCZone | null;
    equilibriumZone: SMCZone | null;
    structureBreaks: SMCStructureBreak[];
}

// ─── Squeeze Momentum Indicator ─────────────────────────────────────────────
// Original concept: "Squeeze Momentum Indicator [LazyBear]" by LazyBear
// PineScript source: https://www.tradingview.com/v/4IneGo8h/
// This is an independent TypeScript implementation based on the publicly
// documented algorithm. Not a direct port of the PineScript source code.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of `calculateSqueezeMomentum` for a single bar.
 */
export interface SqueezeMomentumResult {
    /** Momentum value from linear regression. Positive = bullish, negative = bearish. */
    momentum: number | null;
    /** BB is inside KC — volatility compressed, breakout imminent */
    sqzOn: boolean | null;
    /** BB is outside KC — squeeze released, momentum expanding */
    sqzOff: boolean | null;
    /** Neither sqzOn nor sqzOff — transitional state */
    noSqz: boolean | null;
    /** momentum is increasing vs previous bar (momentum strengthening) */
    increasing: boolean | null;
}

/**
 * Aggregate of every indicator computed for a series of bars.
 *
 * Returned by {@link calculateIndicators}. Each array-typed field is aligned
 * with the input `bars` (one entry per bar; warm-up entries are `null`).
 * Object-typed fields like `volumeProfile` and `smc` summarize the entire
 * series.
 */
export interface IndicatorResult {
    /** MACD line / signal line / histogram per bar. */
    macd: MACDResult[];
    /** Bollinger Band upper / middle / lower per bar. */
    bollinger: BollingerResult[];
    /** DMI +DI / -DI / ADX per bar. */
    dmi: DMIResult[];
    /** Stochastic %K / %D per bar. */
    stochastic: StochasticResult[];
    /** Stochastic-RSI K / D per bar. */
    stochRsi: StochRSIResult[];
    /** RSI value per bar. */
    rsi: (number | null)[];
    /** CCI value per bar. */
    cci: (number | null)[];
    /** VWAP per bar. */
    vwap: (number | null)[];
    /** Simple moving averages keyed by period (e.g. `ma[20]`, `ma[50]`). */
    ma: Record<number, (number | null)[]>;
    /** Exponential moving averages keyed by period. */
    ema: Record<number, (number | null)[]>;
    /** Aggregate volume-profile snapshot for the full bar series. */
    volumeProfile: VolumeProfileResult | null;
    /** Ichimoku components per bar. */
    ichimoku: IchimokuResult[];
    /** Average True Range per bar. */
    atr: (number | null)[];
    /** On-Balance Volume per bar. */
    obv: (number | null)[];
    /** Parabolic SAR per bar. */
    parabolicSar: ParabolicSARResult[];
    /** Williams %R per bar. */
    williamsR: (number | null)[];
    /** Supertrend value + direction per bar. */
    supertrend: SupertrendResult[];
    /** Money Flow Index per bar. */
    mfi: (number | null)[];
    /** Keltner Channel upper / middle / lower per bar. */
    keltnerChannel: KeltnerChannelResult[];
    /** Chaikin Money Flow per bar. */
    cmf: (number | null)[];
    /** Donchian Channel upper / middle / lower per bar. */
    donchianChannel: DonchianChannelResult[];
    /** Estimated buy/sell volume split per bar. */
    buySellVolume: BuySellVolumeResult[];
    /** Smart Money Concepts analysis for the full series. */
    smc: SMCResult;
    /** Squeeze Momentum indicator per bar. */
    squeezeMomentum: SqueezeMomentumResult[];
    /** MACD-V (volatility-normalized MACD) per bar. */
    macdV: (number | null)[];
    /** Connors RSI composite per bar. */
    connorsRsi: (number | null)[];
    /** Elder Force Index (EMA-smoothed) per bar. */
    forceIndex: (number | null)[];
    /** Elder-Ray bull/bear power per bar. */
    elderRay: ElderRayResult[];
    /** Elder Impulse System color per bar. */
    elderImpulse: (ImpulseColor | null)[];
    /** Bollinger %B + BandWidth per bar. */
    bollingerDerived: BollingerDerivedResult[];
    /** Chandelier Exit stops + trend per bar. */
    chandelierExit: ChandelierResult[];
    /** Yang-Zhang volatility per bar. */
    yangZhang: (number | null)[];
    /** EWMA (RiskMetrics) volatility per bar. */
    ewmaVolatility: (number | null)[];
    /** Hurst exponent (rolling R/S) per bar. */
    hurst: (number | null)[];
    /** Variance ratio (rolling) per bar. */
    varianceRatio: (number | null)[];
    /** Rolling linear-regression result (slope/r²) per bar. */
    regression: RegressionResult[];
}

// ─── Pro Indicators Phase 1 ──────────────────────────────────────────────────

/**
 * Bull Power / Bear Power output from Elder-Ray.
 * `null` during the EMA warm-up window.
 */
export interface ElderRayResult {
    /** Maximum buyer strength: High − EMA(13); positive when buyers dominate. */
    bullPower: number | null;
    /** Maximum seller strength: Low − EMA(13); negative when sellers dominate. */
    bearPower: number | null;
}

/**
 * Elder Impulse System bar color.
 * `green` = EMA rising AND MACD histogram rising (bullish momentum).
 * `red`   = EMA falling AND MACD histogram falling (bearish momentum).
 * `blue`  = mixed signals (neutral / transitional).
 */
export type ImpulseColor = 'green' | 'red' | 'blue';

/**
 * Chandelier Exit position side: holding a long or short position.
 */
export type ChandelierTrend = 'long' | 'short';

/**
 * Per-bar Bollinger %B and BandWidth derived values.
 * `null` during the Bollinger warm-up window or when the band is degenerate
 * (zero-width → pctB undefined; zero middle → bandwidth undefined).
 */
export interface BollingerDerivedResult {
    /** (close − lower) / (upper − lower); null when band width = 0. */
    pctB: number | null;
    /** (upper − lower) / middle; null when middle = 0 or band is null. */
    bandwidth: number | null;
}

/**
 * Chandelier Exit stop levels and trend direction.
 * `null` during the ATR / sliding-window warm-up window.
 */
export interface ChandelierResult {
    /** Trailing stop for a long position: highest-high − ATR × multiplier. */
    longStop: number | null;
    /** Trailing stop for a short position: lowest-low + ATR × multiplier. */
    shortStop: number | null;
    /** Current trend side determined by the Chandelier state machine. */
    trend: ChandelierTrend | null;
}

/**
 * Per-bar linear-regression (OLS) fit over the trailing window.
 * `null` during the warm-up window; `r2` is `null` when the series is flat
 * (SS_tot = 0 → coefficient of determination undefined).
 */
export interface RegressionResult {
    /** OLS slope of close vs bar index [0..period-1]. */
    slope: number | null;
    /** Coefficient of determination (1 − SS_res/SS_tot); null when SS_tot = 0. */
    r2: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * How a chart-display directive should render (line / marker / region).
 */
export type ChartDisplayType = 'line' | 'marker' | 'region';

/** Skill category — drives ordering and grouping in prompts. */
export type SkillCategory =
    | 'reversal_bullish'
    | 'reversal_bearish'
    | 'continuation_bullish'
    | 'continuation_bearish'
    | 'neutral'
    | 'fundamental'
    | 'news'
    | 'congress';

/** Chart-rendering directive carried by a skill (color, label, style). */
export interface SkillChartDisplay {
    show: boolean;
    type: ChartDisplayType;
    color: string;
    label: string;
}

/** Skill display configuration; currently only carries the chart directive. */
export interface SkillDisplay {
    chart: SkillChartDisplay;
}

/** Skill type — determines which prompt section the skill is injected into. */
export type SkillType =
    | 'pattern'
    | 'indicator_guide'
    | 'strategy'
    | 'candlestick'
    | 'support_resistance';

/**
 * Usage role of an `indicator_guide` skill — what analytical job the indicator
 * performs. Decoupled from `confidenceWeight` (which is *how much* to trust the
 * interpretation, not *what kind* of interpretation). Canonical order:
 * signal → confirmation → regime → measurement → risk.
 */
export type SkillUsageRole =
    'signal' | 'confirmation' | 'regime' | 'measurement' | 'risk';

/** A single skill loaded from `skills/*.md` and consumed by the prompt builders. */
export interface Skill {
    name: string;
    description: string;
    type?: SkillType;
    category?: SkillCategory;
    pattern?: string;
    indicators: string[];
    confidenceWeight: number;
    content: string;
    display?: SkillDisplay;
    /**
     * Dynamic-gating metadata parsed from the skill's frontmatter. When absent,
     * the skill is treated as untagged and the skill selector throws
     * (fail-closed) when the skill passes the prompt-context whitelist — every
     * shipped skill must carry an explicit gating block.
     */
    gating?: SkillGating;
    /**
     * Build-time precomputed token count of the skill body. Tokenizers are I/O
     * and therefore forbidden in the domain layer, so this value is baked into
     * the frontmatter by a build script and read here as plain metadata.
     */
    tokenCost?: number;
    /**
     * Marks the single Smart Money Concepts full-guide skill. Set from the
     * `smc_full_guide: true` frontmatter flag (snake_case, repo convention).
     * The prompt builder buckets this skill specially (replaced by a compressed
     * concept note), so identifying it by an explicit flag rather than by
     * display name keeps the routing stable if the skill is renamed.
     */
    smcFullGuide?: boolean;
    /**
     * Usage roles for `indicator_guide` skills (e.g. `[signal, confirmation]`).
     * Optional in the public type for compatibility with external/older
     * catalogs; the siglens catalog validator enforces it as required on
     * `indicator_guide`. Stored in canonical order; the loader normalizes
     * invalid/missing values to `undefined` (fail-safe).
     */
    usageRoles?: SkillUsageRole[];
}

/**
 * @internal
 * Which gating path a gated {@link SkillGating} entry uses.
 *
 * - `'event'` — gate on transient `detectSignals` events (cross / flip /
 *   breakout) via the variant's `triggers` list.
 * - `'state'` — gate on a persistent textbook condition (overbought, band
 *   proximity, …) via the variant's `state` predicate.
 *
 * Not part of the public API: `SkillGating` discriminates on inline
 * `signalKind` literals, so this type is referenced only by the loader's
 * frontmatter validation, never by the public transitive closure.
 */
export type SignalKind = 'event' | 'state';

/**
 * Indicator feature a state predicate inspects. Each maps to a field of
 * {@link IndicatorResult} that the `detectSignals` catalog under-covers, so it
 * is gated on a textbook *state* threshold rather than a discrete event.
 */
export type SkillStateFeature =
    | 'bollinger'
    | 'keltner'
    | 'williamsR'
    | 'stochastic'
    | 'stochRsi'
    | 'donchian'
    | 'vwap'
    | 'buySellVolume'
    // ── Pro-indicators Phase 3 (advisory / regime / volatility) ──────────────
    // All gated on `predicate: 'level'`. "Level" here is generalized beyond a
    // raw oscillator bound: each feature's evaluator decides what "notable" means
    // (extreme reading, sign/colour/trend flip, or a vol-regime extreme) — see
    // `skillGatingPredicates.ts`. Bollinger %B is event-gated separately, not here.
    | 'macdV'
    | 'connorsRsi'
    | 'forceIndex'
    | 'elderRay'
    | 'elderImpulse'
    | 'chandelier'
    | 'hurst'
    | 'varianceRatio'
    | 'regression'
    | 'yangZhang'
    | 'ewma';

/**
 * Predicate key selecting how a feature's current value is compared against a
 * textbook threshold.
 *
 * - `'pctB'` — Bollinger %B vs timeframe-aware hi/lo bounds.
 * - `'bandDistAtr'` — distance to a channel band measured in ATR multiples.
 * - `'level'` — feature-defined "notable level". For the simple oscillators this
 *   is a raw value vs overbought/oversold bounds; for the pro-indicators it is
 *   generalized per feature (an extreme reading, a sign/colour/trend flip, or a
 *   volatility-regime extreme) — the backing evaluator owns the exact meaning.
 * - `'ratio'` — a 0–1 ratio (e.g. buy/(buy+sell)) vs hi/lo bounds.
 * - `'channelProximity'` — proximity to (or breach of) a channel high/low.
 */
export type SkillStatePredicateKind =
    'pctB' | 'bandDistAtr' | 'level' | 'ratio' | 'channelProximity';

/**
 * A textbook *state* predicate: "this indicator feature is currently notable".
 *
 * The thresholds backing each `(feature, predicate)` pair live as named
 * constants inside `skillGatingPredicates.ts`; `hi`/`lo` are optional manual
 * overrides for the rare skill that needs a non-default bound.
 */
export interface SkillStatePredicate {
    /** Indicator feature inspected. */
    feature: SkillStateFeature;
    /** How the feature's value is compared (percent-B, band distance, …). */
    predicate: SkillStatePredicateKind;
    /** Upper / overbought threshold override (optional). */
    hi?: number;
    /** Lower / oversold threshold override (optional). */
    lo?: number;
}

/**
 * Frontmatter gating metadata controlling whether a skill is injected into the
 * chart prompt. A discriminated union on `tier` (then `signalKind` for the gated
 * arm) so each variant carries exactly the fields its path needs — there is no
 * optional `triggers` / `state` that could be present on the wrong tier.
 *
 * - `tier: 'always_on'` — injected unconditionally (Tier-0).
 * - `tier: 'gated'`, `signalKind: 'event'` — injected when one of `triggers` is
 *   present in the detected signals/candles.
 * - `tier: 'gated'`, `signalKind: 'state'` — injected when `state` evaluates
 *   notable for the current chart.
 */
export type SkillGating =
    | { readonly tier: 'always_on' }
    | {
          readonly tier: 'gated';
          readonly signalKind: 'event';
          /** Event path: `detectSignals` signal names that load this skill. */
          readonly triggers: readonly string[];
      }
    | {
          readonly tier: 'gated';
          readonly signalKind: 'state';
          /** State path: textbook predicate that loads this skill when notable. */
          readonly state: SkillStatePredicate;
      };

/**
 * @internal
 * Read-only chart context consumed by the skill selector and the state
 * predicates. Every field is already in scope inside `buildAnalysisPrompt`, so
 * the selector stays a pure function of already-computed data (no I/O).
 */
export interface SkillSelectionContext {
    /** Indicator suite for the analyzed bars (state predicates read its last values). */
    indicators: IndicatorResult;
    /** Result of {@link detectSignals} — drives the event gating path. */
    signals: readonly Signal[];
    /** Timeframe of the analyzed bars; drives TF-aware thresholds. */
    timeframe: Timeframe;
    /** Candle pattern names detected on the analyzed bars. */
    detectedCandles: readonly string[];
    /**
     * Chart-pattern IDs surfaced by the pre-screener ({@link screenChartPatterns})
     * for the analyzed bars — a third event-trigger source alongside `signals`
     * and `detectedCandles` (see {@link ChartPatternId}). `[]` for chartless
     * prompts (no bars in scope), when the screener finds nothing, or when ATR
     * is unavailable/non-positive.
     */
    patternCandidates: readonly ChartPatternId[];
    /**
     * Last close of the analyzed bars. Channel/band/VWAP state predicates need
     * the spot price, which `IndicatorResult` does not carry on its own.
     */
    price: number;
    /** ATR as a percent of price (`ATR / price * 100`) for ATR-extreme promotion. */
    atrPercent: number;
}

/** Lightweight skill summary used for showcase / listing UIs. */
export type SkillShowcaseItem = Pick<
    Skill,
    'name' | 'description' | 'type' | 'confidenceWeight'
>;

/** Per-category file counts produced by `countSkillFiles`. */
export interface SkillCounts {
    indicators: number;
    candlesticks: number;
    patterns: number;
    strategies: number;
    supportResistance: number;
    fundamental: number;
    news: number;
}

/** Origin marker carried by AnalysisSignal (currently always `'skill'`). */
export type AnalysisSignalType = 'skill';

/** Signal-strength label assigned by the AI analyst. */
export type SignalStrength = 'strong' | 'moderate' | 'weak';

/** Directional bias of a price action, pattern, or signal. */
export type Trend = 'bullish' | 'bearish' | 'neutral';

/**
 * Single-bar candle pattern label. See {@link detectCandlePattern}.
 */
export type CandlePattern =
    // Doji 계열
    | 'flat'
    | 'gravestone_doji'
    | 'dragonfly_doji'
    | 'doji'
    // Marubozu 계열
    | 'bullish_marubozu'
    | 'bearish_marubozu'
    // 단봉 반전
    | 'shooting_star'
    | 'inverted_hammer'
    | 'hammer'
    | 'hanging_man'
    | 'bullish_belt_hold'
    | 'bearish_belt_hold'
    // 기본 형태
    | 'spinning_top'
    | 'bullish'
    | 'bearish';

/**
 * Multi-bar candle pattern label. See {@link detectMultiCandlePattern}.
 */
export type MultiCandlePattern =
    // 상승 반전
    | 'bullish_engulfing'
    | 'bullish_harami'
    | 'bullish_harami_cross'
    | 'piercing_line'
    | 'bullish_counterattack_line'
    | 'morning_star'
    | 'morning_doji_star'
    | 'bullish_abandoned_baby'
    | 'three_white_soldiers'
    | 'three_inside_up'
    | 'three_outside_up'
    | 'bullish_triple_star'
    | 'ladder_bottom'
    | 'tweezers_bottom'
    | 'downside_gap_two_rabbits'
    // 하락 반전
    | 'bearish_engulfing'
    | 'bearish_harami'
    | 'bearish_harami_cross'
    | 'dark_cloud_cover'
    | 'bearish_counterattack_line'
    | 'evening_star'
    | 'evening_doji_star'
    | 'bearish_abandoned_baby'
    | 'three_black_crows'
    | 'three_inside_down'
    | 'three_outside_down'
    | 'bearish_triple_star'
    | 'advance_block'
    | 'tweezers_top'
    | 'upside_gap_two_crows'
    // 지속
    | 'upside_gap_tasuki'
    | 'downside_gap_tasuki'
    | 'on_neck'
    | 'in_neck';

/**
 * Detected single-bar pattern entry.
 */
export interface SingleCandlePatternEntry {
    barIndex: number;
    patternType: 'single';
    singlePattern: CandlePattern;
    multiPattern: null;
}

/**
 * Detected multi-bar pattern entry.
 */
export interface MultiCandlePatternEntry {
    barIndex: number;
    patternType: 'multi';
    singlePattern: null;
    multiPattern: MultiCandlePattern;
}

/** A detected candle pattern at a specific bar — single or multi. */
export type CandlePatternEntry =
    SingleCandlePatternEntry | MultiCandlePatternEntry;

/**
 * @internal
 * Direction of an indicator cross (up / down).
 */
export type CrossDirection = 'up' | 'down';

/** Risk classification used in AI analysis output. */
export type RiskLevel = 'low' | 'medium' | 'high';

/** Risk classification used in backtest reports. */
export type BacktestRiskLevel = 'low' | 'moderate' | 'high' | 'extreme';

/** A single AI-derived signal entry inside an indicator-guide result. */
export interface AnalysisSignal {
    /** Signal source — currently always `'skill'`. */
    type: AnalysisSignalType;
    /** Korean explanation including the indicator name + numeric condition. */
    description: string;
    /** Signal strength assigned by the AI analyst. */
    strength?: SignalStrength;
    /** Directional bias of the signal. */
    trend: Trend;
}

/**
 * AI interpretation of a single indicator-guide skill.
 */
export interface IndicatorGuideResult {
    /** Skill name (matches a loaded indicator-guide skill verbatim). */
    indicatorName: string;
    /** One or more signals derived from the indicator's current values. */
    signals: AnalysisSignal[];
}

/**
 * A single support / resistance level with explanatory reason.
 */
export interface KeyLevel {
    /** Price level. */
    price: number;
    /** Korean rationale (e.g. confluence sources, swing reference, etc.). */
    reason: string;
}

/**
 * A labelled price reference inside a pattern (e.g. `"넥라인"` at 150.00).
 */
export interface KeyPrice {
    label: string;
    price: number;
}

/**
 * Set of support / resistance levels and the optional volume Point-of-Control.
 */
export interface KeyLevels {
    /** Support levels (typically below current price). */
    support: KeyLevel[];
    /** Resistance levels (typically above current price). */
    resistance: KeyLevel[];
    /** Volume Profile Point-of-Control if available. */
    poc?: KeyLevel;
}

/** Internal: clustered support/resistance level. */
export interface ClusteredKeyLevel extends KeyLevel {
    count: number;
    sources: KeyLevel[];
}

/** Internal: clustered support/resistance result. */
export interface ClusteredKeyLevels {
    support: ClusteredKeyLevel[];
    resistance: ClusteredKeyLevel[];
    poc?: KeyLevel;
}

/** Horizon buckets for multi-timeframe reference (short/medium/long lookback). */
export type HorizonKey = 'short' | 'medium' | 'long';

/** Source of a reference level (descriptive label only — not a conviction rank). */
export type ReferenceLevelKind =
    | 'fib_retracement'
    | 'fib_extension'
    | 'fib_abc_extension'
    | 'vp_poc'
    | 'vp_vah'
    | 'vp_val'
    | 'swing_high'
    | 'swing_low'
    | 'ma'
    | 'ema'
    | 'round'
    | 'pivot_standard'
    | 'pivot_camarilla'
    | 'pivot_fibonacci'
    | 'pivot_woodie'
    | 'pivot_demark'
    | 'ichimoku'
    | 'donchian'
    | 'bollinger'
    | 'keltner'
    | 'supertrend'
    | 'vwap'
    | 'avwap';

/** A single commonly-watched reference price. Advisory context, not a prediction. */
export interface ReferenceLevel {
    /** The reference price level. */
    price: number;
    /** Human-readable label, e.g. "Fib 61.8%", "POC", "MA200", "Camarilla R3". */
    label: string;
    /** Origin category of the level (descriptive label, not a conviction rank). */
    kind: ReferenceLevelKind;
    /** Signed percent distance from current price (negative = below). */
    distancePercent: number;
    /**
     * `true` when the level sits inside the bar-noise band around the price (closer than
     * half the recent mean bar range). Such a level is context — price is on it — but not
     * a usable stop or target. Absent otherwise.
     */
    atPrice?: true;
}

/** Reference levels split by side relative to current price, nearest-first. */
export interface ReferenceLevels {
    /** Levels below the current price, ordered nearest-first. */
    support: ReferenceLevel[];
    /** Levels above the current price, ordered nearest-first. */
    resistance: ReferenceLevel[];
}

/** @internal Optional per-horizon overrides for indicator level collection. */
export interface IndicatorLevelOptions {
    /** Volume profile to use (e.g. a window-local recompute). Defaults to indicators.volumeProfile. */
    volumeProfile?: VolumeProfileResult | null;
    /** MA periods to include (defaults to all present). */
    maPeriods?: readonly number[];
    /** EMA periods to include (defaults to all present). */
    emaPeriods?: readonly number[];
}

/** Whether the current price sits above or below a reference level (`unknown` when undecidable). */
export type PriceVsLevel = 'above' | 'below' | 'unknown';
/** Ordering of the fast/slow EMAs: stacked bullishly, bearishly, or interleaved. */
export type EmaStackState = 'aligned_up' | 'aligned_down' | 'mixed';
/**
 * Ordering of the latest simple-moving-average values across periods:
 * `'bullish'` when they strictly decrease as the period grows
 * (MA5 > MA20 > MA60 …), `'bearish'` when they strictly increase, `'mixed'`
 * otherwise. Returned by `classifyMaStack`.
 */
export type MaStackDirection = 'bullish' | 'bearish' | 'mixed';
/** Swing sequence shape: higher-highs/higher-lows, lower-highs/lower-lows, or neither. */
export type SwingStructureState = 'HH_HL' | 'LH_LL' | 'mixed';
/** Whether the window is directionally trending or range-bound. */
export type MarketRegime = 'trending' | 'ranging';

/** Descriptive trend structure for a horizon — facts, NOT a directional prediction. */
export interface TrendStructure {
    /** Current price relative to the 60-period moving average. */
    priceVsMA60: PriceVsLevel;
    /** Current price relative to the 200-period moving average. */
    priceVsMA200: PriceVsLevel;
    /** Stacking order of the fast/slow EMAs. */
    emaStack: EmaStackState;
    /** Shape of the recent swing-high/swing-low sequence. */
    swingStructure: SwingStructureState;
    /** Latest ADX reading; `null` during the warm-up window. */
    adx: number | null;
    /** Kaufman efficiency ratio over the window; `null` when not computable. */
    efficiencyRatio: number | null;
    /** Trending vs ranging classification derived from ADX and efficiency ratio. */
    regime: MarketRegime;
}

/** Lookback window backing a single horizon's reference levels and structure. */
export interface HorizonWindow {
    /** Number of bars included in the window. */
    bars: number;
    /** Unix timestamp (seconds) of the window's first bar; `null` when empty. */
    fromTime: number | null;
    /** Unix timestamp (seconds) of the window's last bar; `null` when empty. */
    toTime: number | null;
}

/** Reference levels plus trend structure for a single horizon. */
export interface HorizonReference {
    /** Lookback window the levels and structure were computed over. */
    window: HorizonWindow;
    /** Support/resistance reference levels for the window. */
    levels: ReferenceLevels;
    /** Descriptive trend structure for the window. */
    structure: TrendStructure;
    /**
     * The swing high/low this horizon's `Fib …%` / `Fib ext …%` levels (in
     * `levels`) are anchored on, or `null` when there were not enough swing
     * points in the window to compute one. Optional so existing
     * `HorizonReference` literals (tests, older snapshots) keep compiling —
     * added so the prompt can print the anchor instead of leaving the Fib
     * skill's "cite the swing it's anchored on" instruction with nothing to
     * cite (spec 2026-09-18 §2.2 addendum).
     */
    fibProjection?: FibonacciProjection | null;
    /**
     * The A→B→C swing triplet this horizon's `Fib ABC ext …%` levels are
     * anchored on, or `null`/`undefined` when the window has fewer than 3
     * alternating confirmed swing points after B (spec 2026-09-18 §A3). Most
     * charts will not have a confirmed C most of the time — the retracement
     * swing after the latest extreme needs bars to confirm — so `null` here
     * is the common case, not a bug.
     */
    abcExtension?: AbcExtensionProjection | null;
}

/**
 * Every pivot family computed from the shared pivot bar (spec 2026-09-18
 * analysis-prompt decision). The per-horizon level lists keep only the levels
 * nearest price, so a far pivot the model may need for a second target could be
 * missing there; the prompt renders these complete sets as a table instead of
 * letting the model compute one. `null` per family when the pivot bar was
 * missing or unusable.
 */
export interface PivotTables {
    /** Standard pivot set (classic PP/R1–R3/S1–S3), or `null` when the pivot bar was missing or unusable. */
    standard: StandardPivotLevels | null;
    /** Camarilla pivot set (R3/R4/S3/S4), or `null` when the pivot bar was missing or unusable. */
    camarilla: CamarillaPivotLevels | null;
    /** Fibonacci pivot set (PP, R1–R3, S1–S3), or `null` when the pivot bar was missing or unusable. */
    fibonacci: FibonacciPivotLevels | null;
    /** Woodie pivot set (PP, R1–R2, S1–S2), or `null` when the pivot bar was missing or unusable. */
    woodie: WoodiePivotLevels | null;
    /** DeMark pivot set (PP, R1, S1), or `null` when the pivot bar was missing or unusable. */
    demark: DeMarkPivotLevels | null;
}

/** Deterministic, multi-horizon advisory reference for the chart prompt. */
export interface MarketReference {
    /** Short-lookback horizon reference. */
    short: HorizonReference;
    /** Medium-lookback horizon reference. */
    medium: HorizonReference;
    /** Long-lookback horizon reference. */
    long: HorizonReference;
    /**
     * Complete pivot sets from the shared pivot bar. Optional so existing
     * `MarketReference` literals (tests, older snapshots) keep compiling.
     */
    pivots?: PivotTables;
}

/**
 * Standard pivot point set derived from a prior period's high/low/close.
 *
 * `pp` is the central pivot; `r1`–`r3` are resistance levels above it and
 * `s1`–`s3` are support levels below it, following the classic pivot formulas:
 * `r1 = 2·pp − low`, `r2 = pp + (high − low)`, `r3 = high + 2·(pp − low)`,
 * `s1 = 2·pp − high`, `s2 = pp − (high − low)`, `s3 = low − 2·(high − pp)`.
 */
export interface StandardPivotLevels {
    /** Central pivot: (high + low + close) / 3. */
    pp: number;
    /** First resistance level. */
    r1: number;
    /** Second resistance level. */
    r2: number;
    /** Third resistance level. */
    r3: number;
    /** First support level. */
    s1: number;
    /** Second support level. */
    s2: number;
    /** Third support level. */
    s3: number;
}

/** Camarilla pivot levels (the four most-watched). */
export interface CamarillaPivotLevels {
    /** Central pivot: (high + low + close) / 3. */
    pp: number;
    /** Third Camarilla resistance level. */
    r3: number;
    /** Fourth (outermost) Camarilla resistance level. */
    r4: number;
    /** Third Camarilla support level. */
    s3: number;
    /** Fourth (outermost) Camarilla support level. */
    s4: number;
}

/** Fibonacci pivot levels: `pp ± 0.382/0.618/1.000 × range` (spec 2026-09-18 §A2). */
export interface FibonacciPivotLevels {
    /** Central pivot: (high + low + close) / 3. */
    pp: number;
    /** First resistance level: pp + 0.382 × (high − low). */
    r1: number;
    /** Second resistance level: pp + 0.618 × (high − low). */
    r2: number;
    /** Third resistance level: pp + 1.000 × (high − low). */
    r3: number;
    /** First support level: pp − 0.382 × (high − low). */
    s1: number;
    /** Second support level: pp − 0.618 × (high − low). */
    s2: number;
    /** Third support level: pp − 1.000 × (high − low). */
    s3: number;
}

/** Woodie pivot levels: `pp = (H + L + 2C) / 4`. */
export interface WoodiePivotLevels {
    /** Central pivot: (high + low + 2 × close) / 4. */
    pp: number;
    /** First resistance level: 2·pp − low. */
    r1: number;
    /** Second resistance level: pp + (high − low). */
    r2: number;
    /** First support level: 2·pp − high. */
    s1: number;
    /** Second support level: pp − (high − low). */
    s2: number;
}

/** DeMark pivot levels — the "X" rule's PP/R1/S1. */
export interface DeMarkPivotLevels {
    /** Central pivot: X / 4, where X is the close-vs-open weighted high/low/close sum. */
    pp: number;
    /** First resistance level: X/2 − low. */
    r1: number;
    /** First support level: X/2 − high. */
    s1: number;
}

/**
 * One Fibonacci retracement or extension level (ratio + resulting price).
 */
export interface FibonacciLevel {
    /** Fibonacci ratio as a fraction (e.g. 0.382 for 38.2%). */
    ratio: number;
    /** Price at this ratio between (or beyond) the swing high and low. */
    price: number;
}

/**
 * Fibonacci retracement/extension levels anchored on a swing high and low.
 *
 * `direction` reflects the swing the projection is based on: `up` when the most
 * recent swing low precedes the swing high (an up-leg), `down` otherwise. The
 * anchor `high`/`low` are echoed back so the consumer can show the source leg.
 */
export interface FibonacciProjection {
    /** Swing high price used as the upper anchor. */
    high: number;
    /** Swing low price used as the lower anchor. */
    low: number;
    /** Whether the most recent leg is an up-leg (`up`) or down-leg (`down`). */
    direction: SwingLegDirection;
    /** Retracement levels (23.6%–78.6%) within the high–low range. */
    retracements: FibonacciLevel[];
    /** Extension levels (100%–261.8%) projected beyond the range as targets. */
    extensions: FibonacciLevel[];
}

/**
 * Direction of the most recent swing leg used for Fibonacci projection.
 */
export type SwingLegDirection = 'up' | 'down';

/**
 * ABC extension levels (spec 2026-09-18 §A3) — Fibonacci extension ratios
 * projected from point C, using the A→B leg's measured distance, in the
 * A→B leg's own direction (continuation past the B→C retracement).
 */
export interface AbcExtensionProjection {
    /** Price at point A (the older of the two A→B anchor swings). */
    a: number;
    /** Price at point B (the newer of the two A→B anchor swings). */
    b: number;
    /** Price at point C — the confirmed retracement swing after B. */
    c: number;
    /** Direction of the A→B leg (the leg the extension continues). */
    direction: SwingLegDirection;
    /** Extension levels (100%–261.8%) projected from C in the A→B direction. */
    extensions: FibonacciLevel[];
}

/**
 * A single price target (price + rationale string).
 */
export interface PriceTarget {
    /** Target price level. */
    price: number;
    /** Korean rationale (pattern measured move, swing reference, etc.). */
    basis: string;
}

/** Bullish or bearish scenario: targets list + trigger condition. */
export interface PriceScenario {
    /** Targets sorted by proximity to current price. */
    targets: PriceTarget[];
    /** Korean trigger condition (e.g. breakout reference). */
    condition: string;
}

/**
 * Bullish + bearish scenarios for AI-projected price targets.
 */
export interface PriceTargets {
    /** Bullish-side scenario; `null` when not provided. */
    bullish: PriceScenario | null;
    /** Bearish-side scenario; `null` when not provided. */
    bearish: PriceScenario | null;
}

/**
 * Diagonal trendline owned by a specific pattern (e.g. wedge boundary, neckline).
 */
export interface PatternLine {
    label: string;
    start: TrendlinePoint;
    end: TrendlinePoint;
}

/**
 * AI summary of a chart pattern detection (used inside `patternSummaries`).
 */
export interface PatternSummary {
    /** Stable per-result ID assigned during enrichment. */
    id: string;
    /** Pattern identifier (e.g. `"head_and_shoulders"`). */
    patternName: string;
    /** Skill name that defined the pattern. */
    skillName: string;
    /** Whether the pattern was detected in the current bars. */
    detected: boolean;
    /** Directional bias (always present, even when `detected: false`). */
    trend: Trend;
    /** Korean summary of the AI's interpretation. */
    summary: string;
    /** Optional labelled price points (e.g. neckline). */
    keyPrices?: KeyPrice[];
    /** Optional diagonal lines for chart overlay. */
    patternLines?: PatternLine[];
    /** Time range of the pattern (Unix timestamps in seconds). */
    timeRange?: { start: number; end: number };
    /** Confidence weight inherited from the matching skill. */
    confidenceWeight: number;
    /**
     * Model-authored geometry for THIS pattern (spec 2026-09-18 §A6) — the
     * app computes `측정 목표가`/`보수 목표가(50%)` from it and appends them
     * to `keyPrices`; the model must never compute a target itself. Copied
     * verbatim from `## Chart Pattern Candidates (computed)` when the
     * pattern is listed there; for a pattern the pre-screener missed, the
     * model reads the chart itself and fills this in.
     */
    geometry?: PatternTargetGeometry;
}

/**
 * Model-authored measured-move anchor for one detected chart pattern
 * (`PatternSummary.geometry`, spec 2026-09-18 §A6). `domain/analysis/ai-levels.ts`
 * derives `측정 목표가`/`보수 목표가(50%)` from this — never trust a
 * model-computed target string.
 */
export interface PatternTargetGeometry {
    /** Neckline / boundary / rim / handle resistance / flag channel edge the pattern breaks through. */
    breakoutLevel: number;
    /** Textbook measured-move anchor: head, peak/trough average, cup/saucer bottom, flagpole start, or the opposite boundary. */
    extremeLevel: number;
    /** Expected breakout direction. */
    direction: PatternBreakoutDirection;
    /** Right-shoulder high / second peak / opposite boundary / handle low, when the model can name one. */
    invalidationLevel?: number;
}

/** Pattern summary enriched with chart-render configuration from the skill. */
export interface PatternResult extends PatternSummary {
    /** Chart-render directive copied from the skill, if any. */
    renderConfig?: SkillChartDisplay;
}

/** AI summary of a strategy skill. */
export interface StrategyResult {
    id: string;
    /** Strategy skill name. */
    strategyName: string;
    /** Directional bias of the strategy's verdict. */
    trend: Trend;
    /** Korean summary in the strategy skill's specified format. */
    summary: string;
    /** Confidence weight inherited from the strategy skill. */
    confidenceWeight: number;
}

/**
 * AI summary of a detected candle pattern (for the `candlePatterns` field).
 */
export interface CandlePatternSummary {
    id: string;
    /** Single- or multi-bar pattern identifier. */
    patternName: string;
    /** Whether the pattern was detected in the current bars. */
    detected: boolean;
    /** Directional bias of the pattern. */
    trend: Trend;
    /** Korean interpretation enriched with the candlestick guide. */
    summary: string;
}

/** Raw pattern summary before id/confidenceWeight enrichment. */
export type RawPatternSummary = Omit<PatternSummary, 'confidenceWeight' | 'id'>;
/** Raw strategy result before id/confidenceWeight enrichment. */
export type RawStrategyResult = Omit<StrategyResult, 'confidenceWeight' | 'id'>;

/** Trendline direction (rising vs falling). */
export type TrendlineDirection = 'ascending' | 'descending';

/**
 * Single endpoint of a trendline (Unix timestamp + price).
 */
export interface TrendlinePoint {
    /** Unix timestamp (seconds since epoch). */
    time: number;
    /** Price at this endpoint. */
    price: number;
}

/** A trendline with direction + two endpoints. */
export interface Trendline {
    direction: TrendlineDirection;
    start: TrendlinePoint;
    end: TrendlinePoint;
}

/**
 * @internal
 * Internal: source of a reconciled action level.
 */
export type LevelSource = 'ai' | 'fallback' | 'missing';

/**
 * @internal
 * Internal: reconciled level value + provenance.
 */
export interface ResolvedLevel {
    readonly value: number | undefined;
    readonly source: LevelSource;
}

/**
 * @internal
 * Internal: result of action-recommendation reconciliation.
 */
export interface ReconcileResult {
    readonly recommendation: ActionRecommendation;
    readonly wasReconciled: boolean;
    readonly changes: readonly string[];
}

/** Internal: validated action prices after numeric checks. */
export interface ValidatedActionPrices {
    entryPrices: number[];
    stopLoss: number | undefined;
    takeProfitPrices: number[];
}

/** Action recommendation verdict for the long-position decision tree. */
export type EntryRecommendation = 'enter' | 'wait' | 'avoid';

/**
 * Domain-reconciled stopLoss/takeProfit fallback levels for an ActionRecommendation.
 */
export interface ReconciledActionLevels {
    /** Reconciled stop-loss — the AI value when valid, otherwise the domain-derived fallback. */
    readonly stopLoss?: number;
    /** Reconciled take-profit prices — the full array, with only the invalid entries replaced (other AI values preserved). */
    readonly takeProfitPrices?: readonly number[];
    /** Regenerated exit-strategy text reflecting the reconciled levels. */
    readonly exit: string;
    /** Regenerated risk-reward text reflecting the reconciled levels. */
    readonly riskReward: string;
    /** One-sentence reason for the reconciliation, suitable for a tooltip. */
    readonly reason: string;
}

/**
 * 보정값 takeProfit 단일 항목 — 차트 라벨 분기에 사용.
 */
export interface ReconciledTpEntry {
    readonly index: number;
    readonly price: number;
    /** 다중 TP일 때 "#N 청산" 라벨, 단일일 때 "목표가" 라벨로 분기 */
    readonly totalCount: number;
}

/**
 * 차트 오버레이용 "보정값 라인" 정보.
 * AI 원본과 실제로 값이 다른 인덱스만 포함하므로 중복 라인 렌더를 방지한다.
 */
export interface ReconciledActionLineData {
    /** 보정된 stopLoss. AI 값과 다를 때만 존재. */
    readonly stopLoss?: number;
    /** 보정된 takeProfitPrices 중 AI 원본과 다른 인덱스만 포함. */
    readonly takeProfitPrices: readonly ReconciledTpEntry[];
}

/**
 * @internal
 * Long-position recommendation after tier-based field filtering.
 */
export interface FilteredActionRecommendation extends Omit<
    ActionRecommendation,
    'positionAnalysis' | 'entry' | 'exit' | 'riskReward'
> {
    /** Korean prose: current price position vs key levels. */
    positionAnalysis: string | null;
    /** Korean prose: long entry strategy with specific price ranges. */
    entry: string | null;
    /** Korean prose: take-profit + stop-loss strategy. */
    exit: string | null;
    /** Korean prose: risk-reward ratio summary. */
    riskReward: string | null;
}

/** Deterministic plan-vs-price arithmetic, attached to every recommendation. */
export interface PlanCheck {
    /** Price this was measured against — the last close at analysis time. */
    currentPrice: number;
    /** Highest recommended entry price, or `null` when the plan names no entry. */
    entryZoneTop: number | null;
    /** Price has risen past the entry zone by more than {@link ENTRY_ZONE_TOLERANCE}. */
    exceedsEntryZone: boolean;
    /** Price has already fallen through the plan's stop — the plan is void, not merely stale. */
    belowStopLoss: boolean;
    /** Risk:reward measured from the plan's own entry. `null` when inputs are missing. */
    riskRewardAtEntry: number | null;
    /**
     * Risk:reward measured from the current price — what a reader acting now would get.
     *
     * `0` and `null` are different answers: `0` means take-profit targets exist but none of
     * them is above the current price (there is nothing left to capture), while `null` means
     * the inputs could not support a ratio. Only the former is a finding.
     */
    riskRewardAtCurrent: number | null;
}

/** Long-position trading recommendation produced by the AI analyst. */
export interface ActionRecommendation {
    /** Korean prose: current price position vs key levels. */
    positionAnalysis: string;
    /** Korean prose: long entry strategy with specific price ranges. */
    entry: string;
    /** Korean prose: take-profit + stop-loss strategy. */
    exit: string;
    /** Korean prose: risk-reward ratio summary. */
    riskReward: string;
    /** Verdict used by the UI to enable / disable the entry CTA. */
    entryRecommendation?: EntryRecommendation;
    /** Entry price range `[low, high]` or single `[price]`. */
    entryPrices?: number[];
    /** Stop-loss price (single value). */
    stopLoss?: number;
    /** Take-profit price targets in ascending order. */
    takeProfitPrices?: number[];
    /** Domain-derived fallback levels attached when the AI's stopLoss / takeProfitPrices are invalid or missing. The original AI fields above are never mutated — consumers can compare and decide which values to display. Only core writes it: `postProcessAnalysisWithReconcile` drops any model-supplied value, so its presence means the domain corrected the AI's levels. */
    reconciledLevels?: ReconciledActionLevels;
    /** Deterministic plan-vs-current-price arithmetic. Unlike `reconciledLevels` this is attached on every path, including the one where the AI's own levels passed validation — that path is precisely where a computed risk:reward was previously unavailable. */
    planCheck?: PlanCheck;
}

/**
 * Final analysis result returned to consumers.
 *
 * Produced by {@link enrichAnalysisWithConfidence} from a worker raw
 * response. All array fields are normalized — no `null`
 * elements, every entry conforms to its schema. Localized text fields are in
 * Korean (존댓말).
 */
export interface AnalysisResponse {
    /** Korean multi-topic summary; topics separated by `\n`. */
    summary: string;
    /** Overall directional bias. */
    trend: Trend;
    /** Per-skill indicator guide interpretations. */
    indicatorResults: IndicatorGuideResult[];
    /** Risk classification. */
    riskLevel: RiskLevel;
    /** Support / resistance levels with explanations. */
    keyLevels: KeyLevels;
    /** Bullish + bearish scenario price targets. */
    priceTargets: PriceTargets;
    /** Detected chart patterns with confidence-weighted output. */
    patternSummaries: PatternResult[];
    /** Strategy skill verdicts. */
    strategyResults: StrategyResult[];
    /** Detected single- and multi-bar candle patterns. */
    candlePatterns: CandlePatternSummary[];
    /** Diagonal trendlines visible on the full chart. */
    trendlines: Trendline[];
    /** Long-position trading recommendation. */
    actionRecommendation?: ActionRecommendation;
    /** ISO 8601 timestamp of when this analysis was performed. */
    analyzedAt?: string;
}

/**
 * Analysis response after tier-based info-depth filtering: every field
 * unavailable to the caller's tier is replaced with `null` (see
 * {@link filterAnalysisResult}), so consumers can render locked paywall
 * states without receiving hidden analysis content.
 */
export interface FilteredAnalysisResponse {
    /** Korean multi-topic summary, or `null` when the summary fragment is locked. */
    summary: string | null;
    /** Overall directional bias, or `null` when the direction fragment is locked. */
    trend: Trend | null;
    /** Per-skill indicator guide interpretations. */
    indicatorResults: IndicatorGuideResult[] | null;
    /** Risk classification. */
    riskLevel: RiskLevel | null;
    /** Support / resistance levels with explanations. */
    keyLevels: KeyLevels | null;
    /** Bullish + bearish scenario price targets. */
    priceTargets: PriceTargets | null;
    /** Detected chart patterns with confidence-weighted output. */
    patternSummaries: PatternResult[] | null;
    /** Strategy skill verdicts. */
    strategyResults: StrategyResult[] | null;
    /** Detected single- and multi-bar candle patterns. */
    candlePatterns: CandlePatternSummary[] | null;
    /** Diagonal trendlines visible on the full chart. */
    trendlines: Trendline[] | null;
    /** Long-position trading recommendation with gated subfields. */
    actionRecommendation: FilteredActionRecommendation | null;
    /** ISO 8601 timestamp of when this analysis was performed. */
    analyzedAt?: string;
}

/**
 * Tier-filtered analysis payload plus fragments that should render as locked.
 * Returned by {@link filterAnalysisResult} and by cache-read paths
 * (`peekAnalysisCache`, `submitAnalysis`'s cached branch) that apply the same
 * tier gate.
 */
export interface FilteredAnalysisResult {
    /** Filtered analysis data safe to expose to the current tier. */
    result: AnalysisResponse | FilteredAnalysisResponse;
    /** Info-depth fragments hidden from the current tier. */
    lockedInfoDepth: readonly TierInfoDepth[];
}

/**
 * One past analysis of the same symbol + timeframe, supplied by the consumer
 * (the siglens web app / siglens-trader) from its own database.
 *
 * Deliberately a FLAT, language-neutral projection rather than a full
 * `AnalysisResponse`: core must not know the consumer's storage shape, and the
 * digest built from these values is rendered into prompts of every output
 * locale, so no prose field may appear here.
 */
export interface PriorAnalysis {
    /** When the analysis was produced (the original analysis time, not the row's insert time). */
    readonly generatedAt: Date;
    /** Directional bias the analysis concluded with. */
    readonly trend: Trend;
    /** Risk classification the analysis assigned. */
    readonly riskLevel: RiskLevel;
    /** Entry price range `[low, high]` or single `[price]`, when the analysis recommended one. */
    readonly entryPrices?: readonly number[];
    /** Stop-loss price the analysis set, when it recommended an entry. */
    readonly stopLoss?: number;
    /** Take-profit targets in ascending order. */
    readonly takeProfitPrices?: readonly number[];
}

/** Bars + computed indicator suite — see {@link fetchBarsWithIndicators}. */
export interface BarsData {
    /** OHLCV bars sorted oldest-first. */
    bars: Bar[];
    /** Aggregate indicator suite for the same bars. */
    indicators: IndicatorResult;
}

/**
 * @internal
 * Per-timeframe prompt sizing knobs (trend window, recent bars, squeeze lookback).
 */
export interface PromptConfig {
    trendSampleCount: number;
    recentBarsCount: number;
    squeezeZeroCrossLookback: number;
}

/**
 * Prompt-assembly output, split along the stable/dynamic caching boundary
 * (spec §3.4, `docs/superpowers/specs/2026-07-03-prompt-size-quality-redesign-design.md`)
 * — Design C ("skills-to-system split"):
 *
 * - `stable` — ONLY the `always_on` skill digests for this `(analysisType,
 *   catalog)` pair. Byte-identical across calls sharing the same catalog
 *   fingerprint: never contains a symbol, job id, timestamp, or any other
 *   per-call value — it only changes when the skill catalog fingerprint
 *   changes. Non-empty for skill-bearing builders (technical, fundamental,
 *   financials, congress, news) whenever the loaded catalog has `always_on`
 *   skills for that context; `''` for builders that inject no skills at all
 *   (options, market/macro briefing, economic-event, indicator-translation —
 *   these never read the skill catalog and always return `stable: ''`).
 * - `dynamic` — everything else, in production order: the symbol/company
 *   framing, fetched market/news/financial data, gated skill digests chosen
 *   for this specific call, and the per-call request block.
 *
 * Dispatch (`application/*​/submit*.ts`) folds `stable` into the system
 * prompt rather than sending a combined user prompt: `system = origSystem +
 * stable`, `prompt = dynamic` — see `application/CLAUDE.md`'s
 * dispatch-contract note. `analysisSeed` is computed over `system + prompt`
 * so the seed still reflects the full assembled content.
 */
export interface AssembledPrompt {
    /** The `always_on` skill-digest section — byte-stable per `(analysisType, catalog fingerprint)`. Non-empty for skill-bearing builders (technical/fundamental/financials/congress/news) with the production catalog; `''` for no-skill builders (options, market/macro briefing, economic-event, indicator-translation), which never read the skill catalog. (Edge case: only `buildAnalysisPrompt` (technical) collapses to `''` when the catalog has no `always_on` skills; the other skill-bearing builders — fundamental/financials/congress/news/marketNewsDigest — always emit their skill-section wrapper header even with 0 skills.) Folded into the system prompt by dispatch. */
    stable: string;
    /** Everything else, in production order: symbol/company framing, fetched data, gated skill digests, the request block. Sent as `prompt` by dispatch. */
    dynamic: string;
}

/**
 * A verbatim copy of the prompt actually sent to the model for one fresh
 * generation, handed to the consumer via `SubmitAnalysisOptions.onPromptAssembled`
 * / `OverallDependencyInputs.onPromptAssembled` so it can persist the prompt
 * alongside the analysis it produced (offline evaluation, debugging).
 *
 * Only delivered on a cache miss — a cache hit has no freshly assembled
 * prompt to hand out. `system` already has `stable` folded into the base
 * system persona (Design C: `system = basePersona + stable`), so a consumer
 * that wants the exact provider-call arguments needs only `system` and
 * `dynamic`; `stable` is broken out separately because it is
 * BYTE-IDENTICAL across every call sharing the same `(analysisType,
 * catalog)` fingerprint — a consumer storing many of these rows should
 * content-address that half (store it once, reference it by hash) rather
 * than copying it into every row.
 */
export interface AssembledPromptRecord {
    /** The system message actually sent, including the folded-in `stable` skill digest. */
    readonly system: string;
    /** The `always_on` skill digest half — byte-identical across calls sharing a catalog. */
    readonly stable: string;
    /** Everything else: symbol framing, bar data, indicators, gated skills, prior analyses, output rules. */
    readonly dynamic: string;
    /** Prompt-template generation that produced this text, so stored prompts can be grouped by generation. */
    readonly promptVersion: string;
}

/**
 * @internal
 * LLM이 반환하는 원시 분석 응답.
 *
 * 프롬프트에서는 모든 필드를 required로 요청하지만,
 * LLM 특성상 누락·null 반환뿐 아니라 잘못된 타입(예: string 필드에 객체)으로
 * 반환되는 케이스까지 관측된다. 따라서 모든 필드를 unknown으로 받아
 * {@link enrichAnalysisWithConfidence}에서 런타임 정규화한 뒤
 * {@link AnalysisResponse}로 변환한다.
 *
 * 외부 노출 금지 — 외부 LLM 응답 스키마와 직접 결합되므로 public API로 노출하지
 * 않는다. `enrichAnalysisWithConfidence`는 외부 경계에서 `unknown`을 받아 내부적으로
 * 이 타입으로 cast한다.
 */
export interface RawAnalysisResponse {
    summary?: unknown;
    trend?: unknown;
    indicatorResults?: unknown;
    riskLevel?: unknown;
    keyLevels?: unknown;
    priceTargets?: unknown;
    patternSummaries?: unknown;
    strategyResults?: unknown;
    candlePatterns?: unknown;
    trendlines?: unknown;
    actionRecommendation?: unknown;
    analyzedAt?: unknown;
}

/** @internal Raw LLM/news-card response before runtime normalization. */
export interface RawNewsCardAnalysis {
    titleKo?: unknown;
    bodyKo?: unknown;
    summaryKo?: unknown;
    sentiment?: unknown;
    category?: unknown;
    priceImpact?: unknown;
}

/** @internal Raw aggregate news response before runtime normalization. */
export interface RawNewsAnalysisResponse {
    currentDriverKo?: unknown;
    keyEventsKo?: unknown;
    upcomingEventsKo?: unknown;
    overallSentiment?: unknown;
}

/** @internal Raw fundamental category child before runtime normalization. */
export interface RawFundamentalCategoryAssessment {
    category?: unknown;
    sentiment?: unknown;
    rationaleKo?: unknown;
}

/** @internal Raw fundamental response before runtime normalization. */
export interface RawFundamentalAnalysisResponse {
    overallConclusionKo?: unknown;
    categoryAssessments?: unknown;
    riskFactorsKo?: unknown;
    overallSentiment?: unknown;
}

/** @internal Raw overall scenario child before runtime normalization. */
export interface RawOverallScenario {
    name?: unknown;
    triggerConditionKo?: unknown;
    priceRangeKo?: unknown;
}

/** @internal Raw overall response before runtime normalization. */
export interface RawOverallAnalysisResponse {
    headlineKo?: unknown;
    technicalBulletsKo?: unknown;
    fundamentalBulletsKo?: unknown;
    newsBulletsKo?: unknown;
    optionsBulletsKo?: unknown;
    financialsBulletsKo?: unknown;
    integratedConclusionKo?: unknown;
    scenarios?: unknown;
    riskFactorsKo?: unknown;
    /** Echoed straight through by {@link normalizeOverallAnalysisResponse} when a cached entry already carries it — never emitted by the LLM. */
    analyzedAt?: unknown;
}

// --- Job Result Types (submit + poll 패턴) ---

/** Outcome of {@link pollAnalysis}: still processing, finished, or errored. */
export type PollAnalysisResult =
    | { status: 'processing' }
    | {
          status: 'done';
          result: AnalysisResponse | FilteredAnalysisResponse;
          lockedInfoDepth: readonly TierInfoDepth[];
      }
    | { status: 'error'; error: string };

/** Definition of a sector-tracked stock (symbol + Korean name + parent sector). */
export interface SectorStock {
    symbol: string;
    koreanName: string;
    /** Parent sector ETF or virtual-theme symbol (`"XLK"`, `"QNTM"`, `"SPACE"`, ...). */
    sectorSymbol: string;
}

// ─── Sector Signal Discovery (Panel C) ───────────────────────────────────────

/** Signal direction (bullish / bearish). */
export type SignalDirection = 'bullish' | 'bearish';
/** Whether a signal is already confirmed or only anticipated. */
export type SignalPhase = 'confirmed' | 'expected';

/**
 * Signals detected after a confirming event has fired.
 */
export type ConfirmedSignalType =
    | 'rsi_oversold'
    | 'rsi_overbought'
    | 'golden_cross'
    | 'death_cross'
    | 'macd_bullish_cross'
    | 'macd_bearish_cross'
    | 'bollinger_lower_bounce'
    | 'bollinger_upper_breakout'
    | 'bollinger_percentb_oversold'
    | 'bollinger_percentb_overbought'
    | 'supertrend_bullish_flip'
    | 'parabolic_sar_flip'
    | 'ichimoku_cloud_breakout'
    | 'cci_bullish_cross'
    | 'dmi_bullish_cross'
    | 'cmf_bullish_flip'
    | 'mfi_oversold_bounce'
    | 'keltner_upper_breakout'
    | 'squeeze_momentum_bullish'
    | 'keltner_lower_breakout'
    | 'supertrend_bearish_flip'
    | 'ichimoku_cloud_breakdown'
    | 'cci_bearish_cross'
    | 'dmi_bearish_cross'
    | 'cmf_bearish_flip'
    | 'mfi_overbought_reversal'
    | 'parabolic_sar_bearish_flip'
    | 'squeeze_momentum_bearish';

/**
 * Anticipation signals — early warnings that may or may not develop.
 */
export type ExpectedSignalType =
    | 'rsi_bullish_divergence'
    | 'rsi_bearish_divergence'
    | 'macd_histogram_bullish_convergence'
    | 'macd_histogram_bearish_convergence'
    | 'bollinger_squeeze_bullish'
    | 'bollinger_squeeze_bearish'
    | 'support_proximity_bullish'
    | 'resistance_proximity_bearish';

/** Union of every detector output covered by {@link detectSignals}. */
export type SignalType = ConfirmedSignalType | ExpectedSignalType;

/** A single detected signal — direction + phase + bar timestamp. */
export interface Signal {
    /** Detector identifier (e.g. `'golden_cross'`). */
    readonly type: SignalType;
    /** Bullish or bearish bias of the signal. */
    readonly direction: SignalDirection;
    /** Whether this is a confirmed event or an early anticipation. */
    readonly phase: SignalPhase;
    /** Unix timestamp (seconds) of the bar that triggered detection. */
    readonly detectedAt: number;
}

/**
 * Trend classification used by the dashboard sector grid.
 */
export type TrendState = 'uptrend' | 'downtrend' | 'sideways';

/** Per-stock signal entry shown in the dashboard sector grid. */
export interface StockSignalResult {
    /** U.S. equity ticker. */
    readonly symbol: string;
    /** Korean company name. */
    readonly koreanName: string;
    /** Parent sector ETF symbol. */
    readonly sectorSymbol: string;
    /** Latest price (live quote when available, last close otherwise). */
    readonly price: number;
    /** Day-over-day percent change. */
    readonly changePercent: number;
    /** Trend classification at the time of computation. */
    readonly trend: TrendState;
    /** Detected signals for this stock. */
    readonly signals: readonly Signal[];
}

/** Aggregated dashboard sector-signals payload. */
export interface SectorSignalsResult {
    /** ISO 8601 timestamp of when the result was computed. */
    readonly computedAt: string;
    /** One entry per stock with at least one signal. */
    readonly stocks: readonly StockSignalResult[];
}

/** Counts of bullish vs bearish signals for a single stock. */
export interface ConflictInfo {
    readonly bullishCount: number;
    readonly bearishCount: number;
}

/** A stock signal optionally annotated with conflict counts. */
export interface StockWithConflict extends StockSignalResult {
    readonly conflict?: ConflictInfo;
}

/** Resolved + mixed buckets of stocks after conflict assessment. */
export interface ConflictResolution {
    readonly resolved: readonly StockWithConflict[];
    readonly mixed: readonly StockWithConflict[];
}

/** Bar resolution accepted by the dashboard endpoints (subset of {@link Timeframe}). */
export type DashboardTimeframe = '15Min' | '1Hour' | '1Day';

// ─── Chat ─────────────────────────────────────────────────────────────────────

/** A single chat turn used in the chat prompt. */
export interface ChatMessage {
    /** Speaker — `'user'` for end users, `'model'` for AI replies. */
    role: 'user' | 'model';
    /** Message text. */
    content: string;
}

/** Internal: chat-loading UI phase. */
export type ChatLoadingPhase = 'analyzing' | 'generating';

/** Internal: persisted chat session (history + timestamp). */
export interface ChatSession {
    messages: ChatMessage[];
    savedAt: number; // Unix timestamp (ms)
}

/**
 * Chat prompt payload returned by {@link buildChatPrompt}.
 */
export interface ChatPromptPayload {
    /** System instruction grounding the AI to the analysis. */
    systemPrompt: string;
    /** Conversation history with the latest user turn appended. */
    messages: ChatMessage[];
}

// ─── Tier Gating ──────────────────────────────────────────────────────────────

/** User subscription tier used for feature gating. */
export type Tier = 'free' | 'member' | 'pro';

/**
 * How a model is paid for and who may reach it.
 *
 * Orthogonal to {@link Tier}: a tier describes the *caller*, an access class
 * describes the *model*. Resolved by `getModelAccess` in `domain/tier.ts`.
 *
 * - `'free'` — server key, reachable by anonymous callers.
 * - `'member'` — server key, requires sign-in.
 * - `'byok'` — requires sign-in plus the caller's own provider key. Pro tier
 *   is exempt from the key requirement, so this is also the set a pro
 *   licence would unlock on the server key.
 */
export type ModelAccess = 'free' | 'member' | 'byok';

/**
 * Daily usage-limited feature identifiers.
 */
export type TierLimitedFeature = 'analysisPerDay' | 'chatbotPerDay';

/**
 * Analysis detail fragments exposed per tier.
 *
 * Values use the serialized AI response field names, so multi-word fragments
 * intentionally remain snake_case.
 */
export type TierInfoDepth =
    | 'direction'
    | 'summary'
    // Visibility of the sampled catalogue skills' detection output: chart
    // pattern summaries (patternSummaries) and strategy results
    // (strategyResults). Granted to free so a non-member sees the <=3-per-group
    // skills their analysis already ran with. Excludes candlePatterns, which
    // come from a deterministic bar-level detector (not the sampled skill
    // catalogue) and so stay partial_detail/member-only, alongside the deeper
    // full_detail fragments (trendlines, position analysis).
    | 'skill_detection'
    | 'partial_detail'
    | 'full_detail'
    | 'entry'
    | 'stoploss'
    | 'target'
    | 'confidence';

/** AI provider that hosts a model. */
export type AIProvider = 'claude' | 'gemini' | 'chatgpt' | 'deepseek';

/** Effort level shared by Claude adaptive thinking and ChatGPT reasoning. */
/**
 * Adaptive-thinking effort levels accepted by Claude models.
 *
 * Claude has no "off" effort — thinking is disabled through
 * `thinking: {type:'disabled'}` rather than an effort value. See
 * {@link ClaudeAdaptiveReasoningConfig}.
 */
export type ClaudeEffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Reasoning effort levels accepted by ChatGPT models on the Responses API.
 *
 * Unlike Claude, GPT expresses "no reasoning" as an effort value (`'none'`),
 * so the unions intentionally differ. Not every GPT model accepts `'none'` —
 * `gpt-6-astra` returns 400 for it and bottoms out at `'low'`, which the spec
 * records via {@link ReasoningModes.hardOff}.
 *
 * `'max'` is deliberately absent: the OpenAI API documents it, but the
 * installed SDK's `ReasoningEffort` type does not yet include it, and no spec
 * needs it. Add it here once the SDK catches up.
 */
export type ChatGptEffortLevel =
    'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * @deprecated Use {@link ClaudeEffortLevel} or {@link ChatGptEffortLevel}.
 * The shared union cannot express GPT's `'none'`, and widening it would let
 * Claude specs hold a value the Anthropic API rejects.
 * Will be removed in the next major version.
 */
export type EffortLevel = 'low' | 'medium' | 'high';

/**
 * Gemini thinking levels (`thinkingConfig.thinkingLevel`).
 *
 * Generation-3 Gemini models control thinking with this string rather than a
 * numeric budget. Support is per-model and does NOT follow the version number:
 * `gemini-3.5-flash-lite` and `gemini-3.6-flash` accept `'minimal'` (measured
 * `thoughtsTokenCount === 0`), while `gemini-3.7-flash`, `gemini-3.8-flash`,
 * and `gemini-3.1-pro-preview` reject it with a 400 and bottom out at
 * `'low'`. Never infer support from the model name — measure it.
 */
export type GeminiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

/** Gemini reasoning configuration for one toggle state. */
export interface GeminiReasoningConfig {
    /** Thinking level sent as `thinkingConfig.thinkingLevel`. */
    level: GeminiThinkingLevel;
}

/**
 * Claude adaptive-thinking configuration for one toggle state.
 *
 * `{mode:'disabled'}` maps to `thinking: {type:'disabled'}`; `{mode:'adaptive'}`
 * maps to `thinking: {type:'adaptive'}` plus `output_config.effort`.
 */
export type ClaudeAdaptiveReasoningConfig =
    { mode: 'disabled' } | { mode: 'adaptive'; effort: ClaudeEffortLevel };

/**
 * Claude extended-thinking configuration for one toggle state, used by
 * pre-4.6 models that still take a numeric `budget_tokens`.
 *
 * `0` disables thinking entirely.
 */
export interface ClaudeBudgetReasoningConfig {
    /** Maps to `thinking: {type:'enabled', budget_tokens}`; `0` means disabled. */
    budgetTokens: number;
}

/** ChatGPT reasoning configuration for one toggle state. */
export interface ChatGptReasoningConfig {
    /** Maps to `reasoning.effort` on the Responses API. */
    effort: ChatGptEffortLevel;
}

/** DeepSeek reasoning configuration for one toggle state. */
export interface DeepSeekReasoningConfig {
    /** Maps to `thinking: {type: 'enabled' | 'disabled'}`. */
    thinking: boolean;
}

/**
 * Both toggle states of a model's reasoning configuration, plus which one
 * applies when the caller expresses no preference.
 *
 * Holding both states as data (rather than translating a `reasoning` boolean
 * per provider at the call site) is deliberate. Every provider expresses
 * "off" differently — `thinkingLevel:'minimal'`, `thinking:{type:'disabled'}`,
 * `effort:'none'`, `thinking:false` — and several models cannot honour "off"
 * at all. Encoding that per model keeps the knowledge next to the model it
 * describes instead of spreading it across provider branches, which is how
 * the previous `GEMINI_MODELS_SUPPORTING_DISABLED_THINKING` set drifted out of
 * sync with reality.
 *
 * @typeParam TConfig - Provider-specific configuration shape.
 */
export interface ReasoningModes<TConfig> {
    /** Configuration applied when reasoning is off. */
    off: TConfig;
    /** Configuration applied when reasoning is on. */
    on: TConfig;
    /**
     * Which state applies when the caller passes no `reasoning` preference.
     *
     * Free- and member-tier models default to `'off'` so server-key spend
     * stays predictable; BYOK models keep their provider default (`'on'`).
     */
    default: 'off' | 'on';
    /**
     * Whether {@link ReasoningModes.off} removes reasoning entirely. Defaults
     * to `true` when omitted.
     *
     * `false` means `off` is merely the lowest strength the model accepts and
     * the model still spends thinking tokens. Consumers must not report such a
     * model as "reasoning disabled".
     */
    hardOff?: boolean;
    /**
     * Whether the reasoning toggle changes anything for this model. Defaults
     * to `true` when omitted.
     *
     * `false` means {@link ReasoningModes.off} and {@link ReasoningModes.on}
     * are identical, so consumer UIs must disable the toggle rather than let a
     * user flip a control that cannot affect the request.
     */
    toggleable?: boolean;
}

interface BaseModelSpec {
    /**
     * Actual model identifier sent to the provider API.
     *
     * May differ from the internal `ActiveModelId` key (e.g. `claude-haiku-4-5`
     * maps to `claude-haiku-4-5-20251001` on the Anthropic API). SDK callers
     * must use this value — never the raw `ActiveModelId` key — when building
     * the provider request payload.
     */
    apiModelId: string;
    /** Provider-side max output tokens cap. */
    maxOutputTokens: number;
}

/**
 * Claude model on the pre-4.6 extended-thinking API, which takes a numeric
 * `budget_tokens` rather than adaptive thinking. Currently Claude haiku.
 */
export interface ClaudeBudgetModelSpec extends BaseModelSpec {
    /** Provider that hosts the model (drives SDK selection). */
    provider: 'claude';
    /** Discriminant separating the two Claude thinking APIs. */
    thinkingApi: 'budget';
    /** Per-toggle-state thinking budgets. */
    reasoning: ReasoningModes<ClaudeBudgetReasoningConfig>;
    /** Sampling temperature. */
    temperature: number;
}

/**
 * Claude model on the adaptive-thinking API (4.6 generation and later).
 *
 * These models reject sampling parameters, so `temperature` is absent.
 */
export interface ClaudeAdaptiveModelSpec extends BaseModelSpec {
    /** Provider that hosts the model (drives SDK selection). */
    provider: 'claude';
    /** Discriminant separating the two Claude thinking APIs. */
    thinkingApi: 'adaptive';
    /** Per-toggle-state thinking configuration. */
    reasoning: ReasoningModes<ClaudeAdaptiveReasoningConfig>;
    /** Adaptive-thinking Claude models do not accept sampling temperature. */
    temperature?: undefined;
}

/**
 * Gemini model using `thinkingLevel` controls and sampling temperature.
 */
export interface GeminiModelSpec extends BaseModelSpec {
    /** Provider that hosts the model (drives SDK selection). */
    provider: 'gemini';
    /** Per-toggle-state thinking levels. */
    reasoning: ReasoningModes<GeminiReasoningConfig>;
    /** Sampling temperature. */
    temperature: number;
}

/**
 * ChatGPT Responses API reasoning model.
 */
export interface ChatGPTModelSpec extends BaseModelSpec {
    /** Provider that hosts the model (drives SDK selection). */
    provider: 'chatgpt';
    /** Per-toggle-state reasoning efforts. */
    reasoning: ReasoningModes<ChatGptReasoningConfig>;
    /** GPT reasoning models do not accept sampling temperature. */
    temperature?: undefined;
}

/**
 * DeepSeek V4.1 model on the OpenAI-compatible chat/completions API.
 *
 * DeepSeek V4.1 models toggle reasoning via a `thinking` switch rather than a
 * numeric budget or an effort level, so the boolean {@link DeepSeekModelSpec.thinking}
 * flag drives the SDK request. Both thinking and non-thinking modes accept a
 * sampling `temperature`; the SDK caller applies it in non-thinking mode.
 */
export interface DeepSeekModelSpec extends BaseModelSpec {
    /** Provider that hosts the model (drives SDK selection). */
    provider: 'deepseek';
    /**
     * Per-toggle-state thinking switches. `true` maps to
     * `thinking: { type: 'enabled', reasoning_effort: 'high' }`; `false` maps
     * to `thinking: { type: 'disabled' }`.
     */
    reasoning: ReasoningModes<DeepSeekReasoningConfig>;
    /**
     * Sampling temperature. The SDK caller applies it ONLY in non-thinking mode;
     * DeepSeek ignores temperature when reasoning is enabled, so callers must
     * gate on the resolved {@link DeepSeekReasoningConfig.thinking} value.
     */
    temperature: number;
}

/**
 * Per-model SDK call parameters.
 *
 * Single source of truth for everything an AI SDK caller (workers, server
 * actions, UI) needs to invoke the model — provider routing, output limits,
 * thinking budget, reasoning effort, and sampling parameters. New model
 * additions add a row to the spec map and downstream callers pick them up
 * automatically.
 */
export type ModelSpec =
    | ClaudeBudgetModelSpec
    | ClaudeAdaptiveModelSpec
    | GeminiModelSpec
    | ChatGPTModelSpec
    | DeepSeekModelSpec;

/** Any Claude spec, regardless of which thinking API it uses. */
export type ClaudeModelSpec = ClaudeBudgetModelSpec | ClaudeAdaptiveModelSpec;

/**
 * Narrows a `ModelSpec` to any Claude variant.
 *
 * @param spec - The model spec to narrow.
 * @returns `true` when `spec` is a {@link ClaudeModelSpec}.
 */
export function isClaudeModelSpec(spec: ModelSpec): spec is ClaudeModelSpec {
    return spec.provider === 'claude';
}

/**
 * Narrows a `ModelSpec` to `ClaudeAdaptiveModelSpec` — the 4.6-generation and
 * later models driven by `thinking: {type:'adaptive'}` plus `output_config.effort`.
 * These reject sampling parameters.
 *
 * @param spec - The model spec to narrow.
 * @returns `true` when `spec` is a `ClaudeAdaptiveModelSpec`.
 */
export function isClaudeAdaptiveModelSpec(
    spec: ModelSpec
): spec is ClaudeAdaptiveModelSpec {
    return spec.provider === 'claude' && spec.thinkingApi === 'adaptive';
}

/**
 * Narrows a `ModelSpec` to `ClaudeBudgetModelSpec` — the pre-4.6 models driven
 * by a numeric `budget_tokens`, which do accept a sampling temperature.
 *
 * @param spec - The model spec to narrow.
 * @returns `true` when `spec` is a `ClaudeBudgetModelSpec`.
 */
export function isClaudeBudgetModelSpec(
    spec: ModelSpec
): spec is ClaudeBudgetModelSpec {
    return spec.provider === 'claude' && spec.thinkingApi === 'budget';
}

/**
 * Narrows a `ModelSpec` to the variants that carry a numeric `temperature`.
 *
 * ⚠️ Carrying a temperature is not the same as applying one. DeepSeek ignores
 * `temperature` whenever reasoning is enabled, so a caller that reads
 * `spec.temperature` after this guard MUST additionally check the resolved
 * reasoning config (`spec.provider === 'deepseek'` → the active
 * {@link DeepSeekReasoningConfig.thinking}) before sending it.
 *
 * @param spec - The model spec to narrow.
 * @returns `true` when `spec` is a `ClaudeBudgetModelSpec`, `GeminiModelSpec`,
 *   or `DeepSeekModelSpec`.
 */
export function isTemperatureModelSpec(
    spec: ModelSpec
): spec is ClaudeBudgetModelSpec | GeminiModelSpec | DeepSeekModelSpec {
    return spec.provider !== 'chatgpt' && !isClaudeAdaptiveModelSpec(spec);
}

/**
 * Resolves which reasoning configuration applies for a given toggle value.
 *
 * Central helper so every caller resolves the toggle the same way: an explicit
 * `true`/`false` wins, and `undefined` falls back to the spec's own default.
 * This is what makes `reasoning === true` override the spec on every provider
 * — previously only DeepSeek did so, which meant turning the toggle on was a
 * no-op once a spec defaulted to off.
 *
 * @typeParam TModes - The spec's `ReasoningModes` type. Written over the
 *   modes object rather than the config so a union of provider spec types
 *   (e.g. both Claude variants) still resolves — inferring `TConfig` from a
 *   union argument fails.
 * @param modes - The spec's reasoning modes.
 * @param reasoning - Caller preference; `undefined` defers to `modes.default`.
 * @returns The configuration to send to the provider.
 */
export function resolveReasoningConfig<TModes extends ReasoningModes<unknown>>(
    modes: TModes,
    reasoning: boolean | undefined
): TModes['off'] | TModes['on'] {
    const enabled = reasoning ?? modes.default === 'on';
    return enabled ? modes.on : modes.off;
}

/**
 * AI model identifiers allowed by tier gating.
 */
export type TierModel =
    | 'gemini-3.1-pro-preview'
    | 'gemini-3.5-flash-lite'
    | 'gemini-3.6-flash'
    | 'gemini-3.7-flash'
    | 'gemini-3.8-flash'
    | 'claude-haiku-4-5'
    | 'claude-sonnet-5'
    | 'claude-opus-4-8'
    | 'claude-opus-5'
    | 'claude-fable-5-1'
    | 'gpt-5.6-luna'
    | 'gpt-5.6-terra'
    | 'gpt-5.6-sol'
    | 'gpt-6-astra'
    | 'deepseek-v4.1-flash'
    | 'deepseek-v4.1-pro';

/**
 * Active AI model identifiers — every model AI SDK callers may invoke.
 *
 * Identical to {@link TierModel}: the deprecated `claude-sonnet-4` /
 * `claude-opus-4` aliases were removed along with the models they pointed at,
 * so no identifier is gated out any more. Both names are kept because
 * consumers use them to express intent — "a tier-gated model" vs. "a model we
 * can call" — and they may diverge again if aliases return.
 *
 * Stored identifiers that are no longer in this union (older selections in
 * localStorage or analysis history) are rejected by consumer-side allowlist
 * validation and fall back to the default model.
 */
export type ActiveModelId = TierModel;

/** Public model identifier used by tier model access helpers. */
export type ModelId = TierModel;

/**
 * @internal
 * @deprecated Use {@link ModelId} instead. `ChatModel` was a subset of `ModelId` (Gemini models only).
 * Will be removed in the next major version.
 */
export type ChatModel = ModelId;

/**
 * Usage limits keyed by feature for every tier.
 */
export type TierFeatureLimits = Record<
    TierLimitedFeature,
    Record<Tier, number>
>;

/**
 * Toggle set controlling which tier gates are enforced at runtime.
 */
export interface TierFeatureFlags {
    enableTierRestrictions: boolean;
    /** Enables tier-specific timeframe access. Falls back to the legacy global flag when omitted. */
    enableTimeframeRestrictions?: boolean;
    /** Enables tier-specific report information depth. Falls back to the legacy global flag when omitted. */
    enableInfoDepthRestrictions?: boolean;
}

/**
 * Centralized tier configuration consumed by domain and application gates.
 */
export interface TierConfig {
    limits: TierFeatureLimits;
    timeframes: Record<Tier, readonly Timeframe[]>;
    infoDepth: Record<Tier, readonly TierInfoDepth[]>;
    models: Record<Tier, readonly TierModel[]>;
    featureFlags: TierFeatureFlags;
}

/** Request-scoped user tier data for server middleware and handlers. */
export interface UserTierContext {
    /** Authenticated user UUID, or null for anonymous requests. */
    userId: string | null;
    /** Resolved subscription tier for this request. */
    tier: Tier;
}

// ─── Usage Tracking ───────────────────────────────────────────────────────────

/**
 * Action type recorded in usage logs.
 *
 * Defined as a hand-written union so the core library can describe the usage
 * accounting contract without depending on any database schema definition.
 *
 * @remarks
 * If a siglens consumer adds new action types to its
 * `USAGE_ACTION_TYPE_VALUES` (or equivalent schema enum), this union must be
 * extended in a corresponding core PR so callers see the new variant in
 * `RecordUsageInput` / `CreateUsageLogInput`.
 */
export type UsageActionType = 'analysis' | 'chatbot' | 'premium_model';

/**
 * Daily usage counts grouped by action type.
 *
 * Only the action types that participate in the daily rate-limit aggregation
 * are surfaced here. `premium_model` is intentionally omitted because those
 * events are tracked separately through `UsageLogRepository` for billing
 * purposes and do not contribute to the per-IP daily quota.
 */
export interface UsageCounts {
    /** Number of analysis requests recorded for the UTC day. */
    analysis: number;
    /** Number of chatbot requests recorded for the UTC day. */
    chatbot: number;
}

/**
 * Persisted usage log record returned after insertion.
 */
export interface UsageLogRecord {
    /** Unique usage log identifier. */
    id: string;
    /** User UUID when authenticated, otherwise null. */
    userId: string | null;
    /** SHA-256 hash of IP plus UTC daily salt. */
    ipHash: string;
    /** Usage action that was recorded. */
    actionType: UsageActionType;
    /** AI model or backend path used by the request. */
    modelUsed: string;
    /** UTC date bucket used for daily resets. */
    date: string;
    /** Timestamp when the row was created. */
    createdAt: Date;
}

// ─── Backtesting ──────────────────────────────────────────────────────────────

/** Internal: backtest signal outcome. */
export type BacktestSignalResult = 'win' | 'loss';
/** Internal: backtest AI outcome. */
export type BacktestAiResult = 'win' | 'loss' | 'neutral';
/** Internal: reason a backtest case exited the position. */
export type BacktestExitReason = 'take_profit' | 'stop_loss' | 'time';

/**
 * Internal: AI-suggested price target stored in a backtest case.
 */
export interface BacktestAiPriceTarget {
    price: number;
    basis: string;
}

/** Internal: AI entry recommendation stored in a backtest case. */
export type BacktestAiEntryRecommendation = 'enter' | 'wait' | 'avoid';

/**
 * Internal: AI analysis snapshot stored alongside a backtest case.
 */
export interface BacktestAiAnalysis {
    summary: string;
    tags: string[];
    entryRecommendation: BacktestAiEntryRecommendation;
    // 방향성 예측: bullish priceTargets[0] 만 저장 (UI는 첫 목표가만 표시)
    bullishTargets: BacktestAiPriceTarget[];
    // 실행 레벨: AI가 제시한 SL/TP (무효값은 제거 — 유효한 것만 저장)
    stopLoss?: number;
    takeProfit?: number;
    riskLevel?: BacktestRiskLevel;
}

/** Internal: a single backtest case (entry/exit + outcome + AI snapshot). */
export interface BacktestCase {
    ticker: string;
    entryDate: string;
    entryPrice: number;
    exitDate: string;
    exitPrice: number;
    holdingDays: number;
    returnPct: number;
    signalType: 'buy';
    result: BacktestSignalResult;
    exitReason: BacktestExitReason;
    aiResult: BacktestAiResult;
    aiTrendHit: boolean;
    aiAnalysis: BacktestAiAnalysis;
}

/** Internal: aggregate backtest meta (period, totals, rates). */
export interface BacktestMeta {
    period: string;
    totalCases: number;
    winRate: number;
    aiWinRate: number;
    aiTrendHitRate: number;
    tickerCount: number;
}

/** Internal: backtest dataset (meta + cases). */
export interface BacktestData {
    meta: BacktestMeta;
    cases: BacktestCase[];
}

/** Internal: 2x2 backtest result quadrant key. */
export type QuadrantKey =
    | 'bullishConfirmed'
    | 'bullishExpected'
    | 'bearishExpected'
    | 'bearishConfirmed';

/**
 * Fire-and-forget dispatcher. On Vercel serverless, pass `waitUntil` from
 * `@vercel/functions` so the runtime keeps the promise alive past the response.
 * On long-lived runtimes (Cloud Run worker), the default is sufficient.
 */
export type WaitUntil = (promise: Promise<unknown>) => void;

// ─── LLM ──────────────────────────────────────────────────────────────────────

/** Canonical API key provider identifier. Single source of truth for key storage routing. */
export type LlmProvider = 'anthropic' | 'google' | 'openai' | 'deepseek';

// ─────────────────────────────────────────
// Fundamental analysis
// ─────────────────────────────────────────

/** Sentiment label for a single fundamental analysis category or summary. Equivalent shape to {@link Trend} and {@link NewsSentiment}; kept separate for domain clarity. */
export type FundamentalSentiment = 'bullish' | 'neutral' | 'bearish';

/** Named union for the five fundamental analysis categories. */
export type FundamentalCategory =
    'valuation' | 'profitability' | 'growth' | 'health' | 'futureDirection';

/**
 * Per-category assessment summary used by the fundamental analysis response.
 */
export interface FundamentalCategoryAssessment {
    category: FundamentalCategory;
    sentiment: FundamentalSentiment;
    /** Per-category rationale paragraph (Korean output). */
    rationaleKo: string;
}

/** LLM-generated fundamental analysis result returned to the caller. */
export interface FundamentalAnalysisResponse {
    /** Overall conclusion paragraph (Korean output). */
    overallConclusionKo: string;
    /** Per-category assessment list. */
    categoryAssessments: FundamentalCategoryAssessment[];
    /** Risk factor bullet points (Korean output). */
    riskFactorsKo: string[];
    /** Aggregate sentiment (bullish / neutral / bearish). */
    overallSentiment: FundamentalSentiment;
}

/** Company profile fields included in the fundamental snapshot. */
export interface FundamentalProfile {
    symbol: string;
    companyName: string;
    sector: string;
    industry: string;
    marketCap: number;
    ceo: string | null;
    website: string | null;
    description: string | null;
}

/**
 * @internal
 * Valuation multiples.
 */
export interface FundamentalValuation {
    per: number | null;
    psr: number | null;
    pbr: number | null;
    peg: number | null;
    evToEbitda: number | null;
    eps: number | null;
}

/**
 * @internal
 * Single peer entry for relative valuation context.
 */
export interface FundamentalPeer {
    symbol: string;
    companyName: string;
    marketCap: number;
    /** Trailing-twelve-month price/earnings ratio; null when unavailable. */
    per: number | null;
    /** Trailing-twelve-month price/sales ratio; null when unavailable. */
    psr: number | null;
}

/**
 * @internal
 * Profitability metrics.
 */
export interface FundamentalProfitability {
    roe: number | null;
    roa: number | null;
    operatingMargin: number | null;
    netMargin: number | null;
}

/**
 * @internal
 * Revenue and EPS year-over-year growth rates.
 */
export interface FundamentalGrowth {
    revenueYoy: number | null;
    epsYoy: number | null;
}

/**
 * @internal
 * Financial health and solvency metrics.
 */
export interface FundamentalHealth {
    debtRatio: number | null;
    currentRatio: number | null;
    operatingCashFlow: number | null;
    altmanZScore: number | null;
    piotroskiScore: number | null;
}

/**
 * @internal
 * Analyst grade breakdown (buy/hold/sell counts).
 */
export interface GradesConsensus {
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
}

/**
 * @internal
 * Analyst price target consensus range.
 */
export interface PriceTargetConsensus {
    high: number | null;
    low: number | null;
    median: number | null;
    consensus: number | null;
}

/**
 * @internal
 * Rolling average price targets over recent months and year.
 */
export interface PriceTargetSummary {
    month1Avg: number | null;
    month3Avg: number | null;
    year1Avg: number | null;
}

/**
 * @internal
 * Forward-looking metrics: earnings estimate, analyst grades, and price targets.
 */
export interface FundamentalFutureDirection {
    nextEarningsAt: string | null; // ISO date
    analystEstimateEps: number | null;
    analystEstimateRevenue: number | null;
    gradesConsensus: GradesConsensus | null;
    priceTargetConsensus: PriceTargetConsensus | null;
    priceTargetSummary: PriceTargetSummary | null;
}

/**
 * @internal
 * Single historical data point for sector performance.
 */
export interface SectorHistoricalPoint {
    date: string;
    changePct: number;
}

/**
 * @internal
 * Sector-level price direction including recent history.
 */
export interface FundamentalSectorDirection {
    todayChangePct: number | null;
    historical: SectorHistoricalPoint[];
}

/**
 * @internal
 * Normalized fundamental data fed into the analysis prompt.
 */
export interface FundamentalSnapshot {
    profile: FundamentalProfile;
    valuation: FundamentalValuation;
    peers: FundamentalPeer[];
    profitability: FundamentalProfitability;
    growth: FundamentalGrowth;
    health: FundamentalHealth;
    futureDirection: FundamentalFutureDirection;
    sectorDirection: FundamentalSectorDirection;
    /**
     * ISO currency of the filer's statements (see
     * {@link FundamentalCashFlowInput.reportedCurrency}); absent when the provider did not
     * say. Statement and per-share figures are labelled with it, listing-market figures
     * (market cap, price targets) with the listing currency.
     */
    reportedCurrency?: string;
    /**
     * Current price in the listing's quote currency, filled by the consumer
     * (siglens). Optional so existing callers keep compiling; without it,
     * every price-relative derived metric (target upside, etc.) renders
     * `N/A` rather than guessing.
     */
    currentPrice?: number | null;
}

// ─────────────────────────────────────────
// Fundamental snapshot input shapes
// ─────────────────────────────────────────

/**
 * Domain-neutral input shapes consumed by `normalizeFundamentalSnapshot`.
 *
 * These interfaces describe the _domain role_ of each input to the pure
 * normalization function — not the wire format of any concrete HTTP provider.
 * Infrastructure adapters (e.g. FMP) return objects that structurally satisfy
 * these interfaces; domain never imports from infrastructure.
 *
 * Naming convention: `Fundamental<Role>Input` — describes what the field
 * represents in the business domain, not which API it comes from.
 */

/** Valuation multiples and per-share earnings metrics (trailing-twelve-month). */
export interface FundamentalValuationMetrics {
    peRatioTTM: number | null;
    priceToSalesRatioTTM: number | null;
    pbRatioTTM: number | null;
    pegRatioTTM: number | null;
    enterpriseValueOverEBITDATTM: number | null;
    epsTTM: number | null;
}

/** Profitability and financial health ratios (trailing-twelve-month). */
export interface FundamentalRatiosInput {
    returnOnEquityTTM: number | null;
    returnOnAssetsTTM: number | null;
    operatingProfitMarginTTM: number | null;
    netProfitMarginTTM: number | null;
    debtRatioTTM: number | null;
    currentRatioTTM: number | null;
}

/** Year-over-year income statement growth rates. */
export interface FundamentalGrowthInput {
    growthRevenue: number | null;
    growthEPS: number | null;
}

/** Composite financial health scores (Altman Z-score + Piotroski F-score). */
export interface FundamentalFinancialScoresInput {
    altmanZScore: number | null;
    piotroskiScore: number | null;
}

/** Peer company entry used for the peer comparison table. */
export interface FundamentalPeerInput {
    symbol: string;
    companyName: string;
    marketCap: number;
    /** Trailing-twelve-month price/earnings ratio; omitted or null when unavailable. */
    per?: number | null;
    /** Trailing-twelve-month price/sales ratio; omitted or null when unavailable. */
    psr?: number | null;
}

/**
 * Consensus analyst estimate for the next reporting quarter.
 * `estimatedEpsAvg` and `estimatedRevenueAvg` are the mean values.
 */
export interface FundamentalAnalystEstimateInput {
    estimatedEpsAvg: number | null;
    estimatedRevenueAvg: number | null;
}

/** Buy/hold/sell grade consensus breakdown from analyst ratings. */
export interface FundamentalGradesConsensusInput {
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
}

/**
 * Analyst price target consensus (high / low / median / mean).
 * Maps to domain {@link PriceTargetConsensus} via `normalizeFundamentalSnapshot`.
 */
export interface FundamentalPriceTargetConsensusInput {
    targetHigh: number | null;
    targetLow: number | null;
    targetMedian: number | null;
    targetConsensus: number | null;
}

/**
 * Single average price target bucket (1-month, 3-month, or 12-month window).
 */
export interface PriceTargetAvg {
    avgPriceTarget: number | null;
}

/**
 * Rolling average price targets grouped by lookback window.
 * `lastMonth` → 1-month avg, `lastQuarter` → 3-month avg, `lastYear` → 12-month avg.
 * Maps to domain {@link PriceTargetSummary} via `normalizeFundamentalSnapshot`.
 */
export interface FundamentalPriceTargetSummaryInput {
    lastMonth: PriceTargetAvg;
    lastQuarter: PriceTargetAvg;
    lastYear: PriceTargetAvg;
}

/** Sector performance snapshot entry for a single trading date. */
export interface FundamentalSectorPerformanceInput {
    sector: string;
    changesPercentage: number;
}

/** Historical daily sector performance entry (one row per date per sector). */
export interface FundamentalSectorHistoricalInput {
    date: string;
    sector: string;
    changesPercentage: number;
}

/** Cash flow statement input (subset — operating cash flow only). */
export interface FundamentalCashFlowInput {
    operatingCashFlow: number | null;
    /**
     * ISO currency the filer reports its statements in (FMP `reportedCurrency`), when the
     * provider exposes it. For an ADR this differs from the listing currency — TSM files in
     * TWD — so it labels statement and per-share figures in the prompt. Omit when unknown.
     */
    reportedCurrency?: string | null;
}

/**
 * @internal
 * Input bundle for {@link normalizeFundamentalSnapshot}. Each field corresponds to a single FMP-style fetch result, normalized to domain shapes.
 */
export interface NormalizeFundamentalSnapshotInput {
    profile: FundamentalProfile;
    keyMetricsTtm: FundamentalValuationMetrics | null;
    ratiosTtm: FundamentalRatiosInput | null;
    cashFlow: FundamentalCashFlowInput | null;
    incomeGrowth: FundamentalGrowthInput | null;
    financialScores: FundamentalFinancialScoresInput | null;
    peers: FundamentalPeerInput[];
    analystEstimate: FundamentalAnalystEstimateInput | null;
    gradesConsensus: FundamentalGradesConsensusInput | null;
    priceTargetConsensus: FundamentalPriceTargetConsensusInput | null;
    priceTargetSummary: FundamentalPriceTargetSummaryInput | null;
    nextEarningsAt: string | null;
    sectorTodayChangePct: number | null;
    sectorHistorical: SectorHistoricalPoint[];
}

// ─────────────────────────────────────────
// News analysis
// ─────────────────────────────────────────

/** Sentiment label for an individual news article or aggregate news flow. Equivalent shape to {@link Trend} and {@link FundamentalSentiment}; kept separate for domain clarity. */
export type NewsSentiment = 'bullish' | 'neutral' | 'bearish';

/** Dominant theme of a news article. Used for filtering and prompt context grouping (e.g. earnings results vs M&A vs regulatory action). */
export type NewsCategory =
    | 'earnings'
    | 'm_and_a'
    | 'guidance'
    | 'regulation'
    | 'macro'
    | 'product'
    | 'other';

/**
 * Source feed a market-news article belongs to. Distinct from {@link NewsCategory}
 * (the LLM content-classification): this is the news hub page bucket derived
 * from the FMP feed the article came from, not from its content.
 */
export type NewsFeedCategory =
    'general' | 'stock' | 'crypto' | 'forex' | 'articles';

/**
 * Language the article body is written in.
 *
 * Drives whether the news-card prompt asks for a Korean translation. Feeds that
 * already deliver Korean text (e.g. domestic KRX coverage) must not be
 * re-translated — see {@link NewsItem.sourceLanguage}.
 */
export type NewsSourceLanguage = 'en' | 'ko';

/** Raw news article fetched from the data provider before translation or analysis. */
export interface NewsItem {
    id: string;
    symbol: string;
    source: string;
    url: string;
    publishedAt: string; // ISO
    /**
     * Article title in its original language.
     *
     * The `En` suffix is historical — the field held English text back when every
     * feed was English. It now carries whatever language {@link NewsItem.sourceLanguage}
     * declares. Renaming it would ripple through the consumer's DB schema, so the
     * name stays and this note carries the meaning.
     */
    titleEn: string;
    /** Article body in its original language; `null` when the feed provides none. */
    bodyEn: string | null;
    /**
     * `true` when {@link NewsItem.bodyEn} is a cut-off excerpt rather than the full article.
     *
     * News feeds routinely deliver a lead fragment instead of the whole piece — measured
     * 2026-08-17: FMP `news/stock` returned 207–351 characters with 8 of 10 ending
     * mid-sentence (`"…during the quarter. Apple makes"`), and Naver's `description`
     * is a fixed ~120-character slice that always ends in an ellipsis.
     *
     * Without this flag the model reads a fragment as a complete article. That matters
     * because the prompt asks it to preserve reported figures, growth rates, and
     * guidance — information the cut removed. Being told to surface facts that are not
     * there is exactly the setup that invites invention. Flagging the truncation lets
     * the prompt ask for restraint instead.
     *
     * Omitted means "not known to be truncated", which preserves the behaviour of every
     * feed that predates this field.
     */
    bodyTruncated?: boolean;
    /**
     * Original language of the article. Defaults to `'en'` when omitted, which
     * preserves the behaviour of every feed that existed before this field.
     *
     * Set `'ko'` for domestic Korean feeds. The news-card prompt then skips the
     * translation step and reuses the original text verbatim — asking a model to
     * "translate Korean to Korean" wastes tokens and, worse, invites it to
     * silently rewrite headlines that were already correct.
     */
    sourceLanguage?: NewsSourceLanguage;
}

/**
 * Estimated magnitude of price impact for the named symbol.
 *
 * - `high`       — likely to move price by a material amount (earnings miss/beat, regulatory action, M&A announcement)
 * - `medium`     — noticeable but contained impact (guidance update, analyst upgrade/downgrade)
 * - `low`        — minor relevance, unlikely to drive meaningful movement
 * - `negligible` — background noise; no actionable price implication
 */
export type NewsImpact = 'high' | 'medium' | 'low' | 'negligible';

/**
 * One market-moving news event, projected for prompt injection.
 *
 * Deliberately a FLAT, language-neutral projection rather than a full
 * {@link NewsItem}: core must not know the consumer's storage shape, and the
 * rendered section goes into prompts of every output locale, so no prose field
 * may appear here. The model is told *that* an event happened and how it was
 * classified — never the headline text. Reading the article is the news and
 * overall axes' job; this axis only needs the fact to explain a bar move.
 */
export interface MarketEvent {
    /** When the article was published. */
    readonly publishedAt: Date;
    /** Event classification (earnings, regulation, …). */
    readonly category: NewsCategory;
    /** Directional read the news analysis assigned. */
    readonly sentiment: NewsSentiment;
    /** Expected price impact the news analysis assigned. */
    readonly impact: NewsImpact;
}

/** Per-card translation and sentiment result produced by the flash-lite model. */
export interface NewsCardAnalysis {
    titleKo: string;
    bodyKo: string | null;
    summaryKo: string; // single-line summary
    sentiment: NewsSentiment;
    category: NewsCategory;
    /** Estimated magnitude of price impact for the named symbol. */
    priceImpact: NewsImpact;
}

/**
 * News item paired with its LLM-analyzed card metadata (translation, sentiment, summary).
 * Used as input to {@link buildNewsAnalysisPrompt} and downstream consumers that need
 * pre-analyzed news flow.
 */
export type EnrichedNewsItem = NewsItem & { card: NewsCardAnalysis };

/** LLM-generated aggregate news analysis result returned to the caller. */
export interface NewsAnalysisResponse {
    /** Opening paragraph explaining the news driver behind the current price action (Korean output). */
    currentDriverKo: string;
    /** Key event bullet points, 3–5 items (Korean output). */
    keyEventsKo: string[];
    /** Upcoming events to watch, as bullet points (Korean output). */
    upcomingEventsKo: string[];
    overallSentiment: NewsSentiment;
}

/** Scheduled or reported earnings event with actual vs. estimated figures. */
export interface EarningsCalendarItem {
    symbol: string;
    earningsDate: string; // ISO date
    epsActual: number | null;
    epsEstimated: number | null;
    revenueActual: number | null;
    revenueEstimated: number | null;
    lastUpdated: string; // ISO date
}

/** Raw earnings report payload as returned by the data provider. */
export interface EarningsReport {
    symbol: string;
    earningsDate: string;
}

/** Named union for the action type on an analyst grade change event. */
export type GradesAction =
    'upgrade' | 'downgrade' | 'maintained' | 'initiated' | 'other';

/** Single analyst grade change event for a symbol. */
export interface GradesEvent {
    symbol: string;
    date: string;
    gradingCompany: string;
    previousGrade: string | null;
    newGrade: string;
    action: GradesAction;
}

// ─────────────────────────────────────────
// Overall analysis
// ─────────────────────────────────────────

/** Scenario name for the three-axis overall analysis. Equivalent shape to {@link FundamentalSentiment} and {@link NewsSentiment}; kept separate for domain clarity (scenario direction vs. sentiment label). */
export type OverallScenarioName = 'bullish' | 'neutral' | 'bearish';

/** Single bullish/neutral/bearish scenario with trigger condition and price range. */
export interface OverallScenario {
    name: OverallScenarioName;
    triggerConditionKo: string;
    priceRangeKo: string;
}

/** LLM-generated 4-axis (technical + fundamental + news + options) overall analysis result. */
export interface OverallAnalysisResponse {
    /** One-line definition followed by a current-state paragraph (Korean output). */
    headlineKo: string;
    /** Technical analysis summary bullet points (Korean output). */
    technicalBulletsKo: string[];
    /** Fundamental analysis summary bullet points (Korean output). */
    fundamentalBulletsKo: string[];
    /** News analysis summary bullet points (Korean output). */
    newsBulletsKo: string[];
    /** Options analysis summary bullet points (Korean output). */
    optionsBulletsKo: string[];
    /** Financials scorecard summary bullet points (Korean output). Empty array when no financials data was injected. */
    financialsBulletsKo: string[];
    /** 4-axis synthesis conclusion block, one or two paragraphs (Korean output). */
    integratedConclusionKo: string;
    /** Scenario analysis (bullish / neutral / bearish). */
    scenarios: OverallScenario[];
    /** Risk factor bullet points (Korean output). */
    riskFactorsKo: string[];
    /** OI snapshot staleness marker echoed from caller input. */
    optionsOiStale?: boolean;
    /**
     * ISO datetime this result was produced, set where the result is
     * produced/cached (`runOverallAnalysis`). Optional so existing cache
     * entries written before this field existed stay valid — consumers that
     * read `analyzedAt` from an old entry get `undefined`, not a wrong time.
     */
    analyzedAt?: string;
}

/**
 * Discriminates which analysis produced a dispatched worker job. Sent on the
 * `/analyze` dispatch body so the worker can apply per-analysis behavior
 * (system prompt, response schema, seed, thinking). Optional on the wire for
 * backward compatibility with older workers. The `/briefing` endpoint is not
 * yet part of this contract; its variant is added when that endpoint adopts it.
 */
export type AnalysisType =
    | 'technical'
    | 'overall'
    | 'news'
    | 'newsCard'
    | 'fundamental'
    | 'options'
    | 'financials'
    | 'congress';

/**
 * @internal
 * Minimal JSON-Schema object shape for dispatched structured-output schemas.
 *
 * Authored to be accepted directly by OpenAI strict `json_schema` mode: every
 * key of `properties` must also appear in `required`, and `additionalProperties`
 * must be `false`. The worker translates this canonical form into the
 * provider-specific shape (Gemini `responseSchema`, OpenAI `json_schema`).
 */
export type ResponseJsonSchema = {
    type: 'object';
    properties: Record<string, unknown>;
    required: readonly string[];
    additionalProperties: false;
};

/**
 * Tagged union representing the analysis result currently in view by the chatbot.
 * Injected as context into the chat system prompt so the assistant can reference
 * live numbers from the user's current page.
 *
 * Asset-class framing is controlled by the independent `assetClass` parameter on
 * `buildChatPrompt` — it is NOT carried per-variant here. The two concerns are
 * decoupled: a caller can provide a context without specifying `assetClass` and
 * vice versa.
 */
export type CurrentAnalysisContext =
    | {
          kind: 'technical';
          payload: AnalysisResponse;
      }
    | {
          kind: 'fundamental';
          payload: FundamentalAnalysisResponse;
      }
    | {
          kind: 'news';
          payload: NewsAnalysisResponse;
      }
    | {
          kind: 'overall';
          payload: OverallAnalysisResponse;
      }
    | {
          kind: 'options';
          payload: OptionsAnalysisResponse;
      }
    | {
          kind: 'financials';
          payload: FinancialsAnalysisResponse;
      }
    | {
          kind: 'congress';
          payload: CongressTrendResponse;
      };

// --- Options Analysis Types ---
// 15+ options domain types live in ./options/types and are re-exported here
// so consumers can keep using the canonical `@/domain/types` import path.
// Defining them inline would push this barrel well past 2,200 lines; the
// subdirectory split keeps the options feature cohesive without changing the
// import contract for callers.
export type {
    BuildOptionsAnalysisPromptOptions,
    OptionsContract,
    OptionsChain,
    OptionsSnapshot,
    StrikeOpenInterest,
    LlmStrikeOpenInterest,
    StrikeVolumeAggregate,
    TopOiQuote,
    OptionsExpirationMetrics,
    ImpliedMoveRange,
    OptionsPerExpirationCommentary,
    OptionsSignal,
    OptionsAnalysisResponse,
    OptionsTone,
    OptionsSignalKind,
    ExpirationSlot,
    ExpirationSlotKey,
    SlotMapping,
    OptionsExpirationFilter,
} from './options/types';

/**
 * @internal
 * Aggregate of directional forward returns over a set of bar indices.
 * `meanReturn` is a fraction (0.012 = +1.2%); `hitRate` is the fraction of
 * samples whose directional return was positive (moved as the signal predicts).
 */
export interface ForwardReturnStats {
    count: number;
    hitRate: number;
    meanReturn: number;
}

/**
 * @internal
 * Forward-edge of a signal's trigger set vs the unconditional baseline.
 * `excess*` fields are signal − baseline; `tStat` tests whether the signal's
 * mean directional return exceeds the baseline mean (one-sample t over the
 * signal's returns). Positive excess + |tStat| ≥ 2 ⇒ provisional "signal".
 */
export interface ForwardEdgeResult {
    horizon: number;
    direction: ForwardDirection;
    triggerCount: number;
    signal: ForwardReturnStats;
    baseline: ForwardReturnStats;
    excessHitRate: number;
    excessMeanReturn: number;
    tStat: number;
}

/**
 * @internal
 * Implementation-correctness check for an indicator series: finite non-null
 * values, values within optional [min,max], and a leading-null warmup count.
 */
export interface SanityResult {
    pass: boolean;
    issues: string[];
}

/**
 * @internal
 * Options for {@link checkSanity}: optional `[min,max]` value bounds, an
 * expected leading-null warmup count, and a `label` used in issue messages.
 */
export interface SanityOptions {
    min?: number;
    max?: number;
    /** Expected number of leading `null` warmup entries. */
    expectedWarmup?: number;
    label?: string;
}

/**
 * @internal
 * Direction a forward-edge signal predicts: `'up'` (price expected to rise) or
 * `'down'` (price expected to fall). Used across the validation harness in
 * place of an inline `'up' | 'down'` union. Distinct from {@link SignalDirection}
 * (`'bullish' | 'bearish'`), which labels a detected signal's bias.
 */
export type ForwardDirection = 'up' | 'down';

// ─── Financials (재무제표) domain ───────────────────────────────

/** Reporting cadence of a financial statement series: full-year or quarterly. */
export type StatementPeriod = 'annual' | 'quarter';
/** Directional verdict assigned by the financials AI analyst to an axis or the whole company. */
export type FinancialsSentiment = 'bullish' | 'neutral' | 'bearish';
/** The four deterministic scorecard axes: growth, quality, solvency, cash. */
export type FinancialsAxis = 'growth' | 'quality' | 'solvency' | 'cash';
/** Letter grade derived from a 0–100 score (A ≥ 80 … F < 35). */
export type FinancialsGrade = 'A' | 'B' | 'C' | 'D' | 'F';

/** A single income statement row (domain-neutral core fields shared by analysis and display). */
export interface IncomeStatementRow {
    /** Fiscal year label (e.g. `"2024"`). */
    fiscalYear: string;
    /** Reporting period label (e.g. `"FY"`, `"Q3"`). */
    period: string;
    /** Statement date in ISO `YYYY-MM-DD` form. */
    date: string;
    /**
     * ISO currency the statement is reported in (FMP `reportedCurrency`), when known. An
     * ADR's statements are not in its listing currency (TSM reports TWD), so the prompt
     * labels amounts with this and leaves them unlabelled when it is absent.
     */
    reportedCurrency?: string | null;
    /** Total revenue for the period; `null` when unavailable. */
    revenue: number | null;
    /** Gross profit (revenue − COGS); `null` when unavailable. */
    grossProfit: number | null;
    /** Operating income (EBIT); `null` when unavailable. */
    operatingIncome: number | null;
    /** Net income (bottom-line earnings); `null` when unavailable. */
    netIncome: number | null;
    /** Earnings before interest, taxes, depreciation, and amortization; `null` when unavailable. */
    ebitda: number | null;
    /** Basic earnings per share; `null` when unavailable. */
    eps: number | null;
    /** Diluted earnings per share; `null` when unavailable. */
    epsDiluted: number | null;
    /** Gross margin as a percent (e.g. `45` for 45%); `null` when unavailable. */
    grossMargin: number | null;
    /** Operating margin as a percent; `null` when unavailable. */
    operatingMargin: number | null;
    /** Net margin as a percent; `null` when unavailable. */
    netMargin: number | null;
}

/** A single balance sheet row. */
export interface BalanceSheetRow {
    /** Fiscal year label (e.g. `"2024"`). */
    fiscalYear: string;
    /** Reporting period label (e.g. `"FY"`, `"Q3"`). */
    period: string;
    /** Statement date in ISO `YYYY-MM-DD` form. */
    date: string;
    /** ISO reporting currency, when known — see {@link IncomeStatementRow.reportedCurrency}. */
    reportedCurrency?: string | null;
    /** Total assets; `null` when unavailable. */
    totalAssets: number | null;
    /** Total current assets; `null` when unavailable. */
    totalCurrentAssets: number | null;
    /** Total liabilities; `null` when unavailable. */
    totalLiabilities: number | null;
    /** Total current liabilities; `null` when unavailable. */
    totalCurrentLiabilities: number | null;
    /** Cash plus short-term investments; `null` when unavailable. */
    cashAndShortTermInvestments: number | null;
    /** Total debt (short + long term); `null` when unavailable. */
    totalDebt: number | null;
    /** Net debt (total debt − cash); negative means net cash; `null` when unavailable. */
    netDebt: number | null;
    /** Total stockholders' equity; `null` when unavailable. */
    totalStockholdersEquity: number | null;
    /** Current ratio (current assets / current liabilities); `null` when unavailable. */
    currentRatio: number | null;
}

/**
 * A single cash flow statement row.
 *
 * `fcfMargin` requires `income.revenue`, so it is populated during snapshot
 * normalization rather than by the raw provider adapter.
 */
export interface CashFlowRow {
    /** Fiscal year label (e.g. `"2024"`). */
    fiscalYear: string;
    /** Reporting period label (e.g. `"FY"`, `"Q3"`). */
    period: string;
    /** Statement date in ISO `YYYY-MM-DD` form. */
    date: string;
    /** ISO reporting currency, when known — see {@link IncomeStatementRow.reportedCurrency}. */
    reportedCurrency?: string | null;
    /** Cash generated by operations; `null` when unavailable. */
    operatingCashFlow: number | null;
    /** Capital expenditure (typically negative); `null` when unavailable. */
    capitalExpenditure: number | null;
    /** Free cash flow (operating cash flow − capex); `null` when unavailable. */
    freeCashFlow: number | null;
    /** Dividends paid (typically negative); `null` when unavailable. */
    dividendsPaid: number | null;
    /** Free cash flow margin as a percent (FCF / revenue × 100); populated during snapshot normalization; `null` when unavailable. */
    fcfMargin: number | null;
}

/** A single income-growth row: year-over-year growth rates as fractions (0.2 = +20%). */
export interface IncomeGrowthRow {
    /** Fiscal year label (e.g. `"2024"`). */
    fiscalYear: string;
    /** Reporting period label (e.g. `"FY"`, `"Q3"`). */
    period: string;
    /** YoY revenue growth as a fraction; `null` when unavailable. */
    growthRevenue: number | null;
    /** YoY net income growth as a fraction; `null` when unavailable. */
    growthNetIncome: number | null;
    /** YoY EPS growth as a fraction; `null` when unavailable. */
    growthEPS: number | null;
    /** YoY operating income growth as a fraction; `null` when unavailable. */
    growthOperatingIncome: number | null;
}

/** A single financial-growth row: YoY and multi-year growth rates as fractions (0.2 = +20%). */
export interface FinancialGrowthRow {
    /** Fiscal year label (e.g. `"2024"`). */
    fiscalYear: string;
    /** Reporting period label (e.g. `"FY"`, `"Q3"`). */
    period: string;
    /** YoY revenue growth as a fraction; `null` when unavailable. */
    revenueGrowth: number | null;
    /** YoY net income growth as a fraction; `null` when unavailable. */
    netIncomeGrowth: number | null;
    /** YoY EPS growth as a fraction; `null` when unavailable. */
    epsGrowth: number | null;
    /** YoY free cash flow growth as a fraction; `null` when unavailable. */
    freeCashFlowGrowth: number | null;
    /** YoY operating cash flow growth as a fraction; `null` when unavailable. */
    operatingCashFlowGrowth: number | null;
    /** YoY total asset growth as a fraction; `null` when unavailable. */
    assetGrowth: number | null;
    /** YoY total debt growth as a fraction; `null` when unavailable. */
    debtGrowth: number | null;
    /** 3-year revenue-per-share growth as a fraction; `null` when unavailable. */
    threeYRevenueGrowthPerShare: number | null;
    /** 5-year revenue-per-share growth as a fraction; `null` when unavailable. */
    fiveYRevenueGrowthPerShare: number | null;
    /** 10-year revenue-per-share growth as a fraction; `null` when unavailable. */
    tenYRevenueGrowthPerShare: number | null;
}

/** A single cash-flow-growth row: YoY growth rates as fractions (0.2 = +20%). */
export interface CashFlowGrowthRow {
    /** Fiscal year label (e.g. `"2024"`). */
    fiscalYear: string;
    /** Reporting period label (e.g. `"FY"`, `"Q3"`). */
    period: string;
    /** YoY operating cash flow growth as a fraction; `null` when unavailable. */
    growthOperatingCashFlow: number | null;
    /** YoY free cash flow growth as a fraction; `null` when unavailable. */
    growthFreeCashFlow: number | null;
    /** YoY capital expenditure growth as a fraction; `null` when unavailable. */
    growthCapitalExpenditure: number | null;
}

/**
 * Input to `computeFinancialsScorecard`.
 *
 * Each series is sorted newest→oldest (index 0 = latest fiscal period).
 */
export interface FinancialsSnapshot {
    /** Income statement rows, newest→oldest. */
    income: IncomeStatementRow[];
    /** Balance sheet rows, newest→oldest. */
    balance: BalanceSheetRow[];
    /** Cash flow statement rows, newest→oldest. */
    cashFlow: CashFlowRow[];
    /** Income-growth rows, newest→oldest. */
    incomeGrowth: IncomeGrowthRow[];
    /** Financial-growth rows, newest→oldest. */
    financialGrowth: FinancialGrowthRow[];
    /** Cash-flow-growth rows, newest→oldest. */
    cashFlowGrowth: CashFlowGrowthRow[];
}

/**
 * All signal type strings emitted by `computeFinancialsScorecard`.
 *
 * Each literal corresponds to a qualitative finding on one of the four
 * scorecard axes (growth / quality / solvency / cash). The union is kept
 * hand-written (not auto-derived) so consumers get discriminated-union
 * narrowing at the type level without depending on implementation internals.
 */
export type FinancialSignalType =
    // Growth axis
    | 'revenue_accel'
    | 'operating_leverage'
    | 'growth_decline'
    | 'operating_income_growth'
    // Quality axis
    | 'earnings_quality_good'
    | 'accrual_warning'
    | 'margin_expansion'
    | 'margin_contraction'
    // Solvency axis
    | 'net_cash'
    | 'debt_rising'
    // Cash axis
    | 'fcf_solid'
    | 'fcf_negative'
    | 'capex_heavy'
    | 'fcf_growth';

/** Whether a {@link FinancialSignal} reads as favorable, unfavorable, or informational. */
export type FinancialSignalDirection = 'positive' | 'negative' | 'neutral';

/** Unit a {@link ScoreMetric} value is expressed in: percent, raw ratio, USD amount, or 0–100 score. */
export type ScoreMetricUnit = 'pct' | 'ratio' | 'usd' | 'score';

/** A qualitative finding emitted by `computeFinancialsScorecard` for one axis. */
export interface FinancialSignal {
    /** Stable signal identifier (one of the {@link FinancialSignalType} literals). */
    type: FinancialSignalType;
    /** Whether the finding is favorable, unfavorable, or informational. */
    direction: FinancialSignalDirection;
    /** Korean display label for the signal. */
    labelKo: string;
}

/** A single labelled metric shown alongside an axis score. */
export interface ScoreMetric {
    /** Korean display label for the metric. */
    labelKo: string;
    /** Metric value in the declared `unit`; `null` when not computable. */
    value: number | null;
    /** Unit the value is expressed in (percent, ratio, USD, or score). */
    unit: ScoreMetricUnit;
}

/** Score, grade, signals, and metrics for one of the four scorecard axes. */
export interface AxisScore {
    /** Axis score from 0 (worst) to 100 (best). */
    score: number;
    /** Letter grade derived from `score`. */
    grade: FinancialsGrade;
    /** Qualitative findings for this axis. */
    signals: FinancialSignal[];
    /** Labelled metrics backing this axis's score. */
    metrics: ScoreMetric[];
}

/** Composite roll-up across all four axes plus a Korean summary. */
export interface FinancialsCompositeScore {
    /** Composite score (mean of the four axis scores), 0–100. */
    score: number;
    /** Letter grade derived from the composite `score`. */
    grade: FinancialsGrade;
    /** Korean one-line summary naming the strongest and weakest axis. */
    summaryKo: string;
}

/** The deterministic 4-axis financials scorecard produced by `computeFinancialsScorecard`. */
export interface FinancialsScorecard {
    /** Growth axis score. */
    growth: AxisScore;
    /** Quality (profitability) axis score. */
    quality: AxisScore;
    /** Solvency (balance-sheet strength) axis score. */
    solvency: AxisScore;
    /** Cash-generation axis score. */
    cash: AxisScore;
    /** Composite roll-up across all four axes. */
    composite: FinancialsCompositeScore;
}

/** AI verdict for a single scorecard axis. */
export interface FinancialsAxisAssessment {
    /** Which axis this assessment covers. */
    axis: FinancialsAxis;
    /** Directional verdict for the axis. */
    sentiment: FinancialsSentiment;
    /** Korean rationale supporting the verdict. */
    rationaleKo: string;
}

/** Normalized AI financials analysis returned to consumers. */
export interface FinancialsAnalysisResponse {
    /** Korean overall conclusion across all axes. */
    overallConclusionKo: string;
    /** Per-axis AI verdicts. */
    axisAssessments: FinancialsAxisAssessment[];
    /** Korean risk-factor bullet points. */
    riskFactorsKo: string[];
    /** Overall directional verdict for the company. */
    overallSentiment: FinancialsSentiment;
}

/** @internal Loose pre-normalization shape of a single axis assessment from the LLM. */
export interface RawFinancialsAxisAssessment {
    axis?: unknown;
    sentiment?: unknown;
    rationaleKo?: unknown;
}
/** @internal Loose pre-normalization shape of the financials LLM response. */
export interface RawFinancialsAnalysisResponse {
    overallConclusionKo?: unknown;
    axisAssessments?: unknown;
    riskFactorsKo?: unknown;
    overallSentiment?: unknown;
}

/** Input to `normalizeFinancialsSnapshot` (domain-neutral bundle assembled by the provider adapter). */
export interface NormalizeFinancialsSnapshotInput {
    /** Raw income statement rows from the provider adapter. */
    income: IncomeStatementRow[];
    /** Raw balance sheet rows from the provider adapter. */
    balance: BalanceSheetRow[];
    /** Raw cash flow statement rows from the provider adapter. */
    cashFlow: CashFlowRow[];
    /** Raw income-growth rows from the provider adapter. */
    incomeGrowth: IncomeGrowthRow[];
    /** Raw financial-growth rows from the provider adapter. */
    financialGrowth: FinancialGrowthRow[];
    /** Raw cash-flow-growth rows from the provider adapter. */
    cashFlowGrowth: CashFlowGrowthRow[];
}

// ─── Congress trades ─────────────────────────────────
/** Legislative chamber that recorded the trade. */
export type Chamber = 'senate' | 'house';
/** Normalized side classification for a congressional trade. */
export type CongressTradeSide = 'buy' | 'sell' | 'unknown';
/** Beneficial owner of a disclosed trade (self, spouse, joint, child, or unknown). */
export type CongressOwner = 'self' | 'spouse' | 'joint' | 'child' | 'unknown';
/** Overall AI verdict on aggregate congressional activity for a symbol. */
export type CongressSentiment = 'bullish' | 'neutral' | 'bearish';
/** Net flow direction derived from buy vs sell counts across all disclosed trades. */
export type CongressTrendDirection =
    'net_buying' | 'net_selling' | 'balanced' | 'no_trades';

/** USD range disclosed under the STOCK Act bands. */
export interface CongressAmountRange {
    /** Lower bound in USD; null when the label has no parseable amount. */
    min: number | null;
    /** Upper bound in USD; null for open-ended ranges (e.g. "$50M+"). */
    max: number | null;
    /** Original FMP amount string (e.g. "$1,001 - $15,000"). */
    label: string;
}

/** Domain-normalized congressional trade record. */
export interface CongressTrade {
    /** Legislative chamber. */
    chamber: Chamber;
    /** Member first name. */
    firstName: string;
    /** Member last name. */
    lastName: string;
    /** Display name (FMP "office" field). */
    office: string;
    /** State abbreviation for senate (e.g. "WV"); may be empty for house rows. */
    district: string;
    /** Beneficial owner of the trade. */
    owner: CongressOwner;
    /** Normalized side classification. */
    side: CongressTradeSide;
    /** Preserved FMP "type" value (e.g. "Sale (Partial)"). */
    rawType: string;
    /** Parsed USD range with the original label preserved. */
    amount: CongressAmountRange;
    /** Asset type label (e.g. "Stock", "Stock Option"). */
    assetType: string;
    /** Asset description as disclosed by the member. */
    assetDescription: string;
    /** Transaction date (yyyy-mm-dd). */
    transactionDate: string;
    /** Disclosure date (yyyy-mm-dd). */
    disclosureDate: string;
    /** Source disclosure document URL. */
    link: string;
    /** Whether capital gains exceeded $200 USD on this disclosure. */
    capitalGainsOver200USD: boolean;
}

/**
 * Single FMP wire row (loose `unknown` fields — adapter / normalization input).
 *
 * Public Tier-4 API: the {@link CongressTradesProvider.getTrades} port returns
 * `Promise<RawCongressTrade[]>`, so consumers implementing an adapter must
 * import this type. Exported from the package index.
 */
export interface RawCongressTrade {
    senateID?: unknown;
    disclosureDate?: unknown;
    transactionDate?: unknown;
    firstName?: unknown;
    lastName?: unknown;
    office?: unknown;
    district?: unknown;
    owner?: unknown;
    assetDescription?: unknown;
    assetType?: unknown;
    type?: unknown;
    amount?: unknown;
    capitalGainsOver200USD?: unknown;
    link?: unknown;
}

/** Count-based statistics summarizing a normalized congress trade set. */
export interface CongressTradeStats {
    /** Count of trades classified as buy. */
    buyCount: number;
    /** Count of trades classified as sell. */
    sellCount: number;
    /** Count of trades whose side could not be classified. */
    unknownCount: number;
    /** Net flow direction derived from buy vs sell counts. */
    direction: CongressTrendDirection;
    /** Number of distinct member offices represented. */
    uniqueMembers: number;
    /** Count of senate-chamber trades. */
    senateCount: number;
    /** Count of house-chamber trades. */
    houseCount: number;
}

/** Normalized AI summary of a symbol's congressional trade activity. */
export interface CongressTrendResponse {
    /** Korean one-paragraph summary of net activity. */
    summaryKo: string;
    /** Korean labels for members worth highlighting. */
    notableMembersKo: string[];
    /** Korean note on risks or caveats (e.g. disclosure lag). */
    riskNoteKo: string;
    /** Overall AI sentiment verdict. */
    overallSentiment: CongressSentiment;
}

/** @internal Raw LLM response (before normalization). */
export interface RawCongressTrendResponse {
    summaryKo?: unknown;
    notableMembersKo?: unknown;
    riskNoteKo?: unknown;
    overallSentiment?: unknown;
}

// =============================================================================
// Economy (macro) feature-local types — re-exported here so consumers continue
// to use the canonical `@/domain/types` import path (domain/CLAUDE.md §
// "Subdirectory `types.ts` exception", mirroring the options pattern above).
// =============================================================================
export type {
    CalendarImpact,
    EconomicIndicatorPoint,
    EconomicIndicatorSeries,
    TreasuryRateSnapshot,
    EconomicCalendarEvent,
    EconomySnapshot,
    MacroRegime,
    MacroBriefingResponse,
} from './economy/types';

// =============================================================================
// Chart-pattern screener types. Only 3 cohesive types, well under the 10+
// threshold that justifies a feature-local `domain/patterns/types.ts` (see
// domain/CLAUDE.md § "Subdirectory `types.ts` exception"), so — unlike
// economy/options/fearGreed above — these are defined directly here rather
// than in a subfolder file re-exported from this module.
// =============================================================================

/** 스크리너가 식별 가능한 차트 패턴 ID — skills/patterns/*.md 파일명과 1:1. */
export type ChartPatternId =
    | 'head_and_shoulders'
    | 'inverse_head_and_shoulders'
    | 'double_top'
    | 'double_bottom'
    | 'triple_top'
    | 'triple_bottom'
    | 'ascending_triangle'
    | 'descending_triangle'
    | 'symmetrical_triangle'
    | 'ascending_wedge'
    | 'descending_wedge'
    | 'bull_flag'
    | 'bear_flag'
    | 'pennant'
    | 'rectangle'
    | 'cup_and_handle'
    | 'rounding_bottom';

/** Swing direction of a confirmed pivot extreme (public: reachable via {@link PatternCandidate.pivots}). */
export type PivotKind = 'high' | 'low';

/** A confirmed zigzag extreme — a local high or low that survived the ATR-relative reversal threshold (public: reachable via {@link PatternCandidate.pivots}). */
export interface PivotPoint {
    /** bars 배열 인덱스. */
    index: number;
    price: number;
    kind: PivotKind;
}

/** A pre-screener candidate hit — a coarse, recall-biased match for one pattern ID over a bar range. */
export interface PatternCandidate {
    id: ChartPatternId;
    /** 판정에 사용된 피벗들의 bar 인덱스 범위. */
    startIndex: number;
    endIndex: number;
    /**
     * The exact pivots the classifier matched on, ascending by index —
     * present whenever a `classifiers.ts` shape matcher produced this
     * candidate. `patternGeometry.ts` computes geometry directly from these
     * (never by re-extracting pivots over `[startIndex, endIndex]`, which
     * could reconstruct a different pivot set than the one actually
     * matched). Absent only for a hand-built candidate (e.g. a test
     * fixture) — `computeCandidateGeometry` returns `null` in that case.
     */
    pivots?: readonly PivotPoint[];
}

/**
 * @internal
 * A named price anchor in a pattern's geometry (peak, trough, neckline,
 * flagpole end, rim, …). `index`/`time` are the source bar's array index and
 * Unix-seconds timestamp, so a renderer can cite the bar date without
 * re-indexing into `bars`.
 */
export interface PatternKeyPoint {
    /** Human-readable role, e.g. `"head"`, `"neckline"`, `"left shoulder"`. */
    label: string;
    price: number;
    index: number;
    time: number;
}

/**
 * Breakout direction implied by a pattern's textbook resolution. Reachable
 * from the public API via {@link PatternTargetGeometry.direction}.
 */
export type PatternBreakoutDirection = 'up' | 'down';

/**
 * @internal
 * Deterministic measured-move geometry for one {@link PatternCandidate} —
 * computed by `domain/patterns/patternGeometry.ts` from the exact bars/ATR
 * the candidate was matched on (spec 2026-09-18 §A1). Consumers render this
 * instead of asking the model to compute a measured move itself.
 */
export interface PatternGeometry {
    keyPoints: PatternKeyPoint[];
    /** Neckline / boundary / handle resistance / rim / flag channel edge the pattern breaks through. */
    breakoutLevel: number;
    /** Textbook measured-move height (head→neckline, flagpole length, cup depth, …). Always > 0. */
    height: number;
    /** `breakoutLevel ± height` in the breakout direction. */
    measuredTarget: number;
    /** `breakoutLevel ± height / 2` — the 50% partial target. */
    conservativeTarget: number;
    /** Right-shoulder high / second peak / opposite boundary / handle low, per pattern. */
    invalidationLevel: number;
    direction: PatternBreakoutDirection;
}

// ─────────────────────────────────────────
// LLM usage (provider-neutral)
// ─────────────────────────────────────────

/**
 * Normalized per-call token counts. The three input buckets are disjoint:
 * `promptTokens + cachedTokens + cacheWriteTokens` = provider-reported input.
 * Field names are shared verbatim with siglens' `entities/llm-provider/lib/usage.ts`
 * so a single CloudWatch query aggregates both.
 *
 * - `promptTokens`: standard-price, non-cached billable input tokens (1x).
 * - `cachedTokens`: cache **reads** — input served from a prior cache write
 *   (billed at ~0.1x by Anthropic).
 * - `cacheWriteTokens`: cache **writes** — input persisted into the cache on
 *   this call (billed at ~1.25x by Anthropic). Only Claude reports a separate
 *   cache-write metric; Gemini and OpenAI have none, so this is always 0 for
 *   them. Kept out of `promptTokens` so the standard-price bucket is not
 *   distorted by the 1.25x cache-write premium.
 */
export interface NormalizedUsage {
    /** Standard-price, non-cached input tokens. */
    promptTokens: number;
    /** Cache read tokens (~0.1x price). */
    cachedTokens: number;
    /** Cache write tokens (Claude only; others report 0). */
    cacheWriteTokens: number;
    /** Output tokens. */
    outputTokens: number;
}
