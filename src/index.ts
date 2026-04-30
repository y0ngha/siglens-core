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
export type { BackgroundTaskOptions } from './application/types';

// Chat
export {
    GEMINI_2_5_FLASH_LITE_MODEL,
    GEMINI_2_5_FLASH_MODEL,
    GEMINI_2_5_PRO_MODEL,
    VALID_CHAT_MODELS,
} from './application/chat/constants';
export { requestChatCompletion } from './application/chat/requestChatCompletion';

// Auth
export {
    confirmPasswordReset,
    deleteAccount,
    findUserBySessionToken,
    loginUser,
    logoutUser,
    registerUser,
    requestEmailVerification,
    requestPasswordReset,
    socialLoginUser,
    verifyEmail,
} from './application/auth';
export {
    createUserTierContext,
    getUserTier,
    setUserTier,
} from './application/tier';
export { checkAnalysisLimit, checkChatbotLimit } from './application/usage';

// =============================================================================
// Tier 2 — Domain Building Blocks
// =============================================================================
// High-level pure-function entry points. Individual indicators / detectors are
// internal — call calculateIndicators() / detectSignals() instead.

// Aggregate calculators / detectors
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
    calculateIndicators,
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

// Tier gating
export { filterAnalysisResult } from './domain/analysis/filterAnalysisResult';
export {
    getAllowedModels,
    getAllowedTimeframes,
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
    DrizzleAssetTranslationRepository,
    DrizzleKoreanTickerRepository,
    DrizzleSessionRepository,
    DrizzleUsageLogRepository,
    DrizzleUsageRepository,
    DrizzleUserRepository,
    hashUsageIp,
} from './infrastructure/db';

// Password adapters
export {
    bcryptPasswordHasher,
    bcryptPasswordVerifier,
} from './infrastructure/auth';

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

// Auth session cookie constants
export {
    AUTH_SESSION_COOKIE_NAME,
    DEFAULT_AUTH_COOKIE_PATH,
    DEFAULT_AUTH_COOKIE_SAME_SITE,
    DEFAULT_SESSION_TTL_SECONDS,
} from './application/auth';

// Database schema objects / enum values
export {
    assetTranslations,
    koreanTickers,
    OAUTH_PROVIDER_VALUES,
    oauthAccounts,
    oauthProviderEnum,
    sessions,
    USAGE_ACTION_TYPE_VALUES,
    usageActionTypeEnum,
    usageLogs,
    USER_TIER_VALUES,
    users,
    userTierEnum,
} from './infrastructure/db';

// Tier gating constants
export { DEFAULT_TIER, TIER_CONFIG } from './domain/tier';

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

// Email
export { createEmailTokenStore } from './infrastructure/email/redis';
export type {
    EmailDispatcher,
    EmailTokenPurpose,
    EmailTokenStore,
    EmailTokenValue,
} from './infrastructure/email/types';

// Infrastructure interfaces
export type {
    AuthSessionCookie,
    AuthSessionOptions,
    ConfirmPasswordResetDependencies,
    ConfirmPasswordResetError,
    ConfirmPasswordResetErrorCode,
    ConfirmPasswordResetInput,
    ConfirmPasswordResetResult,
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
    RegisterUserDependencies,
    RegisterUserError,
    RegisterUserErrorCode,
    RegisterUserErrorField,
    RegisterUserInput,
    RegisterUserResult,
    RequestEmailVerificationDependencies,
    RequestEmailVerificationInput,
    RequestEmailVerificationOptions,
    RequestEmailVerificationResult,
    RequestPasswordResetDependencies,
    RequestPasswordResetInput,
    RequestPasswordResetOptions,
    RequestPasswordResetResult,
    SocialLoginUserDependencies,
    SocialLoginUserError,
    SocialLoginUserErrorCode,
    SocialLoginUserInput,
    SocialLoginUserOptions,
    SocialLoginUserResult,
    VerifyEmailDependencies,
    VerifyEmailError,
    VerifyEmailErrorCode,
    VerifyEmailInput,
    VerifyEmailResult,
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
    AnalysisLimitError,
    AnalysisLimitErrorCode,
    ChatbotLimitError,
    ChatbotLimitErrorCode,
    UsageLimitDependencies,
    UsageLimitError,
    UsageLimitErrorCode,
    UsageLimitInput,
} from './application/usage';
export type {
    CallGeminiWithKeyFallbackOptions,
    GeminiContent,
    GeminiContents,
    GeminiPart,
    GeminiRole,
} from './infrastructure/ai/types';
export type { PasswordHasher, PasswordVerifier } from './infrastructure/auth';
export type { CacheProvider } from './infrastructure/cache/types';
export type { ChatTokenStore } from './infrastructure/chat/types';
export type {
    AssetTranslationRecord,
    AssetTranslationRepository,
    AuthSessionRecord,
    AuthUserRecord,
    CreateEmailUserInput,
    CreateOAuthUserInput,
    CreateSessionInput,
    CreateUsageLogInput,
    DatabaseConfig,
    EmailAuthUserRecord,
    EmailAuthUserRepository,
    KoreanTickerRepository,
    OAuthProvider,
    OAuthUserRepository,
    RecordUsageInput,
    SessionRepository,
    SiglensDatabase,
    UsageActionType,
    UsageCounts,
    UsageLogRecord,
    UsageLogRepository,
    UsageRepository,
    UserRepository,
    UserTier,
    UserTierRepository,
} from './infrastructure/db';
export type { FmpConfig } from './infrastructure/fmp/types';
export type { JobMeta, JobStatus } from './infrastructure/jobs/types';
export type {
    AcquireReanalyzeCooldownResult,
    GetBarsOptions,
    MarketDataProvider,
} from './infrastructure/market/types';
export type { SkillsProvider } from './infrastructure/skills/types';

