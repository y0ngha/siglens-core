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
    computeCryptoFearGreedHistory,
    computeCryptoFearGreedIndex,
    computeFearGreedHistory,
    computeFearGreedIndex,
    computeLabelTransitions,
    computeMarketFearGreedHistory,
    computeMarketFearGreedIndex,
    computeMarketScoreGap,
    CRYPTO_FEAR_GREED_FACTOR_KEYS,
    EXTREME_FEAR_GREED_ZONES,
    EXTREME_ZONE_FORWARD_HORIZONS,
    EXTREME_ZONE_MIN_SAMPLE,
    EXTREME_ZONE_REENTRY_GAP,
    FEAR_GREED_LABEL_CUTOFFS,
    fearGreedInputs,
    MARKET_FEAR_GREED_FACTOR_KEYS,
    MARKET_FEAR_GREED_SERIES_KEYS,
    POC_WINDOW_DEFAULT,
    scoreToLabel,
    summarizeExtremeZoneEpisodes,
    summarizeExtremeZoneOutcomes,
} from './domain/indicators';
export { FEAR_GREED_LOOKBACK_DAYS } from './domain/constants/market';
export { classifyTrend, detectSignals } from './domain/signals';

// Prompt builders
export { buildChatPrompt } from './domain/chat/buildChatPrompt';
export { AI_SYSTEM_PROMPT } from './domain/analysis/systemPrompt';
export {
    ANALYSIS_LOCALES,
    DEFAULT_ANALYSIS_LOCALE,
    isValidAnalysisLocale,
    type AnalysisLocale,
} from './domain/analysis/outputLocale';
export {
    DEEPSEEK_V4_1_FLASH_MODEL,
    DEEPSEEK_V4_1_PRO_MODEL,
    GEMINI_FLASH_LITE_MODEL,
    VALID_CHAT_MODELS,
} from './application/chat/constants';

// LLM provider mapping
export { getProviderForModel } from './domain/llm/providers';

// Tier gating
export {
    DEFAULT_TIER,
    TIER_CONFIG,
    getAllowedModels,
    buildRevealedTierConfig,
    getAllowedTimeframes,
    getMeteredRevealPolicy,
    getModelAccess,
    getTierLimit,
    isAllowed,
    isFreeModel,
    isInfoDepthAllowed,
    isModelAllowed,
    isPremiumModel,
    isTier,
    isTimeframeAllowed,
    requiresAuth,
    requiresByokKey,
} from './domain/tier';

