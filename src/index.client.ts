// =============================================================================
// Browser Entrypoint
// =============================================================================
// This entrypoint is selected by bundlers through package.json's "browser"
// export condition. Keep it free of application/infrastructure runtime exports:
// those modules can depend on Node APIs and server-only SDKs.

// =============================================================================
// Tier 2 — Domain Building Blocks
// =============================================================================

// Aggregate calculators / detectors
export { calculateIndicators } from './domain/indicators';
export {
    calculateATR,
    calculateBollinger,
    calculateBuySellVolume,
    calculateCCI,
    calculateCMF,
    calculateDMI,
    calculateDonchianChannel,
    calculateEMA,
    calculateIchimoku,
    calculateIchimokuFutureCloud,
    calculateKeltnerChannel,
    calculateMA,
    calculateMACD,
    calculateMFI,
    calculateOBV,
    calculateParabolicSAR,
    calculateRSI,
    calculateSmc,
    calculateSqueezeMomentum,
    calculateStochastic,
    calculateStochRSI,
    calculateSupertrend,
    calculateVolumeProfile,
    calculateVWAP,
    calculateWilliamsR,
    computeEMAValues,
    lastNonNull,
    linreg,
    rollingHighest,
    rollingLowest,
    slidingMax,
    slidingMin,
    sma,
    stdDev,
    typicalPrice,
} from './domain/indicators';
export { classifyTrend, detectSignals } from './domain/signals';

// Prompt builders
export { buildAnalysisPrompt } from './domain/analysis/prompt';
export { buildMarketBriefingPrompt } from './domain/analysis/marketBriefingPrompt';
export { buildChatPrompt } from './domain/chat/buildChatPrompt';
export {
    GEMINI_2_5_FLASH_MODEL,
    GEMINI_2_5_FLASH_LITE_MODEL,
    GEMINI_2_5_PRO_MODEL,
    VALID_CHAT_MODELS,
} from './application/chat/constants';

// Tier gating
export {
    DEFAULT_TIER,
    TIER_CONFIG,
    getAllowedModels,
    getAllowedTimeframes,
    getTierLimit,
    isAllowed,
    isInfoDepthAllowed,
    isModelAllowed,
    isTier,
    isTimeframeAllowed,
} from './domain/tier';

// Response normalization
export { enrichAnalysisWithConfidence } from './domain/analysis/confidence';
export { normalizeMarketBriefing } from './domain/analysis/normalizeMarketBriefing';

// Candle patterns
export {
    detectCandlePattern,
    detectMultiCandlePattern,
} from './domain/analysis/candle';
export {
    CANDLE_PATTERN_DETECTION_BARS,
    detectCandlePatternEntries,
    getDetectionBars,
    selectLastCandlePatternEntries,
} from './domain/analysis/candle-detection';
export {
    getCandlePatternLabel,
    getMultiCandlePatternLabel,
    findCandlePatternLabel,
} from './domain/analysis/candle-labels';
export {
    EXCLUDED_SINGLE_PATTERNS,
    getSinglePatternTrend,
    getMultiPatternTrend,
} from './domain/analysis/candle-trend';
export type { PatternTrend } from './domain/analysis/candle-trend';

