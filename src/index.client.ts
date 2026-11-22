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
    findExtremeZoneEntryOn,
    MARKET_FEAR_GREED_FACTOR_KEYS,
    MARKET_FEAR_GREED_SERIES_KEYS,
    POC_WINDOW_DEFAULT,
    scoreToLabel,
    summarizeExtremeZoneEpisodes,
    summarizeExtremeZoneOutcomes,
} from './domain/indicators';
export { FEAR_GREED_LOOKBACK_DAYS } from './domain/constants/market';
// Pure simple moving average, same implementation as the server entrypoint.
export { calculateMA } from './domain/indicators/ma';
export { classifyTrend, detectSignals } from './domain/signals';
export { detectNewConfirmedSignals } from './domain/signals/newSignals';
export {
    confirmedSignalTimeline,
    SIGNAL_SCAN_DAILY_LOOKBACK_DAYS,
} from './domain/signals/timeline';
export type {
    ConfirmedSignalDay,
    ConfirmedSignalTimelineOptions,
} from './domain/signals/timeline';
export {
    CROSS_LOOKBACK_BARS,
    GOLDEN_CROSS_FAST_PERIOD,
    GOLDEN_CROSS_SLOW_PERIOD,
    SHORT_MA_CROSS_FAST_PERIOD,
    SHORT_MA_CROSS_SLOW_PERIOD,
} from './domain/signals/constants';

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

// Options analysis — domain helpers (server-only `run*` use-cases are
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

// Economy (macro) — domain helpers (server-only `run*`/peek use-cases are
// intentionally omitted; only pure domain functions belong on the browser
// entry, mirroring the options/financials patterns).
export { normalizeEconomicIndicatorSeries } from './domain/economy/normalizeEconomicIndicators';
export {
    normalizeTreasuryRates,
    computeYieldSpread,
} from './domain/economy/normalizeTreasuryRates';
export { normalizeEconomicCalendar } from './domain/economy/normalizeEconomicCalendar';
export {
    isRateDecisionEvent,
    selectCalendarEvents,
} from './domain/economy/selectCalendarEvents';
export type {
    CalendarSelection,
    SelectCalendarEventsOptions,
} from './domain/economy/types';
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
// server-only `runMacroBriefing` function stays omitted
// from the browser entry, but their pure result-type shapes are safe to expose.
// Likewise for the economic-event analysis use-case.
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

// Financials analysis — domain helpers (server-only `run*` use-cases
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

