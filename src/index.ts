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

// Application background-task options (used by market / dashboard use-cases)
export type { BackgroundTaskOptions } from './application/types';

// Chat
export {
    GEMINI_2_5_FLASH_LITE_MODEL,
    GEMINI_2_5_FLASH_MODEL,
    GEMINI_2_5_PRO_MODEL,
    VALID_CHAT_MODELS,
} from './application/chat/constants';
export { requestChatCompletion } from './application/chat/requestChatCompletion';

export { checkAnalysisLimit, checkChatbotLimit } from './application/usage';

// Fundamental analysis use-cases
export { cancelFundamentalAnalysisJob } from './application/fundamental/cancelFundamentalAnalysisJob';
export { pollFundamentalAnalysis } from './application/fundamental/pollFundamentalAnalysis';
export { submitFundamentalAnalysis } from './application/fundamental/submitFundamentalAnalysis';

// News analysis use-cases
export { cancelNewsAnalysisJob } from './application/news/cancelNewsAnalysisJob';
export { pollNewsAnalysis } from './application/news/pollNewsAnalysis';
export { pollNewsCardAnalysis } from './application/news/pollNewsCardAnalysis';
export { submitNewsAnalysis } from './application/news/submitNewsAnalysis';
export { submitNewsCardAnalysis } from './application/news/submitNewsCardAnalysis';

// Overall analysis use-cases
export { cancelOverallAnalysisJob } from './application/overall/cancelOverallAnalysisJob';
export { pollOverallAnalysis } from './application/overall/pollOverallAnalysis';
export { submitOverallAnalysis } from './application/overall/submitOverallAnalysis';

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
    computeFearGreedHistory,
    computeFearGreedIndex,
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
export { buildFundamentalAnalysisPrompt } from './domain/analysis/fundamentalPrompt';
export { buildMarketBriefingPrompt } from './domain/analysis/marketBriefingPrompt';
export { buildNewsAnalysisPrompt } from './domain/analysis/newsPrompt';
export { buildNewsCardAnalysisPrompt } from './domain/analysis/newsCardPrompt';
export { buildOverallAnalysisPrompt } from './domain/analysis/overallPrompt';
export { buildAnalysisPrompt } from './domain/analysis/prompt';
export { buildChatPrompt } from './domain/chat/buildChatPrompt';
export { AI_SYSTEM_PROMPT } from './domain/analysis/systemPrompt';

// Response normalization
export { enrichAnalysisWithConfidence } from './domain/analysis/confidence';
export { normalizeMarketBriefing } from './domain/analysis/normalizeMarketBriefing';
export { normalizeFundamentalAnalysisResponse } from './domain/analysis/normalizeFundamental';
export { normalizeFundamentalSnapshot } from './domain/analysis/normalizeFundamentalSnapshot';
export {
    normalizeNewsAnalysisResponse,
    normalizeNewsCardAnalysis,
} from './domain/analysis/normalizeNews';
export { normalizeOverallAnalysisResponse } from './domain/analysis/normalizeOverall';

// Model spec helpers
export {
    getProvider,
    getThinkingBudgetSequence,
    isChatGPTModel,
    isClaudeModel,
    isGeminiModel,
} from './domain/analysis/modelSpecs';

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
    type PatternTrend,
} from './domain/analysis/candle-trend';

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

// LLM provider mapping
export { getProviderForModel } from './domain/llm/providers';

// Tier gating
export { filterAnalysisResult } from './domain/analysis/filterAnalysisResult';
export {
    getAllowedModels,
    getAllowedTimeframes,
    getTierLimit,
    isAllowed,
    isInfoDepthAllowed,
    isFreeModel,
    isModelAllowed,
    isPremiumModel,
    isTier,
    isTimeframeAllowed,
    requiresByokKey,
} from './domain/tier';

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

// LLM response JSON parsing with `jsonrepair` salvage — used by worker
// codebases that parse raw LLM JSON before storing job results.
export { extractJsonWithRepair } from './infrastructure/ai/extractJsonWithRepair';

// Market data providers
export { createMarketDataProvider } from './infrastructure/market/factory';

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
export { hashUsageIp } from './infrastructure/usage/hash';

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

// LLM provider constants
export { LLM_PROVIDER_VALUES } from './domain/llm/constants';

// Tier gating constants
export { DEFAULT_TIER, TIER_CONFIG } from './domain/tier';

