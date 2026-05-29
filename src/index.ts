// =============================================================================
// Tier 1 — Application Entrypoints
// =============================================================================
// Use-case functions called directly from Server Actions / API handlers / workers.

// Market analysis
export { fetchBarsWithIndicators } from './application/market/barsApi';
export { cancelAnalysisJob } from './application/market/cancelAnalysisJob';
export { peekAnalysisCache } from './application/market/peekAnalysisCache';
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
export { peekOverallAnalysisCache } from './application/overall/peekOverallAnalysisCache';
export { pollOverallAnalysis } from './application/overall/pollOverallAnalysis';
export { submitOverallAnalysis } from './application/overall/submitOverallAnalysis';

// =============================================================================
// Tier 2 — Domain Building Blocks
// =============================================================================
// High-level pure-function entry points. Low-level indicator calculators are
// internal; consumers receive precomputed IndicatorResult via the
// application-layer fetchBarsWithIndicators() use-case.

// Aggregate calculators / detectors
export {
    calculateIchimokuFutureCloud,
    calculateIndicators,
    computeFearGreedHistory,
    computeFearGreedIndex,
    FEAR_GREED_LABEL_CUTOFFS,
    POC_WINDOW_DEFAULT,
    scoreToLabel,
} from './domain/indicators';
export { classifyTrend, detectSignals } from './domain/signals';

// Prompt builders
export { buildChatPrompt } from './domain/chat/buildChatPrompt';
export { AI_SYSTEM_PROMPT } from './domain/analysis/systemPrompt';

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
    detectCandlePatternEntries,
    getDetectionBars,
    selectLastCandlePatternEntries,
} from './domain/analysis/candle-detection';
export {
    getCandlePatternLabel,
    getMultiCandlePatternLabel,
} from './domain/analysis/candle-labels';
export {
    getMultiPatternTrend,
    getSinglePatternTrend,
    type PatternTrend,
} from './domain/analysis/candle-trend';

// Analysis normalization / helpers
export {
    extractReconciledActionLines,
    validateActionPrices,
} from './domain/analysis/actionRecommendation';
export {
    clusterKeyLevels,
    validateKeyLevels,
} from './domain/analysis/keyLevels';

// LLM provider mapping
export { getProviderForModel } from './domain/llm/providers';

// Tier gating
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

// Market session — DST-safe US regular-session (ET) classification.
// Single source of truth shared by siglens UI, cache, and analysis gating.
export { getEtSessionStatus, isEtRegularSessionOpen } from './domain/utils';

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
    buildOptionsCacheKey,
    CACHE_EXPIRY_HOUR_KST,
    computeBarsEffectiveTtl,
    computeEffectiveTtl,
    MARKET_BRIEFING_CACHE_TTL,
} from './infrastructure/cache/config';
export { createCacheProvider } from './infrastructure/cache/redis';

// LLM response JSON parsing with `jsonrepair` salvage — used by worker
// codebases that parse raw LLM JSON before storing job results.
export { extractJsonWithRepair } from './infrastructure/ai/extractJsonWithRepair';

// Chat token store
export {
    CHAT_TOKEN_LIMIT,
    CHAT_TOKEN_TTL_SEC,
    createChatTokenStore,
    hashClientIp,
} from './infrastructure/chat/tokenStore';

// Skills loader
export {
    createSkillsProvider,
    FileSkillsLoader,
} from './infrastructure/skills/loader';

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

// Market session times + state (single source of truth, shared with siglens UI)
export {
    MARKET_CLOSE_HOUR,
    MARKET_CLOSE_MINUTE,
    MARKET_OPEN_HOUR,
    MARKET_OPEN_MINUTE,
} from './domain/utils';
export type { EtSessionStatus } from './domain/types';

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

// Indicator constants
export {
    CCI_DEFAULT_PERIOD,
    CCI_OVERBOUGHT_LEVEL,
    CCI_OVERSOLD_LEVEL,
    CCI_ZERO_LEVEL,
    DMI_DEFAULT_PERIOD,
    EMA_DEFAULT_PERIODS,
    EMPTY_INDICATOR_RESULT,
    EMPTY_SMC_RESULT,
    HIGH_CONFIDENCE_WEIGHT,
    MA_DEFAULT_PERIODS,
    MACD_FAST_PERIOD,
    MACD_SIGNAL_PERIOD,
    MACD_SLOW_PERIOD,
    MIN_CONFIDENCE_WEIGHT,
    RSI_DEFAULT_PERIOD,
    RSI_OVERBOUGHT_LEVEL,
    RSI_OVERSOLD_LEVEL,
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
    CallAiProvider,
    CallAiProviderOptions,
    ConversationRole,
    ConversationTurn,
} from './domain/ports/aiProvider';

export type { CacheProvider } from './domain/ports/cache';
export type { ChatTokenStore } from './domain/ports/chatTokenStore';
export type {
    UserTier,
    UserTierRepository,
} from './domain/ports/userTierRepository';
export type {
    CreateUsageLogInput,
    UsageLogRepository,
} from './domain/ports/usageLogRepository';
export type {
    RecordUsageInput,
    UsageRepository,
} from './domain/ports/usageRepository';
export type {
    UsageActionType,
    UsageCounts,
    UsageLogRecord,
} from './domain/types';
export type { FmpConfig } from './infrastructure/fmp/types';
export type { FundamentalDataProvider } from './domain/ports/fundamentalDataProvider';
export type { JobMeta, JobStatus } from './infrastructure/jobs/types';
export type {
    GetBarsOptions,
    MarketDataProvider,
} from './domain/ports/marketDataProvider';
export type { AcquireReanalyzeCooldownResult } from './infrastructure/market/types';
export type { NewsProvider, NewsTimeRange } from './domain/ports/newsProvider';
export type { SkillsProvider } from './domain/ports/skillsProvider';

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
export type { OptionsDataProvider } from './domain/ports/optionsDataProvider';

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
export { buildOptionsAnalysisPrompt } from './domain/options/optionsPrompt';

// Options analysis — application use-cases (submit + poll, cache key builder)
export {
    submitOptionsAnalysis,
    pollOptionsAnalysis,
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
