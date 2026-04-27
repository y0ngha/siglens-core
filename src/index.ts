// =============================================================================
// Tier 1 — Application Entrypoints
// =============================================================================
// Use-case functions called directly from Server Actions / API handlers / workers.

// Market analysis
export { fetchBarsWithIndicators } from './application/market/barsApi';
export { cancelAnalysisJob } from './application/market/cancelAnalysisJob';
export { pollAnalysis } from './application/market/pollAnalysis';
export { pollBriefing } from './application/market/pollBriefing';
export { submitAnalysis } from './application/market/submitAnalysis';
export { submitBriefing } from './application/market/submitBriefing';

// Dashboard
export { getMarketSummary } from './application/dashboard/getMarketSummary';
export { getMarketSummaryWithBriefing } from './application/dashboard/getMarketSummaryWithBriefing';
export { getSectorSignals } from './application/dashboard/sectorSignals';

// Ticker
export { getAssetInfo } from './application/ticker/getAssetInfo';
export { searchTicker } from './application/ticker/searchTicker';

// Auth
export { registerUser } from './application/auth';

// =============================================================================
// Tier 2 — Domain Building Blocks
// =============================================================================
// High-level pure-function entry points. Individual indicators / detectors are
// internal — call calculateIndicators() / detectSignals() instead.

// Aggregate calculators / detectors
export { calculateIndicators } from './domain/indicators';
export { classifyTrend, detectSignals } from './domain/signals';

// Prompt builders
export { buildMarketBriefingPrompt } from './domain/analysis/marketBriefingPrompt';
export { buildAnalysisPrompt } from './domain/analysis/prompt';
export { buildChatPrompt } from './domain/chat/buildChatPrompt';

// Response normalization
export { enrichAnalysisWithConfidence } from './domain/analysis/confidence';
export { normalizeMarketBriefing } from './domain/analysis/normalizeMarketBriefing';

// Candle patterns (used by UI for rendering and by prompt builders)
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
    findCandlePatternLabel,
    getCandlePatternLabel,
    getMultiCandlePatternLabel,
} from './domain/analysis/candle-labels';
export {
    EXCLUDED_SINGLE_PATTERNS,
    getMultiPatternTrend,
    getSinglePatternTrend,
} from './domain/analysis/candle-trend';
export type { PatternTrend } from './domain/analysis/candle-trend';

// Signal constants / detectors
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

// Analysis normalization / helpers
export {
    extractReconciledActionLines,
    validateActionPrices,
} from './domain/analysis/actionRecommendation';
export { postProcessAnalysisWithReconcile } from './domain/analysis/ai-levels';
export {
    clusterKeyLevels,
    validateKeyLevels,
} from './domain/analysis/keyLevels';
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
// Tier 3 — Infrastructure Factories & Config
// =============================================================================
// Dependency-injection entry points. Consumers create infra objects through
// these factories and supply env-derived configuration.

// Cache
export {
    ANALYSIS_CACHE_TTL,
    buildAnalysisCacheKey,
    buildBriefingCacheKey,
    CACHE_EXPIRY_HOUR_KST,
    computeEffectiveTtl,
    MARKET_BRIEFING_CACHE_TTL,
} from './infrastructure/cache/config';
export { createCacheProvider } from './infrastructure/cache/redis';

// Market data providers
export { createMarketDataProvider } from './infrastructure/market/factory';

// AI provider (Gemini)
export { callGeminiWithKeyFallback } from './infrastructure/ai/gemini';
export { AI_SYSTEM_PROMPT } from './infrastructure/ai/utils';

// Skills loader
export { FileSkillsLoader } from './infrastructure/skills/loader';

// Config readers
export { readFmpConfig, tryReadFmpConfig } from './infrastructure/fmp/config';

// Database factories & config
export {
    assetTranslations,
    createDatabaseClient,
    DrizzleUserRepository,
    getDatabaseClient,
    koreanTickers,
    OAUTH_PROVIDER_VALUES,
    oauthAccounts,
    oauthProviderEnum,
    readDatabaseConfig,
    sessions,
    tryGetDatabaseClient,
    tryReadDatabaseConfig,
    USAGE_ACTION_TYPE_VALUES,
    usageActionTypeEnum,
    usageLogs,
    USER_TIER_VALUES,
    users,
    userTierEnum,
} from './infrastructure/db';

// Job queue (worker-side primitives)
export {
    cancelJob,
    cleanupJob,
    getJobError,
    getJobMeta,
    getJobResult,
    getJobStatus,
    isJobCancelled,
    setJobError,
    setJobMeta,
    setJobResult,
    setJobStatus,
} from './infrastructure/jobs/queue';

// Reanalyze cooldown
export {
    getReanalyzeCooldownMs,
    releaseReanalyzeCooldown,
    tryAcquireReanalyzeCooldown,
} from './infrastructure/market/reanalyzeCooldown';

// =============================================================================
// Tier 4 — Public Types & Constants
// =============================================================================

