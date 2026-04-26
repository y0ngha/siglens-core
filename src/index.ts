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

// =============================================================================
// Tier 2 — Domain Building Blocks
// =============================================================================
// High-level pure-function entry points. Individual indicators / detectors are
// internal — call calculateIndicators() / detectSignals() instead.

// Aggregate calculators / detectors
export { calculateIndicators } from './domain/indicators';
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
    getSinglePatternTrend,
    getMultiPatternTrend,
} from './domain/analysis/candle-trend';

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

// Skills loader
export { FileSkillsLoader } from './infrastructure/skills/loader';

// Config readers
export { readFmpConfig, tryReadFmpConfig } from './infrastructure/fmp/config';

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

// Infrastructure interfaces
export type { CacheProvider } from './infrastructure/cache/types';
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

// Domain types
export type {
    Timeframe,
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
    ReconciledActionLevels,
    IndicatorGuideResult,
    KeyLevel,
    KeyLevels,
    KeyPrice,
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
    ChatMessage,
    ChatPromptPayload,
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
} from './domain/types';