// Congress analysis — domain helpers (server-only `run*` use-cases
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
export type { MarketReferenceClock } from './domain/analysis/marketReference';
export { krxTickSize, roundToKrxTick } from './domain/analysis/krxTick';
export type { KrxTickTable } from './domain/analysis/krxTick';
export { classifyMaStack } from './domain/analysis/trendStructure';
export {
    OVERLAY_LEVEL_LABELS,
    STRATEGY_KIND_SOURCE_REF,
    STRATEGY_OVERLAY_KINDS,
} from './domain/overlays/constants';
// Computed cards (WP-16): the `computed_card` values a skill's frontmatter may take, for the
// siglens catalog validator (a Tier 4 constant, its own block per PUBLIC_API.md#API-7).
export { COMPUTED_CARD_KINDS } from './domain/analysis/computedCardKinds';
// MA-cycle periods (5/20/60) and the cycle observation window (120 bars): one source for the
// prompt text and for renderers (Tier 4 constants, own block per PUBLIC_API.md#API-7).
export {
    CYCLE_LOOKBACK_BARS,
    MA_CYCLE_PERIODS,
} from './domain/analysis/cycleConstants';
export {
    extractReconciledActionLines,
    validateActionPrices,
} from './domain/analysis/actionRecommendation';
export { filterAnalysisResult } from './domain/analysis/filterAnalysisResult';
// The measured base rates of the engines' claims on the daily replay set (WP-18 C4): the
// rows a pattern or candle card carries as `baseRate`, the price-level row, and the lookup
// the client uses for a result stored before `baseRate` existed. Pure, so both entrypoints.
export {
    BASE_RATE_MIN_N,
    CANDLE_BASE_RATES,
    PATTERN_BASE_RATES,
    PRICE_LEVEL_BASE_RATE,
    PRICE_LEVEL_FAMILY_BASE_RATES,
    measuredBaseRateFor,
    priceLevelFamilyBaseRateFor,
} from './domain/analysis/measuredBaseRates';
export type {
    BaseRateSubject,
    BaseRateVerdict,
    MeasuredBaseRate,
} from './domain/analysis/measuredBaseRates';
// Canonical JSON text (sorted keys, no whitespace): the serialization behind
// `BacktestBenchmarks.tradesSha256`, exported so a consumer hashes the same text (WP-26).
export { canonicalJson } from './domain/canonicalJson';
// The measured past record of each confirmed signal type on the daily replay set (WP-32
// G14): the share of directional moves after the signal against a matched placebo at 1, 5,
// 10 and 20 bars, with n, a verdict and the pooled scope. Shares only, never a return.
export {
    MEASURED_SIGNAL_BASE_RATES,
    measuredSignalBaseRateFor,
} from './domain/signals/measuredSignalBaseRates';
export type {
    MeasuredSignalBaseRate,
    MeasuredSignalHorizon,
    MeasuredSignalScope,
} from './domain/signals/measuredSignalBaseRates';

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
export { rsiZone } from './domain/indicators/rsiZone';
export type { RsiZone } from './domain/indicators/rsiZone';
export { classifyOscillatorZones } from './domain/indicators/oscillatorZones';
export type {
    OscillatorKey,
    OscillatorReadings,
    OscillatorZone,
    OscillatorZonesView,
} from './domain/indicators/oscillatorZones';

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
    ExtremeZoneEntry,
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
    ProviderTimeframe,
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
    TrendBasis,
    // Higher-timeframe block and market backdrop (WP-19).
    HigherTimeframeKind,
    TrendAlignment,
    HigherTimeframeReading,
    MarketBackdropSessions,
    MarketBackdropChange,
    MarketBackdropReading,
    MarketBenchmark,
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
    BacktestBenchmarks,
    BacktestDistribution,
    BacktestEntryType,
    BacktestLegExitReason,
    BacktestRunData,
    BacktestRunInfo,
    BacktestTickerBaseline,
    BacktestTrade,
    BacktestTradeLeg,
    BacktestTradePlan,
    BacktestTrendLabelStat,
    BacktestTrendRecognition,
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
    // Computed cards (WP-16) — the structured readings of indicator and cycle cards.
    IndicatorCardKind,
    CycleCardKind,
    ComputedCardKind,
    IndicatorCardBasis,
    IndicatorCardStates,
    IndicatorCardValues,
    IndicatorCardExtras,
    IndicatorCardSignal,
    IndicatorReading,
    CycleStage,
    CycleLineSlope,
    CycleReading,
    RawStrategyResult,
    // Chart overlays — logic-drawn coordinates the model selects by id.
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
    LlmProvider,
    WaitUntil,
} from './domain/types';

// Public-signature closure (PUBLIC_API.md#API-3): types referenced by exported
// function parameters/returns or by exported result unions must be nameable.
export type {
    BaseModelSpec,
    CurrencyCode,
    CurrentAnalysisContext,
    FilteredActionRecommendation,
    NewsImpact,
    NewsSourceLanguage,
    OverlayCandidate,
    PlanCheck,
    PlanPosition,
    PlanState,
    NoSetupReason,
    StopBasis,
    SkillGating,
    SkillStateFeature,
    SkillStatePredicate,
    SkillStatePredicateKind,
    UsageActionType,
    UsageCounts,
    UsageLogRecord,
} from './domain/types';
export type { BackgroundTaskOptions } from './application/types';
export type {
    CreateUsageLogInput,
    UsageLogRepository,
} from './domain/ports/usageLogRepository';
export type {
    RecordUsageInput,
    UsageRepository,
} from './domain/ports/usageRepository';
export type {
    SubmitAnalysisErrorResult,
    TierGateErrorResult,
    TierTimeframeAccessError,
} from './application/market/types';

export type {
    AnalysisOutcomeLabels,
    ForwardReturnLabel,
    LevelOutcome,
    LevelOutcomeEntry,
    LevelOutcomeLabel,
    LevelPlaceboLabel,
    LevelSide,
    LevelSkipReason,
    OutcomeAnchor,
    OutcomeAnchorSource,
    OutcomeBarTuple,
    OutcomeLevelRole,
    OutcomeSubject,
    OutcomeWindow,
    OutcomeWindowResult,
    PatternOutcome,
    PatternOutcomeLabel,
    PlanApproach,
    PlanOutcome,
    PlanOutcomeLabel,
    PlanReason,
    ScenarioTargetLabel,
} from './domain/outcomes/types';
export type {
    OutcomeRecordRow,
    OutcomeRecordSummary,
    OutcomeShareRecord,
} from './domain/outcomes/summarizeOutcomeRecord';