// Model specs (single source of truth for AI SDK call parameters)
export {
    DISABLED_THINKING_BUDGET,
    MODEL_SPECS,
    THINKING_BUDGET_FALLBACK_STEPS,
    type ChatGPTModelId,
    type ClaudeModelId,
    type GeminiModelId,
} from './domain/analysis/modelSpecs';
export type {
    ActiveModelId,
    AIProvider,
    ChatGPTModelSpec,
    ClaudeReasoningModelSpec,
    ClaudeSamplingModelSpec,
    EffortLevel,
    GeminiModelSpec,
    ModelSpec,
} from './domain/types';
export {
    isClaudeReasoningModelSpec,
    isClaudeSamplingModelSpec,
    isReasoningModelSpec,
    isSamplingModelSpec,
} from './domain/types';

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
    AiContents,
    CallAiProviderOptions,
    GeminiContent,
    GeminiPart,
    GeminiRole,
} from './infrastructure/ai/types';
export type { CacheProvider } from './domain/ports/cache';
export type { ChatTokenStore } from './infrastructure/chat/types';
export type {
    CreateUsageLogInput,
    RecordUsageInput,
    UsageActionType,
    UsageCounts,
    UsageLogRecord,
    UsageLogRepository,
    UsageRepository,
    UserTier,
    UserTierRepository,
} from './infrastructure/db';
export type { FmpConfig } from './infrastructure/fmp/types';
export type { FundamentalDataProvider } from './infrastructure/fundamental/types';
export type { JobMeta, JobStatus } from './infrastructure/jobs/types';
export type {
    GetBarsOptions,
    MarketDataProvider,
} from './domain/ports/marketDataProvider';
export type { AcquireReanalyzeCooldownResult } from './infrastructure/market/types';
export type { NewsProvider, NewsTimeRange } from './infrastructure/news/types';
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
    FundamentalAnalysisUsageOptions,
    PollFundamentalAnalysisResult,
    SubmitFundamentalAnalysisApiKeyRequiredError,
    SubmitFundamentalAnalysisCached,
    SubmitFundamentalAnalysisFetchError,
    SubmitFundamentalAnalysisLimitError,
    SubmitFundamentalAnalysisMissNoTrigger,
    SubmitFundamentalAnalysisOptions,
    SubmitFundamentalAnalysisResult,
    SubmitFundamentalAnalysisSubmitted,
} from './application/fundamental/types';
export type {
    AnalysisUsageOptions,
    SubmitAnalysisGatedResult,
    SubmitAnalysisMissNoTrigger,
    SubmitAnalysisOptions,
    SubmitAnalysisErrorResult,
    TierGateErrorResult,
    TierTimeframeAccessError,
    UserApiKeyRequiredError,
} from './application/market/types';
export type {
    NewsAnalysisUsageOptions,
    PollNewsAnalysisResult,
    PollNewsCardAnalysisResult,
    SubmitNewsAnalysisApiKeyRequiredError,
    SubmitNewsAnalysisCached,
    SubmitNewsAnalysisLimitError,
    SubmitNewsAnalysisMissNoTrigger,
    SubmitNewsAnalysisNoNewsError,
    SubmitNewsAnalysisOptions,
    SubmitNewsAnalysisResult,
    SubmitNewsAnalysisSubmitted,
    SubmitNewsCardAnalysisOptions,
    SubmitNewsCardAnalysisResult,
    SubmitNewsCardAnalysisSubmitted,
    SubmitNewsCardAnalysisCached,
} from './application/news/types';
export type {
    OverallAxis,
    PollOverallAnalysisResult,
    SubmitOverallAnalysisOptions,
    SubmitOverallAnalysisResult,
    SubmitOverallAnalysisCached,
    SubmitOverallAnalysisPendingDependencies,
    SubmitOverallAnalysisSubmitted,
    SubmitOverallAnalysisError,
    SubmitOverallAnalysisLimitError,
    SubmitOverallAnalysisApiKeyRequiredError,
    SubmitOverallAnalysisMissNoTrigger,
    DependencyState,
    DependencyStateCached,
    DependencyStatePending,
    DependencyStateError,
    DependencyStateMissNoTrigger,
    OverallDependencyInputs,
} from './application/overall/types';

// Domain types

