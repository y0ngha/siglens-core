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
export { buildAnalysisPrompt } from './domain/analysis/prompt';
export { buildFundamentalAnalysisPrompt } from './domain/analysis/fundamentalPrompt';
export { buildMarketBriefingPrompt } from './domain/analysis/marketBriefingPrompt';
export { buildNewsAnalysisPrompt } from './domain/analysis/newsPrompt';
export { buildNewsCardAnalysisPrompt } from './domain/analysis/newsCardPrompt';
export { buildOverallAnalysisPrompt } from './domain/analysis/overallPrompt';
export { buildChatPrompt } from './domain/chat/buildChatPrompt';
export { AI_SYSTEM_PROMPT } from './domain/analysis/systemPrompt';
export {
    GEMINI_2_5_FLASH_MODEL,
    GEMINI_2_5_FLASH_LITE_MODEL,
    GEMINI_2_5_PRO_MODEL,
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
export { normalizeOptionsAnalysisResponse } from './domain/analysis/normalizeOptions';

// Options analysis — domain helpers (server-only submit/poll use-cases are
// intentionally omitted; only pure domain functions belong on the browser
// entry).
export { buildOptionsAnalysisPrompt } from './domain/options/optionsPrompt';
export { summarizeChainForLlm } from './domain/options/summarizeChainForLlm';
export { aggregateOpenInterest } from './domain/options/aggregateOpenInterest';
export { sanitizeOptionsChain } from './domain/options/sanitizeOptionsChain';
export {
    EXPIRATION_SLOTS,
    mapExpirationsToSlots,
} from './domain/options/expirationSlots';
export type { OptionsDataProvider } from './domain/ports/optionsDataProvider';
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
    type PatternTrend,
} from './domain/analysis/candle-trend';

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

// Dashboard helpers
export {
    bucketedTimestamp,
    computeStockSignalResult,
    lookbackIsoFromNow,
} from './domain/dashboard';

// Market session — DST-safe US regular-session (ET) classification. Pure and
// browser-safe (no Node deps), so it belongs in the client entrypoint too.
export { getEtSessionStatus, isEtRegularSessionOpen } from './domain/utils';

// =============================================================================
// Tier 4 — Public Types & Constants
// =============================================================================

// LLM provider constants
export { LLM_PROVIDER_VALUES } from './domain/llm/constants';

// Market session times + state (single source of truth, shared with siglens UI)
export {
    MARKET_CLOSE_HOUR,
    MARKET_CLOSE_MINUTE,
    MARKET_OPEN_HOUR,
    MARKET_OPEN_MINUTE,
} from './domain/utils';
export type { EtSessionStatus } from './domain/types';

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
export type {
    ChatActionResult,
    ChatErrorCode,
    RequestChatCompletionParams,
    RequestChatCompletionDependencies,
    RequestChatCompletionResult,
} from './application/chat/types';
export type {
    SubmitAnalysisGatedResult,
    SubmitAnalysisMissNoTrigger,
    UserApiKeyRequiredError,
} from './application/market/types';
export type {
    AnalysisLimitError,
    AnalysisLimitErrorCode,
    ChatbotLimitError,
    ChatbotLimitErrorCode,
} from './application/usage';

// Domain types
export type {
    AnalysisSignalType,
    ChatModel,
    EarningsCalendarItem,
    EarningsReport,
    EnrichedNewsItem,
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
    FundamentalCategory,
    FundamentalCategoryAssessment,
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
    FundamentalProfile,
    FundamentalProfileInput,
    FundamentalProfitability,
    FundamentalRatiosInput,
    FundamentalSectorDirection,
    FundamentalSectorHistoricalInput,
    FundamentalSectorPerformanceInput,
    FundamentalSentiment,
    FundamentalSnapshot,
    FundamentalValuation,
    FundamentalValuationMetrics,
    GradesAction,
    GradesConsensus,
    GradesEvent,
    ModelId,
    NewsAnalysisResponse,
    NewsCardAnalysis,
    NewsCategory,
    NewsItem,
    NewsSentiment,
    NormalizeFundamentalSnapshotInput,
    OverallAnalysisResponse,
    OverallScenario,
    OverallScenarioName,
    PriceTargetAvg,
    PriceTargetConsensus,
    PriceTargetSummary,
    SectorHistoricalPoint,
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
    LlmProvider,
    WaitUntil,
} from './domain/types';
