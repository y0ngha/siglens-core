// =============================================================================
// Tier 1 — Application Entrypoints
// =============================================================================
// Use-case functions called directly from Server Actions / API handlers / workers.

// Market analysis
export { fetchBarsWithIndicators } from './application/market/barsApi';
export { submitAnalysis } from './application/market/submitAnalysis';
export { pollAnalysis } from './application/market/pollAnalysis';
export { cancelAnalysisJob } from './application/market/cancelAnalysisJob';
export { submitBriefing } from './application/market/submitBriefing';
export { pollBriefing } from './application/market/pollBriefing';

// Dashboard
export { getMarketSummary } from './application/dashboard/getMarketSummary';
export { getMarketSummaryWithBriefing } from './application/dashboard/getMarketSummaryWithBriefing';
export { getSectorSignals } from './application/dashboard/sectorSignals';

// Ticker
export { getAssetInfo } from './application/ticker/getAssetInfo';
export { searchTicker } from './application/ticker/searchTicker';
export type { BackgroundTaskOptions } from './application/types';

// Chat
export { requestChatCompletion } from './application/chat/requestChatCompletion';
export {
    GEMINI_2_5_FLASH_MODEL,
    GEMINI_2_5_FLASH_LITE_MODEL,
    GEMINI_2_5_PRO_MODEL,
    VALID_CHAT_MODELS,
} from './application/chat/constants';

// Auth
export {
    deleteAccount,
    findUserBySessionToken,
    loginUser,
    logoutUser,
    registerUser,
    socialLoginUser,
} from './application/auth';
export {
    createUserTierContext,
    getUserTier,
    setUserTier,
} from './application/tier';

// =============================================================================
// Tier 2 — Domain Building Blocks
// =============================================================================
// High-level pure-function entry points. Individual indicators / detectors are
// internal — call calculateIndicators() / detectSignals() instead.

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

// Tier gating
export {
    getAllowedModels,
    getTierLimit,
    isAllowed,
    isInfoDepthAllowed,
    isModelAllowed,
    isTier,
    isTimeframeAllowed,
} from './domain/tier';

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
export { createCacheProvider } from './infrastructure/cache/redis';
export {
    ANALYSIS_CACHE_TTL,
    MARKET_BRIEFING_CACHE_TTL,
    CACHE_EXPIRY_HOUR_KST,
    buildAnalysisCacheKey,
    buildBriefingCacheKey,
    computeEffectiveTtl,
} from './infrastructure/cache/config';

// Market data providers
export { createMarketDataProvider } from './infrastructure/market/factory';

// AI provider (Gemini)
export { callGeminiWithKeyFallback } from './infrastructure/ai/gemini';
export { AI_SYSTEM_PROMPT } from './infrastructure/ai/utils';

// Chat token store
export {
    CHAT_TOKEN_LIMIT,
    CHAT_TOKEN_TTL_SEC,
    createChatTokenStore,
    hashClientIp,
} from './infrastructure/chat/tokenStore';

// Skills loader
export { FileSkillsLoader } from './infrastructure/skills/loader';

// Config readers
export { readFmpConfig, tryReadFmpConfig } from './infrastructure/fmp/config';

// Database
export {
    createDatabaseClient,
    DrizzleSessionRepository,
    DrizzleUsageLogRepository,
    DrizzleUserRepository,
} from './infrastructure/db';

// Password adapters
export {
    bcryptPasswordHasher,
    bcryptPasswordVerifier,
} from './infrastructure/auth';

// Job queue (worker-side primitives)
export {
    setJobMeta,
    getJobMeta,
    getJobStatus,
    setJobStatus,
    getJobResult,
    setJobResult,
    getJobError,
    setJobError,
    cancelJob,
    isJobCancelled,
    cleanupJob,
} from './infrastructure/jobs/queue';

// Reanalyze cooldown
export {
    tryAcquireReanalyzeCooldown,
    releaseReanalyzeCooldown,
    getReanalyzeCooldownMs,
} from './infrastructure/market/reanalyzeCooldown';

// =============================================================================
// Tier 4 — Public Types & Constants
// =============================================================================

// Auth session cookie constants
export {
    AUTH_SESSION_COOKIE_NAME,
    DEFAULT_AUTH_COOKIE_PATH,
    DEFAULT_AUTH_COOKIE_SAME_SITE,
    DEFAULT_SESSION_TTL_SECONDS,
} from './application/auth';

// Database schema objects / enum values
export {
    OAUTH_PROVIDER_VALUES,
    USAGE_ACTION_TYPE_VALUES,
    USER_TIER_VALUES,
    assetTranslations,
    koreanTickers,
    oauthAccounts,
    oauthProviderEnum,
    sessions,
    usageActionTypeEnum,
    usageLogs,
    users,
    userTierEnum,
} from './infrastructure/db';

// Tier gating constants
export { DEFAULT_TIER, TIER_CONFIG } from './domain/tier';

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

// Infrastructure interfaces
export type { CacheProvider } from './infrastructure/cache/types';
export type { ChatTokenStore } from './infrastructure/chat/types';
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
export type {
    DatabaseConfig,
    CreateUsageLogInput,
    OAuthProvider,
    SiglensDatabase,
    UsageActionType,
    UsageLogRepository,
    UserTierRepository,
    UserTier,
} from './infrastructure/db';
export type {
    AuthSessionCookie,
    AuthSessionOptions,
    DeleteAccountDependencies,
    DeleteAccountError,
    DeleteAccountErrorCode,
    DeleteAccountInput,
    DeleteAccountOptions,
    DeleteAccountResult,
    FindUserBySessionTokenDependencies,
    FindUserBySessionTokenOptions,
    LoginUserDependencies,
    LoginUserError,
    LoginUserErrorCode,
    LoginUserInput,
    LoginUserOptions,
    LoginUserResult,
    LogoutUserDependencies,
    LogoutUserInput,
    LogoutUserOptions,
    LogoutUserResult,
    RegisterUserError,
    RegisterUserErrorCode,
    RegisterUserErrorField,
    RegisterUserInput,
    RegisterUserResult,
    SocialLoginUserDependencies,
    SocialLoginUserError,
    SocialLoginUserErrorCode,
    SocialLoginUserInput,
    SocialLoginUserOptions,
    SocialLoginUserResult,
} from './application/auth';
export type {
    CreateUserTierContextInput,
    GetUserTierInput,
    SetUserTierError,
    SetUserTierErrorCode,
    SetUserTierInput,
    SetUserTierResult,
    UserTierDependencies,
} from './application/tier';
export type {
    AuthSessionRecord,
    AuthUserRecord,
    CreateEmailUserInput,
    CreateOAuthUserInput,
    CreateSessionInput,
    EmailAuthUserRecord,
    EmailAuthUserRepository,
    OAuthUserRepository,
    SessionRepository,
    UserRepository,
} from './infrastructure/db';
export type { PasswordHasher, PasswordVerifier } from './infrastructure/auth';

// Application types
export type {
    ChatActionResult,
    ChatErrorCode,
    RequestChatCompletionParams,
    RequestChatCompletionDependencies,
    RequestChatCompletionResult,
} from './application/chat/types';

// Domain types
export type {
    AnalysisSignalType,
    Timeframe,
    ModelId,
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
    SkillCounts,
    SkillShowcaseItem,
    AssetInfo,
    TickerCategory,
    CategoryId,
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
    SubmitAnalysisResult,
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