// Dashboard tickers / sectors
export {
    DASHBOARD_TIMEFRAME_LABELS,
    DASHBOARD_TIMEFRAMES,
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
    STOCH_RSI_D_PERIOD,
    STOCH_RSI_K_PERIOD,
    STOCH_RSI_OVERBOUGHT_LEVEL,
    STOCH_RSI_OVERSOLD_LEVEL,
    STOCH_RSI_RSI_PERIOD,
    STOCH_RSI_STOCH_PERIOD,
    STOCHASTIC_D_PERIOD,
    STOCHASTIC_K_PERIOD,
    STOCHASTIC_OVERBOUGHT_LEVEL,
    STOCHASTIC_OVERSOLD_LEVEL,
    STOCHASTIC_SMOOTHING,
    SUPERTREND_ATR_PERIOD,
    SUPERTREND_MULTIPLIER,
    UNMATCHED_SKILL_CONFIDENCE_WEIGHT,
    VP_DEFAULT_ROW_SIZE,
    VP_MIN_BARS,
    VP_VALUE_AREA_PERCENTAGE,
    WILLIAMS_R_DEFAULT_PERIOD,
} from './domain/indicators/constants';

// Infrastructure interfaces
export type {
    RegisterUserError,
    RegisterUserErrorCode,
    RegisterUserErrorField,
    RegisterUserInput,
    RegisterUserResult,
} from './application/auth';
export type {
    CallGeminiWithKeyFallbackOptions,
    GeminiContent,
    GeminiContents,
    GeminiPart,
    GeminiRole,
} from './infrastructure/ai/types';
export type {
    AuthUserRecord,
    AuthUserTier,
    CreateEmailUserInput,
    PasswordHasher,
    UserRepository,
} from './infrastructure/auth';
export type { CacheProvider } from './infrastructure/cache/types';
export type {
    DatabaseClient,
    DatabaseConfig,
    OAuthProvider,
    SiglensDatabase,
    UsageActionType,
    UserTier,
} from './infrastructure/db';
export type { FmpConfig } from './infrastructure/fmp/types';
export type { JobMeta, JobStatus } from './infrastructure/jobs/types';
export type {
    AcquireReanalyzeCooldownResult,
    GetBarsOptions,
    MarketDataProvider,
} from './infrastructure/market/types';
export type { SkillsProvider } from './infrastructure/skills/types';

// Domain types
export type {
    ActionRecommendation,
    AnalysisResponse,
    AnalysisSignal,
    AssetInfo,
    Bar,
    BarsData,
    BollingerResult,
    BuySellVolumeResult,
    CandlePattern,
    CandlePatternEntry,
    CandlePatternSummary,
    CategoryId,
    ChartDisplayType,
    ChatMessage,
    ChatPromptPayload,
    ConfirmedSignalType,
    ConflictInfo,
    ConflictResolution,
    CrossDirection,
    DashboardTimeframe,
    DMIResult,
    DonchianChannelResult,
    EntryRecommendation,
    ExpectedSignalType,
    IchimokuFuturePoint,
    IchimokuResult,
    IndexTicker,
    IndicatorGuideResult,
    IndicatorResult,
    KeltnerChannelResult,
    KeyLevel,
    KeyLevels,
    KeyPrice,
    KoreanTickerEntry,
    MACDResult,
    MarketBriefingResponse,
    MarketBriefingSectorAnalysis,
    MarketBriefingVolatilityAnalysis,
    MarketIndexData,
    MarketQuote,
    MarketSectorData,
    MarketSummaryData,
    MarketSummaryWithBriefing,
    MultiCandlePattern,
    MultiCandlePatternEntry,
    ParabolicSARResult,
    PatternLine,
    PatternResult,
    PatternSummary,
    PollAnalysisResult,
    PollBriefingResult,
    PriceScenario,
    PriceTarget,
    PriceTargets,
    PriceTrend,
    PromptConfig,
    ReconciledActionLevels,
    RiskLevel,
    SectorEtf,
    SectorGroupDef,
    SectorSignalsResult,
    SectorStock,
    Signal,
    SignalDirection,
    SignalPhase,
    SignalStrength,
    SignalType,
    SingleCandlePatternEntry,
    Skill,
    SkillCategory,
    SkillChartDisplay,
    SkillDisplay,
    SkillType,
    SMCBreakType,
    SMCEqualLevel,
    SMCFairValueGap,
    SMCOrderBlock,
    SMCResult,
    SMCStructureBreak,
    SMCStructureDirection,
    SMCSwingPoint,
    SMCSwingPointType,
    SMCZone,
    SMCZoneType,
    SqueezeMomentumResult,
    StochasticResult,
    StochRSIResult,
    StockSignalResult,
    StockWithConflict,
    StrategyResult,
    SubmitAnalysisResult,
    SubmitBriefingResult,
    SupertrendResult,
    TickerBase,
    TickerCategory,
    TickerSearchResult,
    Timeframe,
    Trend,
    TrendDirection,
    Trendline,
    TrendlineDirection,
    TrendlinePoint,
    TrendState,
    VolumeProfileResult,
    VolumeProfileRow,
} from './domain/types';