// Application types
export type {
    ChatActionResult,
    ChatErrorCode,
    RequestChatCompletionDependencies,
    RequestChatCompletionParams,
    RequestChatCompletionResult,
} from './application/chat/types';
export type {
    AnalysisUsageOptions,
    SubmitAnalysisGatedResult,
    SubmitAnalysisOptions,
    SubmitAnalysisErrorResult,
    TierGateErrorResult,
    TierTimeframeAccessError,
} from './application/market/types';

// Domain types
export type {
    ActionRecommendation,
    AnalysisResponse,
    AnalysisSignal,
    AnalysisSignalType,
    AssetInfo,
    BacktestAiAnalysis,
    BacktestAiEntryRecommendation,
    BacktestAiPriceTarget,
    BacktestAiResult,
    BacktestCase,
    BacktestData,
    BacktestExitReason,
    BacktestMeta,
    BacktestRiskLevel,
    BacktestSignalResult,
    Bar,
    BarsData,
    BollingerResult,
    BuySellVolumeResult,
    CandlePattern,
    CandlePatternEntry,
    CandlePatternSummary,
    CategoryId,
    ChartDisplayType,
    ChatLoadingPhase,
    ChatMessage,
    ChatModel,
    ChatPromptPayload,
    ChatSession,
    ClusteredKeyLevel,
    ClusteredKeyLevels,
    ConfirmedSignalType,
    ConflictInfo,
    ConflictResolution,
    CrossDirection,
    DashboardTimeframe,
    DMIResult,
    DonchianChannelResult,
    EntryRecommendation,
    FilteredActionRecommendation,
    FilteredAnalysisResponse,
    FilteredAnalysisResult,
    ExpectedSignalType,
    IchimokuFuturePoint,
    IchimokuResult,
    EmailMessage,
    IndexTicker,
    IndicatorGuideResult,
    IndicatorResult,
    KeltnerChannelResult,
    KeyLevel,
    KeyLevels,
    KeyPrice,
    KoreanTickerEntry,
    LevelSource,
    MACDResult,
    MarketBriefingResponse,
    MarketBriefingSectorAnalysis,
    MarketBriefingVolatilityAnalysis,
    MarketIndexData,
    MarketQuote,
    MarketSectorData,
    MarketSummaryData,
    MarketSummaryWithBriefing,
    ModelId,
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
    QuadrantKey,
    RawAnalysisResponse,
    ReconciledActionLevels,
    ReconciledActionLineData,
    ReconciledTpEntry,
    ReconcileResult,
    ResolvedLevel,
    RiskLevel,
    RunAnalysisInput,
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
    SkillCounts,
    SkillDisplay,
    SkillShowcaseItem,
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
    SubmitBriefingResult,
    SupertrendResult,
    TickerBase,
    TickerCategory,
    TickerSearchResult,
    Tier,
    TierConfig,
    TierFeatureFlags,
    TierFeatureLimits,
    TierInfoDepth,
    TierLimitedFeature,
    TierModel,
    Timeframe,
    Trend,
    TrendDirection,
    Trendline,
    TrendlineDirection,
    TrendlinePoint,
    TrendState,
    UserTierContext,
    ValidatedActionPrices,
    VolumeProfileResult,
    VolumeProfileRow,
    WaitUntil,
} from './domain/types';
