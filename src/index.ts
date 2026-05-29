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
export { getSectorSignals } from './application/dashboard/sectorSignals';

// Application background-task options (used by market / dashboard use-cases)

// Chat
export {
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
export type { EtSessionStatus } from './domain/types';

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
    type GeminiModelId,
} from './domain/analysis/modelSpecs';
export type {
    ActiveModelId,
    AIProvider,
    EffortLevel,
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
export type { ChatActionResult, ChatErrorCode } from './application/chat/types';
export type {
    PollFundamentalAnalysisResult,
    SubmitFundamentalAnalysisOptions,
    SubmitFundamentalAnalysisResult,
} from './application/fundamental/types';
export type { SubmitAnalysisGatedResult } from './application/market/types';
export type {
    PollNewsAnalysisResult,
    PollNewsCardAnalysisResult,
    SubmitNewsAnalysisOptions,
    SubmitNewsAnalysisResult,
    SubmitNewsCardAnalysisResult,
} from './application/news/types';
export type {
    OverallAxis,
    PollOverallAnalysisResult,
    SubmitOverallAnalysisOptions,
    SubmitOverallAnalysisResult,
} from './application/overall/types';

// Domain types

export type {
    ActionRecommendation,
    AnalysisResponse,
    AnalysisSignal,
    AnalysisSignalType,
    CurrentAnalysisContext,
    BacktestAiEntryRecommendation,
    BacktestAiResult,
    BacktestCase,
    BacktestData,
    BacktestExitReason,
    BacktestMeta,
    BacktestRiskLevel,
    BacktestSignalResult,
    Bar,
    BarsData,
    BuySellVolumeResult,
    CandlePatternEntry,
    ChatLoadingPhase,
    ChatMessage,
    ChatSession,
    ClusteredKeyLevel,
    ClusteredKeyLevels,
    ConflictInfo,
    ConflictResolution,
    DashboardTimeframe,
    EarningsCalendarItem,
    EarningsReport,
    EnrichedNewsItem,
    FearGreedConfidence,
    FearGreedFactorKey,
    FearGreedGroup,
    FearGreedHistoryPoint,
    FearGreedLabel,
    FearGreedSnapshot,
    FearGreedWarning,
    FundamentalAnalysisResponse,
    FundamentalAnalystEstimateInput,
    FundamentalCashFlowInput,
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
    GradesAction,
    GradesEvent,
    EntryRecommendation,
    IchimokuFuturePoint,
    IndexTicker,
    IndicatorResult,
    MarketBriefingResponse,
    NewsAnalysisResponse,
    NewsCardAnalysis,
    NewsCategory,
    NewsImpact,
    NewsItem,
    NewsSentiment,
    MarketIndexData,
    MarketQuote,
    MarketSectorData,
    MarketSummaryData,
    ModelId,
    PatternResult,
    PollAnalysisResult,
    PollBriefingResult,
    PriceScenario,
    OverallAnalysisResponse,
    OverallScenario,
    OverallScenarioName,
    QuadrantKey,
    ReconciledActionLineData,
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
    Skill,
    SkillCategory,
    SkillChartDisplay,
    SkillCounts,
    SkillDisplay,
    SkillShowcaseItem,
    SkillType,
    StockSignalResult,
    StockWithConflict,
    StrategyResult,
    SubmitBriefingResult,
    Tier,
    Timeframe,
    Trend,
    Trendline,
    TrendlineDirection,
    UserTierContext,
    LlmProvider,
    ValidatedActionPrices,
    VolumeProfileRow,
    WaitUntil,
} from './domain/types';

// Options analysis — domain types (including expiration slot types and the
// `buildOptionsAnalysisPrompt` input shape). Routed through the
// `./domain/types` barrel so every domain type follows the same import path.
export type {
    OptionsContract,
    OptionsChain,
    OptionsSnapshot,
    OptionsExpirationMetrics,
    OptionsAnalysisResponse,
    OptionsTone,
    OptionsSignalKind,
    SlotMapping,
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

// Options analysis — normalize + prompt (use-case layer will add submit/poll in Phase 2)
export { buildOptionsAnalysisPrompt } from './domain/options/optionsPrompt';

// Options analysis — application use-cases (submit + poll, cache key builder)
export {
    submitOptionsAnalysis,
    pollOptionsAnalysis,
} from './application/options';
export type {
    SubmitOptionsAnalysisResult,
    PollOptionsAnalysisResult,
} from './application/options';