// Options analysis — domain helpers (server-only submit/poll use-cases are
// intentionally omitted; only pure domain functions belong on the browser
// entry).
export { summarizeChainForLlm } from './domain/options/summarizeChainForLlm';
export { aggregateOpenInterest } from './domain/options/aggregateOpenInterest';
export { sanitizeOptionsChain } from './domain/options/sanitizeOptionsChain';
export { mapExpirationsToSlots } from './domain/options/expirationSlots';
export type { OptionsDataProvider } from './domain/ports/optionsDataProvider';
export type {
    BuildOptionsAnalysisPromptOptions,
    OptionsContract,
    OptionsChain,
    OptionsSnapshot,
    StrikeOpenInterest,
    LlmStrikeOpenInterest,
    StrikeVolumeAggregate,
    TopOiQuote,
    OptionsExpirationMetrics,
    ImpliedMoveRange,
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

// Agent — follow-up marker parser (browser-safe: pure function only). The chat
// UI strips the trailing `[[followups]]` line from the streamed answer with it.
export {
    AGENT_FOLLOW_UP_MARKER,
    splitAgentFollowUps,
} from './domain/agent/agentFollowUps';
export type { SplitAgentFollowUps } from './domain/agent/agentFollowUps';

// Economy (macro) — domain helpers (server-only submit/poll/peek use-cases are
// intentionally omitted; only pure domain functions belong on the browser
// entry, mirroring the options/financials patterns).
export { normalizeEconomicIndicatorSeries } from './domain/economy/normalizeEconomicIndicators';
export {
    normalizeTreasuryRates,
    computeYieldSpread,
} from './domain/economy/normalizeTreasuryRates';
export { normalizeEconomicCalendar } from './domain/economy/normalizeEconomicCalendar';
// Economy — per-event AI analysis domain helpers (browser-safe: pure functions only).
export { normalizeEconomicEventAnalysis } from './domain/economy/normalizeEconomicEventAnalysis';
// Economy — indicator-name translation domain helpers (browser-safe: pure functions only).
export { normalizeIndicatorTranslation } from './domain/economy/normalizeIndicatorTranslation';
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
// Application result types live alongside the use-cases (Architecture #0); the
// server-only `submitMacroBriefing`/`pollMacroBriefing` functions stay omitted
// from the browser entry, but their pure result-type shapes are safe to expose.
// Likewise for the economic-event analysis submit/poll use-cases.
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

// Financials analysis — domain helpers (server-only submit/poll/cancel use-cases
// are intentionally omitted; only pure domain functions belong on the browser
// entry, mirroring the options analysis pattern above).
export { computeFinancialsScorecard } from './domain/analysis/financialsScorecard';
export { normalizeFinancialsAnalysisResponse } from './domain/analysis/normalizeFinancials';
export { normalizeFinancialsSnapshot } from './domain/analysis/normalizeFinancialsSnapshot';
export type { FinancialStatementsProvider } from './domain/ports/financialStatementsProvider';
export type {
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
    NormalizeFinancialsSnapshotInput,
} from './domain/types';

// Congress analysis — domain helpers (server-only submit/poll/cancel use-cases
// are intentionally omitted from the browser entry; only pure domain functions
// belong here, mirroring the financials analysis pattern above).
export { normalizeCongressTrades } from './domain/analysis/normalizeCongressTrades';
export { summarizeCongressTrades } from './domain/analysis/summarizeCongressTrades';
export { normalizeCongressTrendResponse } from './domain/analysis/normalizeCongressTrend';
export type { CongressTradesProvider } from './domain/ports/congressTradesProvider';
export type {
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
} from './domain/types';

// Investor flows (수급) — pure domain functions and types (server-only `runInvestorFlowsAnalysis`
// is omitted from the browser entry, mirroring congress above).
export { evaluateInvestorFlows } from './domain/investorFlows/evaluateInvestorFlows';
export { evaluateSqueezeRisk } from './domain/investorFlows/squeezeRisk';
export { normalizeInvestorFlowsAnalysisResponse } from './domain/analysis/normalizeInvestorFlows';
export { INVESTOR_FLOWS_AXES } from './domain/investorFlows/constants';
export type { InvestorFlowsDataProvider } from './domain/ports/investorFlowsDataProvider';
export type {
    InstitutionalHolderChangeKind,
    InstitutionalQuarter,
    InstitutionalHolderChange,
    InsiderTransactionType,
    InsiderTransaction,
    InsiderStatistics,
    LargeHolderFiling,
    ShortInterestPoint,
    ShortVolumePoint,
    InstitutionalSnapshot,
    InsiderSnapshot,
    InvestorFlowsSnapshot,
    InvestorFlowsAxisId,
    InvestorFlowsSignalDirection,
    InvestorFlowsSignalStrength,
    InvestorFlowsSignalId,
    InvestorFlowsEvidence,
    InvestorFlowsSignal,
    InvestorFlowsLabel,
    InvestorFlowsSufficiency,
    InvestorFlowsAxisBase,
    NetShareChangeBasis,
    PartialInstitutionalQuarter,
    InstitutionalMetrics,
    InstitutionalAxis,
    InsiderMetrics,
    InsiderAxis,
    LargeHolderMetrics,
    LargeHolderAxis,
    ShortInterestTrend,
    ShortMetrics,
    ShortAxis,
    InvestorFlowsComposite,
    InvestorFlowsWindow,
    InvestorFlowsFreshness,
    InvestorFlowsScorecard,
    EvaluateInvestorFlowsOptions,
    InvestorFlowsAnalysisResponse,
    InvestorFlowsAxisInterpretation,
    InstitutionalOptionsQuarter,
    FailsToDeliverPoint,
    ProposedSale,
    OfferingKind,
    OfferingFiling,
    ThresholdListStatus,
    InvestorFlowsMarket,
    KrMajorHolderReportForm,
    KrMajorHolderReport,
    KrInsiderReport,
    KrTradingPlan,
    KrDisclosureSnapshot,
    KrInsiderMetrics,
    KrMajorHolderMetrics,
    DilutionMetrics,
    DilutionAxis,
    SqueezeRiskBar,
    SqueezeRiskContext,
    EvaluateSqueezeRiskOptions,
    SqueezeRiskLevel,
    SqueezeRiskComponentId,
    SqueezeRiskComponent,
    SqueezeRiskSufficiency,
    SqueezeRiskScore,
} from './domain/types';

// Model spec helpers
export {
    getProvider,
    getThinkingLevelSequence,
    isChatGPTModel,
    isClaudeModel,
    isDeepSeekModel,
    isGeminiModel,
    isReasoningToggleable,
    supportsHardOff,
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
export { computeMarketReference } from './domain/analysis/marketReference';
export { krxTickSize, roundToKrxTick } from './domain/analysis/krxTick';
export { classifyMaStack } from './domain/analysis/trendStructure';
export {
    OVERLAY_LEVEL_LABELS,
    STRATEGY_KIND_SOURCE_REF,
    STRATEGY_OVERLAY_KINDS,
} from './domain/overlays/constants';
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
// Spec-driven session helpers + canonical spec constants (browser-safe; same
// pure-domain rationale as getEtSessionStatus above).
export {
    US_EQUITY_SESSION,
    CRYPTO_SESSION,
    getSessionStatus,
    isRegularSessionOpen,
} from './domain/session';

// NYSE 거래소 캘린더 — 순수 계산이라 브라우저에서도 그대로 쓴다 (네트워크 호출 없음).
export {
    EARLY_CLOSE_MINUTE,
    REGULAR_CLOSE_MINUTE,
    isUsMarketEarlyClose,
    isUsMarketHoliday,
    isUsTradingDay,
    minutesUntilUsMarketClose,
    usMarketCloseMinute,
} from './domain/marketCalendar';
export type {
    AssetClass,
    EtSessionStatus,
    MarketSessionStatus,
    MarketSessionSpec,
} from './domain/types';

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
    ChatGptEffortLevel,
    ChatGptReasoningConfig,
    ClaudeAdaptiveModelSpec,
    ClaudeAdaptiveReasoningConfig,
    ClaudeBudgetModelSpec,
    ClaudeBudgetReasoningConfig,
    ClaudeEffortLevel,
    ClaudeModelSpec,
    DeepSeekModelSpec,
    DeepSeekReasoningConfig,
    EffortLevel,
    GeminiModelSpec,
    GeminiReasoningConfig,
    GeminiThinkingLevel,
    ModelSpec,
    ReasoningModes,
} from './domain/types';
export {
    isClaudeAdaptiveModelSpec,
    isClaudeBudgetModelSpec,
    isClaudeModelSpec,
    isTemperatureModelSpec,
    resolveReasoningConfig,
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
export type { FmpConfig } from './infrastructure/fmp/types';
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
} from './application/chat/types';
export type {
    PollAnalysisOptions,
    SubmitAnalysisGatedResult,
    SubmitAnalysisMissNoTrigger,
    UserApiKeyRequiredError,
} from './application/market/types';
export type { PollOverallAnalysisOptions } from './application/overall/types';
export type {
    AnalysisLimitError,
    AnalysisLimitErrorCode,
    ChatbotLimitError,
    ChatbotLimitErrorCode,
} from './application/usage';

// Domain types
export type {
    AnalysisSignalType,
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
    FearGreedInputs,
    FearGreedLabelTransition,
    FearGreedReading,
    FearGreedScoreGap,
    ExtremeFearGreedZone,
    ExtremeZoneEpisode,
    ExtremeZoneEpisodeOptions,
    ExtremeZoneEpisodeSummary,
    ExtremeZoneOutcome,
    ExtremeZoneOutcomeOptions,
    ForwardChangeStat,
    FearGreedLabel,
    FearGreedSnapshot,
    FearGreedWarning,
    CryptoDailyBar,
    CryptoFearGreedInput,
    CryptoFearGreedFactorKey,
    CryptoFearGreedFactor,
    CryptoFearGreedSnapshot,
    MarketDailyClose,
    MarketFearGreedFactor,
    MarketFearGreedFactorKey,
    MarketFearGreedHistoryPoint,
    MarketFearGreedInput,
    MarketFearGreedSeriesKey,
    MarketFearGreedSnapshot,
    FundamentalAnalysisResponse,
    FundamentalAnalystEstimateInput,
    FundamentalCashFlowInput,
    FundamentalCategory,
    FundamentalCategoryAssessment,
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
    PriceTargetAvg,
    Timeframe,
    Tier,
    MeteredRevealPolicy,
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
    BollingerDerivedResult,
    ChandelierResult,
    ChandelierTrend,
    ElderRayResult,
    ImpulseColor,
    RegressionResult,
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
    SkillUsageRole,
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
    AnalysisDataAsOf,
    AnalysisResponse,
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
    MarketReference,
    HorizonReference,
    PivotTables,
    StandardPivotLevels,
    CamarillaPivotLevels,
    FibonacciPivotLevels,
    WoodiePivotLevels,
    DeMarkPivotLevels,
    FibonacciProjection,
    FibonacciLevel,
    AbcExtensionProjection,
    SwingLegDirection,
    HorizonWindow,
    HorizonKey,
    TrendStructure,
    ReferenceLevel,
    ReferenceLevels,
    ReferenceLevelKind,
    PriceVsLevel,
    EmaStackState,
    MaStackDirection,
    SwingStructureState,
    MarketRegime,
    QuadrantKey,
    PriceTarget,
    PriceScenario,
    PriceTargets,
    PatternSummary,
    PatternResult,
    PatternTargetGeometry,
    PatternBreakoutDirection,
    StrategyResult,
    CandlePatternSummary,
    Trendline,
    TrendlineDirection,
    TrendlinePoint,
    // Chart overlays (spec 2026-09-28) — logic-drawn coordinates the model selects by id.
    ChartOverlay,
    OverlayKind,
    StrategyOverlayKind,
    OverlayPane,
    OverlayPoint,
    OverlaySegment,
    OverlayLevel,
    OverlayLabel,
    OverlayLineStyle,
    OverlayLabelPosition,
    OverlayVariant,
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
    MarketBriefingContext,
    MarketBriefingResponse,
    MarketBriefingSectorAnalysis,
    MarketBriefingVolatilityAnalysis,
    CandlePattern,
    MultiCandlePattern,
    CandlePatternEntry,
    SingleCandlePatternEntry,
    MultiCandlePatternEntry,
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
    ModelAccess,
    MarketSummaryData,
    BarsData,
    PollAnalysisResult,
    SubmitBriefingResult,
    PollBriefingResult,
    ReconciledTpEntry,
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
