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
export {
    GEMINI_2_5_FLASH_MODEL,
    GEMINI_2_5_FLASH_LITE_MODEL,
    VALID_CHAT_MODELS,
} from './application/chat/constants';

// LLM provider mapping
export { getProviderForModel } from './domain/llm/providers';

// Tier gating
export {
    DEFAULT_TIER,
    TIER_CONFIG,
    getAllowedModels,
    getAllowedTimeframes,
    getTierLimit,
    isAllowed,
    isFreeModel,
    isInfoDepthAllowed,
    isModelAllowed,
    isPremiumModel,
    isTier,
    isTimeframeAllowed,
    requiresByokKey,
} from './domain/tier';

// Options analysis — domain helpers (server-only submit/poll use-cases are
// intentionally omitted; only pure domain functions belong on the browser
// entry).
export { buildOptionsAnalysisPrompt } from './domain/options/optionsPrompt';
export { summarizeChainForLlm } from './domain/options/summarizeChainForLlm';
export { aggregateOpenInterest } from './domain/options/aggregateOpenInterest';
export { sanitizeOptionsChain } from './domain/options/sanitizeOptionsChain';
export { mapExpirationsToSlots } from './domain/options/expirationSlots';
export type { OptionsDataProvider } from './domain/ports/optionsDataProvider';
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

// Model spec helpers
export {
    getProvider,
    getThinkingBudgetSequence,
    isChatGPTModel,
    isClaudeModel,
    isGeminiModel,
} from './domain/analysis/modelSpecs';

// Candle patterns
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
    getSinglePatternTrend,
    getMultiPatternTrend,
    type PatternTrend,
} from './domain/analysis/candle-trend';

// Analysis normalization / helpers
export {
    clusterKeyLevels,
    validateKeyLevels,
} from './domain/analysis/keyLevels';
export {
    extractReconciledActionLines,
    validateActionPrices,
} from './domain/analysis/actionRecommendation';

// Dashboard helpers
export {
    bucketedTimestamp,
    computeStockSignalResult,
    lookbackIsoFromNow,
} from './domain/dashboard';

// Market session — DST-safe US regular-session (ET) classification. Pure and
// browser-safe (no Node deps), so it belongs in the client entrypoint too.
export { getEtSessionStatus, isEtRegularSessionOpen } from './domain/utils';
export type { EtSessionStatus } from './domain/types';

// =============================================================================
// Tier 4 — Public Types & Constants
// =============================================================================

// LLM provider constants

// Market session times + state (single source of truth, shared with siglens UI)
export {
    MARKET_CLOSE_HOUR,
    MARKET_CLOSE_MINUTE,
    MARKET_OPEN_HOUR,
    MARKET_OPEN_MINUTE,
} from './domain/utils';

// Dashboard tickers / sectors

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
} from './domain/indicators/constants';

// Domain ports + infrastructure type-only interfaces are safe for browser consumers.
export type { CacheProvider } from './domain/ports/cache';
export type { SkillsProvider } from './domain/ports/skillsProvider';
export type { FmpConfig } from './infrastructure/fmp/types';
export type { JobStatus, JobMeta } from './infrastructure/jobs/types';
export type {
    MarketDataProvider,
    GetBarsOptions,
} from './domain/ports/marketDataProvider';
export type { AcquireReanalyzeCooldownResult } from './infrastructure/market/types';
export type {
    AiContents,
    CallAiProvider,
    CallAiProviderOptions,
    ConversationRole,
    ConversationTurn,
} from './domain/ports/aiProvider';

export type { ChatTokenStore } from './domain/ports/chatTokenStore';
export type { ChatActionResult, ChatErrorCode } from './application/chat/types';
export type { SubmitAnalysisGatedResult } from './application/market/types';

// Domain types
export type {
    AnalysisSignalType,
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
    FundamentalProfile,
    FundamentalRatiosInput,
    FundamentalSectorHistoricalInput,
    FundamentalSectorPerformanceInput,
    FundamentalSentiment,
    FundamentalValuationMetrics,
    GradesAction,
    GradesEvent,
    ModelId,
    NewsAnalysisResponse,
    NewsCardAnalysis,
    NewsCategory,
    NewsItem,
    NewsSentiment,
    OverallAnalysisResponse,
    OverallScenario,
    OverallScenarioName,
    Timeframe,
    Tier,
    UserTierContext,
    Bar,
    IndicatorResult,
    VolumeProfileRow,
    IchimokuFuturePoint,
    BuySellVolumeResult,
    Skill,
    SkillType,
    SkillCategory,
    SkillChartDisplay,
    SkillDisplay,
    Signal,
    SignalType,
    SignalDirection,
    SignalPhase,
    Trend,
    RiskLevel,
    AnalysisResponse,
    AnalysisSignal,
    SignalStrength,
    BacktestCase,
    BacktestMeta,
    BacktestRiskLevel,
    ClusteredKeyLevel,
    ClusteredKeyLevels,
    QuadrantKey,
    PriceScenario,
    PatternResult,
    StrategyResult,
    Trendline,
    TrendlineDirection,
    ActionRecommendation,
    EntryRecommendation,
    ReconciledActionLineData,
    ValidatedActionPrices,
    ChatMessage,
    ChatLoadingPhase,
    ChatSession,
    MarketIndexData,
    MarketSectorData,
    MarketBriefingResponse,
    CandlePatternEntry,
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
    BarsData,
    PollAnalysisResult,
    SubmitBriefingResult,
    PollBriefingResult,
    BacktestSignalResult,
    BacktestAiResult,
    BacktestExitReason,
    BacktestAiEntryRecommendation,
    BacktestData,
    LlmProvider,
    WaitUntil,
} from './domain/types';