// Signal constants / detectors
export {
    CCI_BULLISH_CROSS_LEVEL,
    CCI_OVERSOLD_CROSS_LEVEL,
    CMF_BULLISH_CROSS_LEVEL,
    CROSS_LOOKBACK_BARS,
    DIVERGENCE_FRESHNESS_BARS,
    DIVERGENCE_LOOKBACK_BARS,
    DMI_ADX_TREND_THRESHOLD,
    GOLDEN_CROSS_FAST_PERIOD,
    GOLDEN_CROSS_SLOW_PERIOD,
    HISTOGRAM_CONVERGENCE_BARS,
    MFI_OVERSOLD_LEVEL,
    PIVOT_WINDOW,
    SQUEEZE_LOOKBACK_BARS,
    SQUEEZE_MOMENTUM_ZERO_CROSS,
    SQUEEZE_PCT_B_THRESHOLD,
    SQUEEZE_PERCENTILE,
    SR_APPROACH_LOOKBACK,
    SR_MA_PERIODS,
    SR_PROXIMITY_PCT,
    TREND_EMA_PERIOD,
    TREND_SLOPE_LOOKBACK,
    TREND_SLOPE_THRESHOLD,
} from './domain/signals/constants';
export {
    detectBollingerLowerBounce,
    detectBollingerUpperBreakout,
    detectCciBullishCross,
    detectCmfBullishFlip,
    detectDeathCross,
    detectDmiBullishCross,
    detectGoldenCross,
    detectIchimokuCloudBreakout,
    detectKeltnerUpperBreakout,
    detectMacdBearishCross,
    detectMacdBullishCross,
    detectMfiOversoldBounce,
    detectParabolicSarFlip,
    detectRsiOverbought,
    detectRsiOversold,
    detectSqueezeMomentumBullish,
    detectSupertrendBullishFlip,
} from './domain/signals/confirmed';
export {
    detectBollingerSqueezeBearish,
    detectBollingerSqueezeBullish,
    detectMacdHistogramBearishConvergence,
    detectMacdHistogramBullishConvergence,
    detectResistanceProximityBearish,
    detectRsiBearishDivergence,
    detectRsiBullishDivergence,
    detectSupportProximityBullish,
} from './domain/signals/anticipation';

// Analysis normalization / helpers
export {
    normalizeActionRecommendation,
    normalizeCandlePatternSummary,
    normalizeIndicatorGuideResult,
    normalizeKeyLevels,
    normalizePatternSummary,
    normalizePriceTargets,
    normalizeRiskLevel,
    normalizeStrategyResult,
    normalizeTrend,
    normalizeTrendline,
} from './domain/analysis/normalize';
export {
    asArray,
    asString,
    compact,
} from './domain/analysis/normalizePrimitives';
export { extendTrendline } from './domain/analysis/trendline';
export { postProcessAnalysisWithReconcile } from './domain/analysis/ai-levels';
export {
    clusterKeyLevels,
    validateKeyLevels,
} from './domain/analysis/keyLevels';
export {
    extractReconciledActionLines,
    validateActionPrices,
} from './domain/analysis/actionRecommendation';
export { filterAnalysisResult } from './domain/analysis/filterAnalysisResult';

// Ticker validation utilities
export {
    deduplicateResults,
    isKoreanInput,
    isValidTickerFormat,
} from './domain/ticker';

// Dashboard helpers
export {
    bucketedTimestamp,
    computeStockSignalResult,
    lookbackIsoFromNow,
} from './domain/dashboard';

// =============================================================================
// Tier 4 — Public Types & Constants
// =============================================================================

// Dashboard tickers / sectors
export {
    DASHBOARD_TIMEFRAMES,
    DASHBOARD_TIMEFRAME_LABELS,
    DEFAULT_DASHBOARD_TIMEFRAME,
    MARKET_INDICES,
    MARKET_SUMMARY_FMP_SYMBOLS,
    SECTOR_ETFS,
    SECTOR_GROUPS,
    SECTOR_STOCKS,
    SIGNAL_SECTORS,
} from './domain/constants/dashboard-tickers';

// Candle pattern label maps
export {
    CANDLE_PATTERN_LABELS,
    MULTI_CANDLE_PATTERN_LABELS,
} from './domain/analysis/candle-labels';

