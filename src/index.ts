// =============================================================================
// Tier 1 — Application Entrypoints
// =============================================================================
// Use-case functions called directly from Server Actions / API handlers / workers.

// Market analysis
export { fetchBarsWithIndicators } from './application/market/barsApi';
export { cancelAnalysisJob } from './application/market/cancelAnalysisJob';
export { peekAnalysisCache } from './application/market/peekAnalysisCache';
export { peekBriefingCache } from './application/market/peekBriefingCache';
export { pollAnalysis } from './application/market/pollAnalysis';
export { pollBriefing } from './application/market/pollBriefing';
export { submitAnalysis } from './application/market/submitAnalysis';
export { submitBriefing } from './application/market/submitBriefing';

// Dashboard
export { getMarketSummary } from './application/dashboard/getMarketSummary';
export { getSectorSignals } from './application/dashboard/sectorSignals';

// Economy (macro) briefing — mirrors market briefing for the /economy page
export { submitMacroBriefing } from './application/economy/submitMacroBriefing';
export { pollMacroBriefing } from './application/economy/pollMacroBriefing';
export { peekMacroBriefingCache } from './application/economy/peekMacroBriefingCache';

// Economy — per-event AI analysis (submit/poll worker-job pattern)
export { submitEconomicEventAnalysis } from './application/economy/submitEconomicEventAnalysis';
export { pollEconomicEventAnalysis } from './application/economy/pollEconomicEventAnalysis';

// Economy — indicator-name AI translation (submit/poll worker-job pattern)
export { submitIndicatorTranslation } from './application/economy/submitIndicatorTranslation';
export { pollIndicatorTranslation } from './application/economy/pollIndicatorTranslation';

// Application background-task options (used by market / dashboard use-cases)
export type { BackgroundTaskOptions } from './application/types';

// Chat
export {
    DEEPSEEK_V4_FLASH_MODEL,
    DEEPSEEK_V4_PRO_MODEL,
    GEMINI_2_5_FLASH_LITE_MODEL,
    GEMINI_2_5_FLASH_MODEL,
    VALID_CHAT_MODELS,
} from './application/chat/constants';
export { requestChatCompletion } from './application/chat/requestChatCompletion';

export { checkAnalysisLimit, checkChatbotLimit } from './application/usage';

// Fundamental analysis use-cases
export { cancelFundamentalAnalysisJob } from './application/fundamental/cancelFundamentalAnalysisJob';
export { pollFundamentalAnalysis } from './application/fundamental/pollFundamentalAnalysis';
export { submitFundamentalAnalysis } from './application/fundamental/submitFundamentalAnalysis';

// Financials analysis use-cases
export { cancelFinancialsAnalysisJob } from './application/financials/cancelFinancialsAnalysisJob';
export { pollFinancialsAnalysis } from './application/financials/pollFinancialsAnalysis';
export { submitFinancialsAnalysis } from './application/financials/submitFinancialsAnalysis';

// Congress trend analysis use-cases
export { cancelCongressTrendJob } from './application/congress/cancelCongressTrendJob';
export { pollCongressTrend } from './application/congress/pollCongressTrend';
export { submitCongressTrend } from './application/congress/submitCongressTrend';

// News analysis use-cases
export { cancelNewsAnalysisJob } from './application/news/cancelNewsAnalysisJob';
export { pollMarketNewsDigest } from './application/news/pollMarketNewsDigest';
export { pollNewsAnalysis } from './application/news/pollNewsAnalysis';
export { pollNewsCardAnalysis } from './application/news/pollNewsCardAnalysis';
export { submitMarketNewsDigest } from './application/news/submitMarketNewsDigest';
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

// Financials domain building blocks
export { computeFinancialsScorecard } from './domain/analysis/financialsScorecard';
export { normalizeFinancialsAnalysisResponse } from './domain/analysis/normalizeFinancials';
export { normalizeFinancialsSnapshot } from './domain/analysis/normalizeFinancialsSnapshot';

// Congress domain building blocks
export { normalizeCongressTrades } from './domain/analysis/normalizeCongressTrades';
export { summarizeCongressTrades } from './domain/analysis/summarizeCongressTrades';
export { normalizeCongressTrendResponse } from './domain/analysis/normalizeCongressTrend';

// Economy domain building blocks (normalization + 2s10s spread)
export { normalizeEconomicIndicatorSeries } from './domain/economy/normalizeEconomicIndicators';
export {
    normalizeTreasuryRates,
    computeYieldSpread,
} from './domain/economy/normalizeTreasuryRates';
export { normalizeEconomicCalendar } from './domain/economy/normalizeEconomicCalendar';

// Economy — per-event AI analysis domain building blocks
export { normalizeEconomicEventAnalysis } from './domain/economy/normalizeEconomicEventAnalysis';

// Economy — indicator-name AI translation domain building blocks
export { normalizeIndicatorTranslation } from './domain/economy/normalizeIndicatorTranslation';