export type {
    ActionRecommendation,
    AnalysisResponse,
    AnalysisSignal,
    AnalysisSignalType,
    CurrentAnalysisContext,
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
    ChartDisplayType,
    ChatLoadingPhase,
    ChatMessage,
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
    EarningsCalendarItem,
    EarningsReport,
    EnrichedNewsItem,
    DonchianChannelResult,
    ComputeFearGreedOptions,
    FearGreedConfidence,
    FearGreedFactor,
    FearGreedFactorKey,
    FearGreedGroup,
    FearGreedGroupName,
    FearGreedHistoryPoint,
    FearGreedLabel,
    FearGreedSnapshot,
    FearGreedWarning,
    FundamentalAnalysisResponse,
    FundamentalAnalystEstimateInput,
    FundamentalCashFlowInput,
    FundamentalCategoryAssessment,
    FundamentalCategory,
    FundamentalFinancialScoresInput,
    FundamentalFutureDirection,
    FundamentalGradesConsensusInput,
    FundamentalGrowth,
    FundamentalGrowthInput,
    FundamentalHealth,
    FundamentalPeer,
    FundamentalPeerInput,
    FundamentalPriceTargetConsensusInput,
    FundamentalPriceTargetSummaryInput,
    FundamentalProfitability,
    FundamentalRatiosInput,
    FundamentalSectorDirection,
    FundamentalSectorHistoricalInput,
    FundamentalSectorPerformanceInput,
    FundamentalSentiment,
    FundamentalSnapshot,
    FundamentalProfile,
    FundamentalProfileInput,
    FundamentalValuation,
    FundamentalValuationMetrics,
    NormalizeFundamentalSnapshotInput,
    PriceTargetAvg,
    GradesAction,
    GradesConsensus,
    GradesEvent,
    EntryRecommendation,
    FilteredActionRecommendation,
    FilteredAnalysisResponse,
    FilteredAnalysisResult,
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
    LevelSource,
    MACDResult,
    MarketBriefingResponse,
    NewsAnalysisResponse,
    NewsCardAnalysis,
    NewsCategory,
    NewsImpact,
    NewsItem,
    NewsSentiment,
    MarketBriefingSectorAnalysis,
    MarketBriefingVolatilityAnalysis,
    MarketIndexData,
    MarketQuote,
    MarketSectorData,
    MarketSummaryData,
    MarketSummaryWithBriefing,
    ChatModel,
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
    OverallAnalysisResponse,
    OverallScenario,
    OverallScenarioName,
    PriceTargetConsensus,
    PriceTargetSummary,
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
    SectorHistoricalPoint,
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
    LlmProvider,
    ValidatedActionPrices,
    VolumeProfileResult,
    VolumeProfileRow,
    WaitUntil,
} from './domain/types';

// Options analysis — domain types (including expiration slot types and the
// `buildOptionsAnalysisPrompt` input shape). Routed through the
// `./domain/types` barrel so every domain type follows the same import path.
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
} from './domain/types';

// Options analysis — provider interface (implementation injected by consumer)
export type { OptionsDataProvider } from './infrastructure/options/types';

// Options analysis — Tier 4 constant (canonical chip slot table consumed by
// frontends for rendering and routing).
export { EXPIRATION_SLOTS } from './domain/options/expirationSlots';

// --- Tier 2 — Options domain functions ---
//
// Aggregate entry point + the consumer-facing utilities that have no good
// substitute on the aggregate:
//
//   - summarizeChainForLlm: the canonical metrics entry point. Reads
//     summarize().maxPain / .putCallRatio / .impliedMovePercent /
//     .atmImpliedVolatility instead of importing the underlying calculators.
//   - aggregateOpenInterest: strike-by-strike OI map used by visualization
//     (the summary only carries the top-3 strikes; charts need the full
//     distribution).
//   - sanitizeOptionsChain: chain-level data-quality gate called by
//     OptionsDataProvider implementations (which live in consumer apps).
//   - mapExpirationsToSlots: pairs provider expirations to the EXPIRATION_SLOTS
//     chip table.
//
// The individual `calculate*` helpers stay internal — consumers should read
// the derived fields from OptionsExpirationMetrics rather than re-running
// the math.
export { summarizeChainForLlm } from './domain/options/summarizeChainForLlm';
export { aggregateOpenInterest } from './domain/options/aggregateOpenInterest';
export { sanitizeOptionsChain } from './domain/options/sanitizeOptionsChain';
export { mapExpirationsToSlots } from './domain/options/expirationSlots';

// Options analysis — normalize + prompt (use-case layer will add submit/poll in Phase 2)
export { normalizeOptionsAnalysisResponse } from './domain/analysis/normalizeOptions';
export { buildOptionsAnalysisPrompt } from './domain/options/optionsPrompt';

// Options analysis — application use-cases (submit + poll, cache key builder)
export {
    submitOptionsAnalysis,
    pollOptionsAnalysis,
    buildOptionsCacheKey,
} from './application/options';
export type {
    SubmitOptionsAnalysisOptions,
    SubmitOptionsAnalysisResult,
    SubmitOptionsAnalysisCached,
    SubmitOptionsAnalysisSubmitted,
    SubmitOptionsAnalysisMissNoTrigger,
    SubmitOptionsAnalysisLimitError,
    SubmitOptionsAnalysisNoChainsError,
    SubmitOptionsAnalysisApiKeyRequiredError,
    PollOptionsAnalysisResult,
    PollOptionsAnalysisProcessing,
    PollOptionsAnalysisDone,
    PollOptionsAnalysisError,
} from './application/options';
