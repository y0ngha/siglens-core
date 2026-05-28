import type { OptionsAnalysisResponse } from './options/types';

/** Bar resolution literal accepted by the market data providers and indicator pipeline. */
export type Timeframe = '5Min' | '15Min' | '30Min' | '1Hour' | '4Hour' | '1Day';

/** U.S. regular-session state — weekend, regular-session-open, or weekday-closed. */
export type EtSessionStatus = 'weekend' | 'open' | 'closed';

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

/** Sector ranking + descriptive commentary fragment of a market briefing. */
export interface MarketBriefingSectorAnalysis {
    /** Leading sector ETF tickers, ordered by relative strength. */
    leadingSectors: string[];
    /** Lagging sector ETF tickers, ordered by relative weakness. */
    laggingSectors: string[];
    /** Korean prose describing the rotation between leaders and laggards. */
    performanceDescription: string;
}

/** Volatility (VIX) commentary fragment of a market briefing. */
export interface MarketBriefingVolatilityAnalysis {
    /** Last VIX level; `undefined` when the value could not be parsed. */
    vixLevel?: number;
    /** Korean prose interpreting the VIX level. */
    description: string;
}

/** Normalized AI market briefing. Always present in `done` poll outcomes. */
export interface MarketBriefingResponse {
    /** One-sentence Korean overall-market summary. */
    summary: string;
    /** Headline themes driving the day's price action. */
    dominantThemes: string[];
    /** Sector leaders/laggards and a short narrative. */
    sectorAnalysis: MarketBriefingSectorAnalysis;
    /** VIX level + volatility commentary. */
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

/** Definition of a sector grouping (label + member symbols). */
export interface SectorGroupDef {
    label: string;
    symbols: readonly string[];
}

/** Combined dashboard payload returned by `getMarketSummaryWithBriefing`. */
export interface MarketSummaryWithBriefing {
    /** Index/sector quote data. */
    summary: MarketSummaryData;
    /** Briefing submission outcome (cached or submitted). */
    briefing: SubmitBriefingResult;
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

/** Per-bar MACD output: line, signal, histogram. `null` during the warm-up window. */
export interface MACDResult {
    macd: number | null;
    signal: number | null;
    histogram: number | null;
}

/** Per-bar Bollinger Band output: upper / middle / lower. `null` during the warm-up window. */
export interface BollingerResult {
    upper: number | null;
    middle: number | null;
    lower: number | null;
}

/** Per-bar DMI output: +DI, -DI, ADX. `null` during the warm-up window. */
export interface DMIResult {
    diPlus: number | null;
    diMinus: number | null;
    adx: number | null;
}

/** Per-bar Stochastic output: %K, %D. `null` during the warm-up window. */
export interface StochasticResult {
    percentK: number | null;
    percentD: number | null;
}

/** Result of `calculateStochRSI`. `null` during the warm-up window. */
export interface StochRSIResult {
    k: number | null;
    d: number | null;
}

/** Single price-level row of a volume profile histogram. */
export interface VolumeProfileRow {
    price: number;
    volume: number;
}

/** Result of `calculateVolumeProfile`: POC + value-area boundaries + histogram. */
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

/** Result of `calculateIchimoku`. `null` during the warm-up window. */
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

/** Direction of price movement (up / down). */
export type PriceTrend = 'up' | 'down';

/** Indicator trend direction; `null` indicates "not yet determined". */
export type TrendDirection = PriceTrend | null;

/** Result of `calculateParabolicSAR`. `null` during the warm-up window. */
export interface ParabolicSARResult {
    sar: number | null;
    trend: TrendDirection;
}

/** Result of `calculateSupertrend`. `null` during the warm-up window. */
export interface SupertrendResult {
    supertrend: number | null;
    trend: TrendDirection;
}

/** Result of `calculateKeltnerChannel`. `null` during the warm-up window. */
export interface KeltnerChannelResult {
    upper: number | null;
    middle: number | null;
    lower: number | null;
}

/** Result of `calculateDonchianChannel`. `null` during the warm-up window. */
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

// ─── Smart Money Concepts ────────────────────────────────────────────────────
// Concept reference: Smart Money Concepts (SMC) / ICT methodology
// Original TradingView indicator: "Smart Money Concepts [LuxAlgo]" by LuxAlgo
// This is an independent TypeScript implementation based on publicly documented
// SMC trading concepts. Not a port of LuxAlgo's PineScript source code.
// ─────────────────────────────────────────────────────────────────────────────

/** Direction of an SMC structure break or order block. */
export type SMCStructureDirection = 'bullish' | 'bearish';
/** SMC structure break type: BOS = Break of Structure; CHoCH = Change of Character. */
export type SMCBreakType = 'bos' | 'choch';
/** Whether an SMC swing point is a high or a low. */
export type SMCSwingPointType = 'high' | 'low';
/** SMC zone classification. */
export type SMCZoneType = 'premium' | 'discount' | 'equilibrium';

/** A detected swing high or swing low used by SMC structure analysis. */
export interface SMCSwingPoint {
    index: number;
    price: number;
    type: SMCSwingPointType;
}

/** A detected order block. `isMitigated` flips when price returns through it. */
export interface SMCOrderBlock {
    startIndex: number;
    high: number;
    low: number;
    type: SMCStructureDirection;
    isMitigated: boolean;
}

/** A detected fair-value gap. `isMitigated` flips when price fills the gap. */
export interface SMCFairValueGap {
    index: number;
    high: number;
    low: number;
    type: SMCStructureDirection;
    isMitigated: boolean;
}

/** A pair of equal swing points (e.g. equal highs / equal lows). */
export interface SMCEqualLevel {
    price: number;
    firstIndex: number;
    secondIndex: number;
    type: SMCSwingPointType;
}

/** A premium / discount / equilibrium price band on the chart. */
export interface SMCZone {
    high: number;
    low: number;
    type: SMCZoneType;
}

/** A structure break event (BOS or CHoCH) at a specific bar/price. */
export interface SMCStructureBreak {
    index: number;
    price: number;
    type: SMCStructureDirection;
    breakType: SMCBreakType;
}

/** Aggregated SMC analysis output produced by `calculateSmc`. */
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

/** Result of `calculateSqueezeMomentum` for a single bar. */
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
}

/** How a chart-display directive should render (line / marker / region). */
export type ChartDisplayType = 'line' | 'marker' | 'region';

/** Skill category — drives ordering and grouping in prompts. */
export type SkillCategory =
    | 'reversal_bullish'
    | 'reversal_bearish'
    | 'continuation_bullish'
    | 'continuation_bearish'
    | 'neutral'
    | 'fundamental'
    | 'news';

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

/** Single-bar candle pattern label. See {@link detectCandlePattern}. */
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

/** Multi-bar candle pattern label. See {@link detectMultiCandlePattern}. */
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

/** Detected single-bar pattern entry. */
export interface SingleCandlePatternEntry {
    barIndex: number;
    patternType: 'single';
    singlePattern: CandlePattern;
    multiPattern: null;
}

/** Detected multi-bar pattern entry. */
export interface MultiCandlePatternEntry {
    barIndex: number;
    patternType: 'multi';
    singlePattern: null;
    multiPattern: MultiCandlePattern;
}

/** A detected candle pattern at a specific bar — single or multi. */
export type CandlePatternEntry =
    | SingleCandlePatternEntry
    | MultiCandlePatternEntry;

/** Direction of an indicator cross (up / down). */
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

/** AI interpretation of a single indicator-guide skill. */
export interface IndicatorGuideResult {
    /** Skill name (matches a loaded indicator-guide skill verbatim). */
    indicatorName: string;
    /** One or more signals derived from the indicator's current values. */
    signals: AnalysisSignal[];
}

/** A single support / resistance level with explanatory reason. */
export interface KeyLevel {
    /** Price level. */
    price: number;
    /** Korean rationale (e.g. confluence sources, swing reference, etc.). */
    reason: string;
}

/** A labelled price reference inside a pattern (e.g. `"넥라인"` at 150.00). */
export interface KeyPrice {
    label: string;
    price: number;
}

/** Set of support / resistance levels and the optional volume Point-of-Control. */
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

/** A single price target (price + rationale string). */
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

/** Bullish + bearish scenarios for AI-projected price targets. */
export interface PriceTargets {
    /** Bullish-side scenario; `null` when not provided. */
    bullish: PriceScenario | null;
    /** Bearish-side scenario; `null` when not provided. */
    bearish: PriceScenario | null;
}

/** Diagonal trendline owned by a specific pattern (e.g. wedge boundary, neckline). */
export interface PatternLine {
    label: string;
    start: TrendlinePoint;
    end: TrendlinePoint;
}

/** AI summary of a chart pattern detection (used inside `patternSummaries`). */
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

/** AI summary of a detected candle pattern (for the `candlePatterns` field). */
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

/** Single endpoint of a trendline (Unix timestamp + price). */
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

/** Internal: source of a reconciled action level. */
export type LevelSource = 'ai' | 'fallback' | 'missing';

/** Internal: reconciled level value + provenance. */
export interface ResolvedLevel {
    readonly value: number | undefined;
    readonly source: LevelSource;
}

/** Internal: result of action-recommendation reconciliation. */
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

/** Domain-reconciled stopLoss/takeProfit fallback levels for an ActionRecommendation. */
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

/** Long-position recommendation after tier-based field filtering. */
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
    /** Domain-derived fallback levels attached when the AI's stopLoss / takeProfitPrices are invalid or missing. The original AI fields above are never mutated — consumers can compare and decide which values to display. */
    reconciledLevels?: ReconciledActionLevels;
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

/** Analysis response after tier-based info-depth filtering. */
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

/** Tier-filtered analysis payload plus fragments that should render as locked. */
export interface FilteredAnalysisResult {
    /** Filtered analysis data safe to expose to the current tier. */
    result: AnalysisResponse | FilteredAnalysisResponse;
    /** Info-depth fragments hidden from the current tier. */
    lockedInfoDepth: readonly TierInfoDepth[];
}

/** Bars + computed indicator suite — see {@link fetchBarsWithIndicators}. */
export interface BarsData {
    /** OHLCV bars sorted oldest-first. */
    bars: Bar[];
    /** Aggregate indicator suite for the same bars. */
    indicators: IndicatorResult;
}

/** Per-timeframe prompt sizing knobs (trend window, recent bars, squeeze lookback). */
export interface PromptConfig {
    trendSampleCount: number;
    recentBarsCount: number;
    squeezeZeroCrossLookback: number;
}

/** Internal: input for run-analysis worker invocation. */
export interface RunAnalysisInput {
    symbol: string;
    bars: Bar[];
    indicators: IndicatorResult;
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
    integratedConclusionKo?: unknown;
    scenarios?: unknown;
    riskFactorsKo?: unknown;
}

// --- Job Result Types (submit + poll 패턴) ---

/** Outcome of {@link pollAnalysis}: still processing, finished, or errored. */
export type PollAnalysisResult =
    | { status: 'processing' }
    | { status: 'done'; result: AnalysisResponse }
    | { status: 'error'; error: string };

/** Definition of a sector-tracked stock (symbol + Korean name + parent sector). */
export interface SectorStock {
    symbol: string;
    koreanName: string;
    /** Parent sector ETF symbol (`"XLK"`, `"XLF"`, `"XLE"`, ...). */
    sectorSymbol: string;
}

// ─── Sector Signal Discovery (Panel C) ───────────────────────────────────────

/** Signal direction (bullish / bearish). */
export type SignalDirection = 'bullish' | 'bearish';
/** Whether a signal is already confirmed or only anticipated. */
export type SignalPhase = 'confirmed' | 'expected';

/** Signals detected after a confirming event has fired. */
export type ConfirmedSignalType =
    | 'rsi_oversold'
    | 'rsi_overbought'
    | 'golden_cross'
    | 'death_cross'
    | 'macd_bullish_cross'
    | 'macd_bearish_cross'
    | 'bollinger_lower_bounce'
    | 'bollinger_upper_breakout'
    | 'supertrend_bullish_flip'
    | 'parabolic_sar_flip'
    | 'ichimoku_cloud_breakout'
    | 'cci_bullish_cross'
    | 'dmi_bullish_cross'
    | 'cmf_bullish_flip'
    | 'mfi_oversold_bounce'
    | 'keltner_upper_breakout'
    | 'squeeze_momentum_bullish';

/** Anticipation signals — early warnings that may or may not develop. */
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

/** Trend classification used by the dashboard sector grid. */
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

/** Chat prompt payload returned by {@link buildChatPrompt}. */
export interface ChatPromptPayload {
    /** System instruction grounding the AI to the analysis. */
    systemPrompt: string;
    /** Conversation history with the latest user turn appended. */
    messages: ChatMessage[];
}

// ─── Tier Gating ──────────────────────────────────────────────────────────────

/** User subscription tier used for feature gating. */
export type Tier = 'free' | 'member' | 'pro';

/** Daily usage-limited feature identifiers. */
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
    | 'partial_detail'
    | 'full_detail'
    | 'entry'
    | 'stoploss'
    | 'target'
    | 'confidence';

/** AI provider that hosts a model. */
export type AIProvider = 'claude' | 'gemini' | 'chatgpt';

/** Effort level shared by Claude adaptive thinking and ChatGPT reasoning. */
export type EffortLevel = 'low' | 'medium' | 'high';

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

/** Claude model without adaptive thinking. */
export interface ClaudeSamplingModelSpec extends BaseModelSpec {
    /** Provider that hosts the model (drives SDK selection). */
    provider: 'claude';
    /**
     * Thinking budget tokens. `0` = thinking not supported.
     * Currently used by Claude haiku.
     */
    thinkingBudget: 0;
    /** Adaptive thinking is not supported by this model. */
    effort?: undefined;
    /** Sampling temperature. */
    temperature: number;
}

/** Claude model using adaptive thinking effort. */
export interface ClaudeReasoningModelSpec extends BaseModelSpec {
    /** Provider that hosts the model (drives SDK selection). */
    provider: 'claude';
    /** Adaptive thinking effort level. */
    effort: EffortLevel;
    /** Adaptive-thinking Claude models do not accept sampling temperature. */
    temperature?: undefined;
    /** Adaptive-thinking Claude models do not use explicit thinking budgets. */
    thinkingBudget?: undefined;
}

/** Gemini model using thinking-budget controls and sampling temperature. */
export interface GeminiModelSpec extends BaseModelSpec {
    /** Provider that hosts the model (drives SDK selection). */
    provider: 'gemini';
    /** Thinking budget tokens. */
    thinkingBudget: number;
    /** Gemini uses thinking budget instead of reasoning effort. */
    effort?: undefined;
    /** Sampling temperature. */
    temperature: number;
}

/** ChatGPT Responses API reasoning model. */
export interface ChatGPTModelSpec extends BaseModelSpec {
    /** Provider that hosts the model (drives SDK selection). */
    provider: 'chatgpt';
    /**
     * Reasoning effort level.
     * ChatGPT: maps to `reasoning.effort` in the Responses API.
     */
    effort: EffortLevel;
    /** GPT reasoning models do not accept sampling temperature. */
    temperature?: undefined;
    /** GPT reasoning models do not use thinking budgets. */
    thinkingBudget?: undefined;
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
    | ClaudeSamplingModelSpec
    | ClaudeReasoningModelSpec
    | GeminiModelSpec
    | ChatGPTModelSpec;

/**
 * Narrows a `ModelSpec` to the reasoning variants (`ClaudeReasoningModelSpec |
 * ChatGPTModelSpec`). Use this guard whenever you need to read `spec.effort`
 * without a cast — both variants require `effort: EffortLevel` and do not
 * accept a sampling temperature.
 *
 * @param spec - The model spec to narrow.
 * @returns `true` when `spec` is a `ClaudeReasoningModelSpec` or `ChatGPTModelSpec`.
 */
export function isReasoningModelSpec(
    spec: ModelSpec
): spec is ClaudeReasoningModelSpec | ChatGPTModelSpec {
    return spec.effort !== undefined;
}

/**
 * Narrows a `ModelSpec` to the sampling variants (`ClaudeSamplingModelSpec |
 * GeminiModelSpec`). Use this guard whenever you need to read
 * `spec.temperature` or `spec.thinkingBudget` safely — both variants carry a
 * numeric `temperature` field and an explicit `thinkingBudget`.
 *
 * @param spec - The model spec to narrow.
 * @returns `true` when `spec` is a `ClaudeSamplingModelSpec` or `GeminiModelSpec`.
 */
export function isSamplingModelSpec(
    spec: ModelSpec
): spec is ClaudeSamplingModelSpec | GeminiModelSpec {
    return spec.effort === undefined;
}

/**
 * Narrows a `ModelSpec` to `ClaudeReasoningModelSpec` specifically. Use this
 * guard when you need both `provider === 'claude'` and adaptive-thinking
 * semantics — i.e., you intend to pass `budget_tokens` via the Anthropic SDK's
 * thinking block but not a sampling temperature.
 *
 * @param spec - The model spec to narrow.
 * @returns `true` when `spec` is a `ClaudeReasoningModelSpec`.
 */
export function isClaudeReasoningModelSpec(
    spec: ModelSpec
): spec is ClaudeReasoningModelSpec {
    return spec.provider === 'claude' && spec.effort !== undefined;
}

/**
 * Narrows a `ModelSpec` to `ClaudeSamplingModelSpec` specifically. Use this
 * guard when you need both `provider === 'claude'` and sampling-temperature
 * semantics — the model does not support adaptive thinking and requires a
 * numeric `temperature` in the API call.
 *
 * @param spec - The model spec to narrow.
 * @returns `true` when `spec` is a `ClaudeSamplingModelSpec`.
 */
export function isClaudeSamplingModelSpec(
    spec: ModelSpec
): spec is ClaudeSamplingModelSpec {
    return spec.provider === 'claude' && spec.effort === undefined;
}

/** AI model identifiers allowed by tier gating. */
export type TierModel =
    | 'gemini-2.5-flash'
    | 'gemini-2.5-flash-lite'
    | 'gemini-2.5-pro'
    | 'gemini-3-flash-preview'
    | 'gemini-3.1-pro-preview'
    | 'claude-haiku-4-5'
    | 'claude-sonnet-4-6'
    | 'claude-opus-4-7'
    | 'gpt-5-mini'
    | 'gpt-5.4'
    | 'gpt-5.5'
    /** @deprecated Use `claude-sonnet-4-6` instead. Will be removed in the next major version. */
    | 'claude-sonnet-4'
    /** @deprecated Use `claude-opus-4-7` instead. Will be removed in the next major version. */
    | 'claude-opus-4';

/**
 * Deprecated AI model identifiers retained in {@link TierModel} for
 * backward-compatibility with consumers that still reference the older labels.
 * Active SDK call configuration is keyed by {@link ActiveModelId} so deprecated
 * identifiers are intentionally excluded.
 */
type DeprecatedModelId = 'claude-sonnet-4' | 'claude-opus-4';

/**
 * Active AI model identifiers — the subset of {@link TierModel} that AI SDK
 * callers actually invoke. Deprecated aliases are filtered out.
 */
export type ActiveModelId = Exclude<TierModel, DeprecatedModelId>;

/** Public model identifier used by tier model access helpers. */
export type ModelId = TierModel;

/**
 * @deprecated Use {@link ModelId} instead. `ChatModel` was a subset of `ModelId` (Gemini models only).
 * Will be removed in the next major version.
 */
export type ChatModel = ModelId;

/** Usage limits keyed by feature for every tier. */
export type TierFeatureLimits = Record<
    TierLimitedFeature,
    Record<Tier, number>
>;

/** Toggle set controlling which tier gates are enforced at runtime. */
export interface TierFeatureFlags {
    enableTierRestrictions: boolean;
}

/** Centralized tier configuration consumed by domain and application gates. */
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

/** Internal: AI-suggested price target stored in a backtest case. */
export interface BacktestAiPriceTarget {
    price: number;
    basis: string;
}

/** Internal: AI entry recommendation stored in a backtest case. */
export type BacktestAiEntryRecommendation = 'enter' | 'wait' | 'avoid';

/** Internal: AI analysis snapshot stored alongside a backtest case. */
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
export type LlmProvider = 'anthropic' | 'google' | 'openai';

// ─────────────────────────────────────────
// Fundamental analysis
// ─────────────────────────────────────────

/** Sentiment label for a single fundamental analysis category or summary. Equivalent shape to {@link Trend} and {@link NewsSentiment}; kept separate for domain clarity. */
export type FundamentalSentiment = 'bullish' | 'neutral' | 'bearish';

/** Named union for the five fundamental analysis categories. */
export type FundamentalCategory =
    | 'valuation'
    | 'profitability'
    | 'growth'
    | 'health'
    | 'futureDirection';

/** Per-category assessment summary used by the fundamental analysis response. */
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
 * @deprecated Use {@link FundamentalProfile} instead. Kept as a type alias
 *   for one minor version so existing consumers keep compiling. Will be
 *   removed in a future minor release.
 */
export type FundamentalProfileInput = FundamentalProfile;

/** Valuation multiples. */
export interface FundamentalValuation {
    per: number | null;
    psr: number | null;
    pbr: number | null;
    peg: number | null;
    evToEbitda: number | null;
    eps: number | null;
}

/** Single peer entry for relative valuation context. */
export interface FundamentalPeer {
    symbol: string;
    companyName: string;
    marketCap: number;
}

/** Profitability metrics. */
export interface FundamentalProfitability {
    roe: number | null;
    roa: number | null;
    operatingMargin: number | null;
    netMargin: number | null;
}

/** Revenue and EPS year-over-year growth rates. */
export interface FundamentalGrowth {
    revenueYoy: number | null;
    epsYoy: number | null;
}

/** Financial health and solvency metrics. */
export interface FundamentalHealth {
    debtRatio: number | null;
    currentRatio: number | null;
    operatingCashFlow: number | null;
    altmanZScore: number | null;
    piotroskiScore: number | null;
}

/** Analyst grade breakdown (buy/hold/sell counts). */
export interface GradesConsensus {
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
}

/** Analyst price target consensus range. */
export interface PriceTargetConsensus {
    high: number | null;
    low: number | null;
    median: number | null;
    consensus: number | null;
}

/** Rolling average price targets over recent months and year. */
export interface PriceTargetSummary {
    month1Avg: number | null;
    month3Avg: number | null;
    year1Avg: number | null;
}

/** Forward-looking metrics: earnings estimate, analyst grades, and price targets. */
export interface FundamentalFutureDirection {
    nextEarningsAt: string | null; // ISO date
    analystEstimateEps: number | null;
    analystEstimateRevenue: number | null;
    gradesConsensus: GradesConsensus | null;
    priceTargetConsensus: PriceTargetConsensus | null;
    priceTargetSummary: PriceTargetSummary | null;
}

/** Single historical data point for sector performance. */
export interface SectorHistoricalPoint {
    date: string;
    changePct: number;
}

/** Sector-level price direction including recent history. */
export interface FundamentalSectorDirection {
    todayChangePct: number | null;
    historical: SectorHistoricalPoint[];
}

/** Normalized fundamental data fed into the analysis prompt. */
export interface FundamentalSnapshot {
    profile: FundamentalProfile;
    valuation: FundamentalValuation;
    peers: FundamentalPeer[];
    profitability: FundamentalProfitability;
    growth: FundamentalGrowth;
    health: FundamentalHealth;
    futureDirection: FundamentalFutureDirection;
    sectorDirection: FundamentalSectorDirection;
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

/** Single average price target bucket (1-month, 3-month, or 12-month window). */
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
}

/** Input bundle for {@link normalizeFundamentalSnapshot}. Each field corresponds to a single FMP-style fetch result, normalized to domain shapes. */
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

/** Raw news article fetched from the data provider before translation or analysis. */
export interface NewsItem {
    id: string;
    symbol: string;
    source: string;
    url: string;
    publishedAt: string; // ISO
    titleEn: string;
    bodyEn: string | null;
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
    | 'upgrade'
    | 'downgrade'
    | 'maintained'
    | 'initiated'
    | 'other';

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
    /** 4-axis synthesis conclusion block, one or two paragraphs (Korean output). */
    integratedConclusionKo: string;
    /** Scenario analysis (bullish / neutral / bearish). */
    scenarios: OverallScenario[];
    /** Risk factor bullet points (Korean output). */
    riskFactorsKo: string[];
    /** OI snapshot staleness marker echoed from caller input. */
    optionsOiStale?: boolean;
}

/**
 * Tagged union representing the analysis result currently in view by the chatbot.
 * Injected as context into the chat system prompt so the assistant can reference
 * live numbers from the user's current page.
 */
export type CurrentAnalysisContext =
    | { kind: 'technical'; payload: AnalysisResponse }
    | { kind: 'fundamental'; payload: FundamentalAnalysisResponse }
    | { kind: 'news'; payload: NewsAnalysisResponse }
    | { kind: 'overall'; payload: OverallAnalysisResponse }
    | { kind: 'options'; payload: OptionsAnalysisResponse };

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
    StrikeVolumeAggregate,
    TopOiQuote,
    OptionsExpirationMetrics,
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