// Model spec helpers
export {
    getProvider,
    getThinkingBudgetSequence,
    isChatGPTModel,
    isClaudeModel,
    isDeepSeekModel,
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
export { filterAnalysisResult } from './domain/analysis/filterAnalysisResult';
export {
    clusterKeyLevels,
    validateKeyLevels,
} from './domain/analysis/keyLevels';
export { computeMarketReference } from './domain/analysis/marketReference';

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
export type { EtSessionStatus, MarketSessionStatus } from './domain/types';

// Spec-driven session model — MarketSessionSpec + generic helpers.
// Crypto consumers use CRYPTO_SESSION (always-open);
// US equity maps to US_EQUITY_SESSION (same semantics as getEtSessionStatus).
export {
    US_EQUITY_SESSION,
    CRYPTO_SESSION,
    getSessionStatus,
    isRegularSessionOpen,
} from './domain/session';
export type { AssetClass, MarketSessionSpec } from './domain/types';

// Economy (macro) domain types — /economy page snapshot + briefing
export type {
    CalendarImpact,
    EconomicIndicatorPoint,
    EconomicIndicatorSeries,
    TreasuryRateSnapshot,
    EconomicCalendarEvent,
    EconomySnapshot,
    MacroRegime,
    MacroBriefingResponse,
    EconomicEventAnalysisInput,
    EconomicEventAnalysis,
} from './domain/economy/types';

// Economy application result types — produced by submit/poll use-cases, so they
// live in the application layer (Architecture #0), mirroring financials.
// Covers macro briefing, per-event AI analysis, and indicator-name translation.
export type {
    SubmitMacroBriefingResult,
    SubmitMacroBriefingCached,
    SubmitMacroBriefingSubmitted,
    PollMacroBriefingResult,
    PollMacroBriefingProcessing,
    PollMacroBriefingError,
    PollMacroBriefingDone,
    SubmitEconomicEventAnalysisResult,
    SubmitEconomicEventAnalysisCached,
    SubmitEconomicEventAnalysisSubmitted,
    PollEconomicEventAnalysisResult,
    PollEconomicEventAnalysisProcessing,
    PollEconomicEventAnalysisError,
    PollEconomicEventAnalysisDone,
    SubmitIndicatorTranslationResult,
    SubmitIndicatorTranslationCached,
    SubmitIndicatorTranslationSubmitted,
    PollIndicatorTranslationResult,
    PollIndicatorTranslationProcessing,
    PollIndicatorTranslationError,
    PollIndicatorTranslationDone,
} from './application/economy/types';

// =============================================================================
// Tier 3 — Infrastructure Factories & Config
// =============================================================================
// Dependency-injection entry points. Consumers create infra objects through
// these factories and supply env-derived configuration.

// Cache
export { computeBarsEffectiveTtl } from './infrastructure/cache/config';
export { createCacheProvider } from './infrastructure/cache/redis';

// Chat token store
export {
    createChatTokenStore,
    hashClientIp,
} from './infrastructure/chat/tokenStore';

// Config readers
export { readFmpConfig, tryReadFmpConfig } from './infrastructure/fmp/config';

// Database
export { hashUsageIp } from './infrastructure/usage/hash';

// Job queue (worker-side primitives)
export { cancelJob } from './infrastructure/jobs/queue';

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

// Tier gating constants
export { DEFAULT_TIER, TIER_CONFIG } from './domain/tier';

// Market session times + state (single source of truth, shared with siglens UI)
export {
    MARKET_CLOSE_HOUR,
    MARKET_CLOSE_MINUTE,
    MARKET_OPEN_HOUR,
    MARKET_OPEN_MINUTE,
} from './domain/utils';

// Model specs (single source of truth for AI SDK call parameters)
export {
    DISABLED_THINKING_BUDGET,
    MODEL_SPECS,
    type ChatGPTModelId,
    type ClaudeModelId,
    type DeepSeekModelId,
    type GeminiModelId,
} from './domain/analysis/modelSpecs';
export type {
    ActiveModelId,
    AIProvider,
    ChatGPTModelSpec,
    ClaudeReasoningModelSpec,
    ClaudeSamplingModelSpec,
    DeepSeekModelSpec,
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
export type { UserTier } from './domain/ports/userTierRepository';
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
export type { FinancialStatementsProvider } from './domain/ports/financialStatementsProvider';
export type { CongressTradesProvider } from './domain/ports/congressTradesProvider';
export type {
    GetBarsOptions,
    MarketDataProvider,
} from './domain/ports/marketDataProvider';
export type { AcquireReanalyzeCooldownResult } from './infrastructure/market/types';
export type { NewsTimeRange } from './domain/ports/newsProvider';

// Application types
export type {
    ChatActionResult,
    ChatErrorCode,
    RequestChatCompletionDependencies,
    RequestChatCompletionParams,
} from './application/chat/types';
export type {
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
    PollFinancialsAnalysisResult,
    SubmitFinancialsAnalysisApiKeyRequiredError,
    SubmitFinancialsAnalysisCached,
    SubmitFinancialsAnalysisFetchError,
    SubmitFinancialsAnalysisLimitError,
    SubmitFinancialsAnalysisMissNoTrigger,
    SubmitFinancialsAnalysisOptions,
    SubmitFinancialsAnalysisResult,
    SubmitFinancialsAnalysisSubmitted,
} from './application/financials/types';
export type {
    PollCongressTrendResult,
    SubmitCongressTrendCached,
    SubmitCongressTrendFetchError,
    SubmitCongressTrendMissNoTrigger,
    SubmitCongressTrendNoTrades,
    SubmitCongressTrendOptions,
    SubmitCongressTrendResult,
    SubmitCongressTrendSubmitted,
} from './application/congress/types';
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
    PollMarketNewsDigestDone,
    PollMarketNewsDigestError,
    PollMarketNewsDigestProcessing,
    PollMarketNewsDigestResult,
    SubmitMarketNewsDigestCached,
    SubmitMarketNewsDigestMissNoTrigger,
    SubmitMarketNewsDigestNoNewsError,
    SubmitMarketNewsDigestOptions,
    SubmitMarketNewsDigestResult,
    SubmitMarketNewsDigestSubmitted,
} from './application/news/marketNewsDigestTypes';
export type {
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
    OverallDependencyInputs,
} from './application/overall/types';

// Domain types

export type {
    ActionRecommendation,
    AnalysisResponse,
    FilteredAnalysisResponse,
    FilteredAnalysisResult,
    AnalysisSignal,
    AnalysisSignalType,
    AnalysisType,
    AssembledPrompt,
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
    // Pro-indicator result types (IndicatorResult sub-types).
    BollingerDerivedResult,
    ChandelierResult,
    ChandelierTrend,
    ElderRayResult,
    ImpulseColor,
    RegressionResult,
    CandlePattern,
    CandlePatternEntry,
    // Chart-pattern pre-screener result types (domain/patterns, spec §3.3).
    ChartPatternId,
    PatternCandidate,
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
    Chamber,
    CongressTradeSide,
    CongressOwner,
    CongressSentiment,
    CongressTrendDirection,
    CongressAmountRange,
    CongressTrade,
    RawCongressTrade,
    CongressTradeStats,
    CongressTrendResponse,
    StatementPeriod,
    FinancialsSentiment,
    FinancialsAxis,
    FinancialsGrade,
    IncomeStatementRow,
    BalanceSheetRow,
    CashFlowRow,
    IncomeGrowthRow,
    FinancialGrowthRow,
    CashFlowGrowthRow,
    FinancialsSnapshot,
    NormalizeFinancialsSnapshotInput,
    FinancialSignalType,
    FinancialSignal,
    FinancialSignalDirection,
    ScoreMetric,
    ScoreMetricUnit,
    AxisScore,
    FinancialsCompositeScore,
    FinancialsScorecard,
    FinancialsAxisAssessment,
    FinancialsAnalysisResponse,
    FundamentalAnalysisResponse,
    FundamentalAnalystEstimateInput,
    FundamentalCashFlowInput,
    FundamentalCategoryAssessment,
    FundamentalCategory,
    FundamentalFinancialScoresInput,
    FundamentalGradesConsensusInput,
    FundamentalGrowthInput,
    FundamentalPeerInput,
    FundamentalPriceTargetConsensusInput,
    FundamentalPriceTargetSummaryInput,
    FundamentalRatiosInput,
    FundamentalSectorHistoricalInput,
    FundamentalSectorPerformanceInput,
    FundamentalSentiment,
    FundamentalProfile,
    FundamentalValuationMetrics,
    PriceTargetAvg,
    GradesAction,
    GradesEvent,
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
    MarketReference,
    HorizonReference,
    HorizonWindow,
    HorizonKey,
    TrendStructure,
    ReferenceLevel,
    ReferenceLevels,
    ReferenceLevelKind,
    PriceVsLevel,
    EmaStackState,
    SwingStructureState,
    MarketRegime,
    MACDResult,
    MarketBriefingResponse,
    NewsAnalysisResponse,
    NewsCardAnalysis,
    NewsCategory,
    NewsFeedCategory,
    NewsImpact,
    NewsItem,
    NewsSentiment,
    MarketBriefingSectorAnalysis,
    MarketBriefingVolatilityAnalysis,
    MarketIndexData,
    MarketQuote,
    MarketSectorData,
    MarketSummaryData,
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
    QuadrantKey,
    ReconciledActionLevels,
    ReconciledActionLineData,
    ReconciledTpEntry,
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
    SkillCounts,
    SkillDisplay,
    SkillGating,
    SkillShowcaseItem,
    SkillStateFeature,
    SkillStatePredicate,
    SkillStatePredicateKind,
    SkillType,
    SkillUsageRole,
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