// Indicator constants
export {
    ATR_DEFAULT_PERIOD,
    BOLLINGER_DEFAULT_PERIOD,
    BOLLINGER_DEFAULT_STD_DEV,
    CCI_DEFAULT_PERIOD,
    CCI_NORMALIZATION_CONSTANT,
    CCI_OVERBOUGHT_LEVEL,
    CCI_OVERSOLD_LEVEL,
    CCI_ZERO_LEVEL,
    CMF_DEFAULT_PERIOD,
    DMI_DEFAULT_PERIOD,
    DONCHIAN_DEFAULT_PERIOD,
    EMA_DEFAULT_PERIODS,
    EMA_SUPPORT_RESISTANCE_LONG_INDEX,
    EMA_SUPPORT_RESISTANCE_SHORT_INDEX,
    EMPTY_INDICATOR_RESULT,
    EMPTY_SMC_RESULT,
    HIGH_CONFIDENCE_WEIGHT,
    ICHIMOKU_BASE_PERIOD,
    ICHIMOKU_CONVERSION_PERIOD,
    ICHIMOKU_DISPLACEMENT,
    ICHIMOKU_SPAN_B_PERIOD,
    KELTNER_ATR_PERIOD,
    KELTNER_EMA_PERIOD,
    KELTNER_MULTIPLIER,
    MA_DEFAULT_PERIODS,
    MACD_FAST_PERIOD,
    MACD_SIGNAL_PERIOD,
    MACD_SLOW_PERIOD,
    MEDIUM_CONFIDENCE_WEIGHT,
    MFI_DEFAULT_PERIOD,
    MIN_CONFIDENCE_WEIGHT,
    PSAR_AF_INCREMENT,
    PSAR_AF_MAX,
    PSAR_AF_START,
    RSI_DEFAULT_PERIOD,
    RSI_OVERBOUGHT_LEVEL,
    RSI_OVERSOLD_LEVEL,
    SMC_ATR_PERIOD,
    SMC_DISCOUNT_RATIO,
    SMC_EQUAL_LEVEL_ATR_MULTIPLIER,
    SMC_PREMIUM_RATIO,
    SMC_SWING_PERIOD,
    SQUEEZE_MOMENTUM_BB_LENGTH,
    SQUEEZE_MOMENTUM_KC_LENGTH,
    SQUEEZE_MOMENTUM_KC_MULT,
    SQUEEZE_MOMENTUM_MIN_BARS,
    STOCHASTIC_D_PERIOD,
    STOCHASTIC_K_PERIOD,
    STOCHASTIC_OVERBOUGHT_LEVEL,
    STOCHASTIC_OVERSOLD_LEVEL,
    STOCHASTIC_SMOOTHING,
    STOCH_RSI_D_PERIOD,
    STOCH_RSI_K_PERIOD,
    STOCH_RSI_OVERBOUGHT_LEVEL,
    STOCH_RSI_OVERSOLD_LEVEL,
    STOCH_RSI_RSI_PERIOD,
    STOCH_RSI_STOCH_PERIOD,
    SUPERTREND_ATR_PERIOD,
    SUPERTREND_MULTIPLIER,
    UNMATCHED_SKILL_CONFIDENCE_WEIGHT,
    VP_DEFAULT_ROW_SIZE,
    VP_MIN_BARS,
    VP_VALUE_AREA_PERCENTAGE,
    WILLIAMS_R_DEFAULT_PERIOD,
} from './domain/indicators/constants';

// Infrastructure interfaces are type-only and safe for browser consumers.
export type { CacheProvider } from './infrastructure/cache/types';
export type { SkillsProvider } from './infrastructure/skills/types';
export type { FmpConfig } from './infrastructure/fmp/types';
export type { JobStatus, JobMeta } from './infrastructure/jobs/types';
export type {
    MarketDataProvider,
    GetBarsOptions,
    AcquireReanalyzeCooldownResult,
} from './infrastructure/market/types';
export type {
    GeminiRole,
    GeminiContents,
    GeminiContent,
    GeminiPart,
    CallGeminiWithKeyFallbackOptions,
} from './infrastructure/ai/types';
export type { ChatTokenStore } from './infrastructure/chat/types';
export type {
    ChatActionResult,
    ChatErrorCode,
    RequestChatCompletionParams,
    RequestChatCompletionDependencies,
    RequestChatCompletionResult,
} from './application/chat/types';
export type { SubmitAnalysisGatedResult } from './application/market/types';
export type {
    AnalysisLimitError,
    AnalysisLimitErrorCode,
    ChatbotLimitError,
    ChatbotLimitErrorCode,
} from './application/usage';

// Domain types
export type {
    AnalysisSignalType,
    ModelId,
    Timeframe,
    Tier,
    TierConfig,
    TierFeatureFlags,
    TierFeatureLimits,
    TierInfoDepth,
    TierLimitedFeature,
    TierModel,
    UserTierContext,
    Bar,
    IndicatorResult,
    MACDResult,
    BollingerResult,
    DMIResult,
    StochasticResult,
    StochRSIResult,
    VolumeProfileRow,
    VolumeProfileResult,
    IchimokuResult,
    IchimokuFuturePoint,
    ParabolicSARResult,
    SupertrendResult,
    KeltnerChannelResult,
    DonchianChannelResult,
    BuySellVolumeResult,
    SqueezeMomentumResult,
    SMCResult,
    SMCZone,
    SMCSwingPoint,
    SMCOrderBlock,
    SMCFairValueGap,
    SMCEqualLevel,
    SMCStructureBreak,
    SMCStructureDirection,
    SMCBreakType,
    SMCSwingPointType,
    SMCZoneType,
    Skill,
    SkillType,
    SkillCategory,
    SkillChartDisplay,
    SkillDisplay,
    ChartDisplayType,
    Signal,
    SignalType,
    SignalDirection,
    SignalPhase,
    ConfirmedSignalType,
    ExpectedSignalType,
    TrendState,
    Trend,
    RiskLevel,
    TrendDirection,
    PriceTrend,
    AnalysisResponse,
    FilteredActionRecommendation,
    FilteredAnalysisResponse,
    FilteredAnalysisResult,
    AnalysisSignal,
    SignalStrength,
    BacktestCase,
    BacktestMeta,
    BacktestRiskLevel,
    ReconciledActionLevels,
    IndicatorGuideResult,
    KeyLevel,
    KeyLevels,
    ClusteredKeyLevel,
    ClusteredKeyLevels,
    KeyPrice,
    QuadrantKey,
    PriceTarget,
    PriceScenario,
    PriceTargets,
    PatternSummary,
    PatternResult,
    PatternLine,
    StrategyResult,
    CandlePatternSummary,
    Trendline,
    TrendlineDirection,
    TrendlinePoint,
    ActionRecommendation,
    EntryRecommendation,
    ReconciledActionLineData,
    ValidatedActionPrices,
    ChatMessage,
    ChatLoadingPhase,
    ChatModel,
    ChatPromptPayload,
    ChatSession,
    MarketIndexData,
    MarketSectorData,
    MarketBriefingResponse,
    MarketBriefingSectorAnalysis,
    MarketBriefingVolatilityAnalysis,
    CrossDirection,
    CandlePattern,
    MultiCandlePattern,
    CandlePatternEntry,
    SingleCandlePatternEntry,
    MultiCandlePatternEntry,
    PromptConfig,
    TickerBase,
    KoreanTickerEntry,
    TickerSearchResult,
    AssetInfo,
    TickerCategory,
    CategoryId,
    SkillCounts,
    SkillShowcaseItem,
    IndexTicker,
    SectorEtf,
    SectorGroupDef,
    SectorStock,
    SectorSignalsResult,
    StockSignalResult,
    StockWithConflict,
    ConflictInfo,
    ConflictResolution,
    DashboardTimeframe,
    MarketQuote,
    MarketSummaryData,
    MarketSummaryWithBriefing,
    BarsData,
    PollAnalysisResult,
    SubmitBriefingResult,
    PollBriefingResult,
    LevelSource,
    ResolvedLevel,
    ReconcileResult,
    ReconciledTpEntry,
    RunAnalysisInput,
    RawAnalysisResponse,
    BacktestSignalResult,
    BacktestAiResult,
    BacktestExitReason,
    BacktestAiPriceTarget,
    BacktestAiEntryRecommendation,
    BacktestAiAnalysis,
    BacktestData,
    WaitUntil,
} from './domain/types';
