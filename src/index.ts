export { createCacheProvider } from './infrastructure/cache/redis';
export {
    ANALYSIS_CACHE_TTL,
    CACHE_EXPIRY_HOUR_KST,
    MARKET_BRIEFING_CACHE_TTL,
    SECTOR_SIGNALS_TTL_BY_TIMEFRAME,
    TICKER_SEARCH_CACHE_TTL,
    KOREAN_NAMES_CACHE_TTL,
    buildAnalysisCacheKey,
    buildAssetInfoCacheKey,
    buildBriefingCacheKey,
    buildSectorSignalsCacheKey,
    buildTickerSearchCacheKey,
    computeEffectiveTtl,
} from './infrastructure/cache/config';
export {
    ISO_DATE_HOUR_PREFIX_LENGTH,
    ISO_DATE_PREFIX_LENGTH,
} from './domain/constants/format';

export { callGeminiWithKeyFallback } from './infrastructure/ai/gemini';
export { AI_SYSTEM_PROMPT } from './infrastructure/ai/utils';

export {
    setJobMeta,
    getJobStatus,
    getJobResult,
    getJobError,
    getJobMeta,
    setJobStatus,
    setJobResult,
    setJobError,
    cancelJob,
    isJobCancelled,
    cleanupJob,
} from './infrastructure/jobs/queue';

export type { CacheProvider } from './infrastructure/cache/types';
export type {
    GeminiRole,
    GeminiContents,
    GeminiContent,
    GeminiPart,
    CallGeminiWithKeyFallbackOptions,
} from './infrastructure/ai/types';
export type { JobStatus, JobMeta } from './infrastructure/jobs/types';

export { calculateMA } from './domain/indicators/ma';
export { calculateIndicators } from './domain/indicators';

export { createMarketDataProvider } from './infrastructure/market/factory';
export { readFmpConfig, tryReadFmpConfig } from './infrastructure/fmp/config';
export type { FmpConfig } from './infrastructure/fmp/types';
export { fetchBarsWithIndicators } from './application/market/barsApi';
export { submitAnalysis } from './application/market/submitAnalysis';
export { pollAnalysis } from './application/market/pollAnalysis';
export { cancelAnalysisJob } from './application/market/cancelAnalysisJob';
export { submitBriefing } from './application/market/submitBriefing';
export { pollBriefing } from './application/market/pollBriefing';
export {
    tryAcquireReanalyzeCooldown,
    releaseReanalyzeCooldown,
    getReanalyzeCooldownMs,
} from './infrastructure/market/reanalyzeCooldown';

export { FileSkillsLoader } from './infrastructure/skills/loader';
export type { SkillsProvider } from './infrastructure/skills/types';

// ─── Ticker (search / asset info / Korean names) ─────────────────────────────
export {
    filterUsExchanges,
    searchByName,
    searchBySymbol,
    toTickerSearchResult,
} from './infrastructure/ticker/fmpTickerApi';
export {
    getKoreanNames,
    searchByKoreanName,
    setKoreanTickers,
} from './infrastructure/ticker/koreanNameStore';
export { translateCompanyNames } from './infrastructure/ticker/koreanTranslator';
export { tryReadTranslatorConfig } from './infrastructure/ticker/config';
export { getAssetInfo } from './application/ticker/getAssetInfo';
export { searchTicker } from './application/ticker/searchTicker';
export type {
    FmpSearchResult,
    TranslatorConfig,
    TranslatorEntry,
} from './infrastructure/ticker/types';
export {
    deduplicateResults,
    isKoreanInput,
    isValidTickerFormat,
} from './domain/ticker';

// ─── Dashboard (market summary / sector signals) ─────────────────────────────
export { getMarketSummary } from './application/dashboard/getMarketSummary';
export { getMarketSummaryWithBriefing } from './application/dashboard/getMarketSummaryWithBriefing';
export { getSectorSignals } from './application/dashboard/sectorSignals';
export {
    bucketedTimestamp,
    computeStockSignalResult,
    lookbackIsoFromNow,
} from './domain/dashboard';
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
export { classifyTrend, detectSignals } from './domain/signals';

export { enrichAnalysisWithConfidence } from './domain/analysis/confidence';
export { normalizeMarketBriefing } from './domain/analysis/normalizeMarketBriefing';

export {
    detectRsiOversold,
    detectRsiOverbought,
    findCross,
    findThresholdCross,
    detectGoldenCross,
    detectDeathCross,
    detectMacdBullishCross,
    detectMacdBearishCross,
    detectBollingerLowerBounce,
    detectBollingerUpperBreakout,
    detectSupertrendBullishFlip,
    detectIchimokuCloudBreakout,
    detectCciBullishCross,
    detectDmiBullishCross,
    detectCmfBullishFlip,
    detectMfiOversoldBounce,
    detectParabolicSarFlip,
    detectKeltnerUpperBreakout,
    detectSqueezeMomentumBullish,
} from './domain/signals/confirmed';

export {
    findPivotLows,
    findPivotHighs,
    computeBbWidth,
    computePctB,
    computeEmaSlope,
    percentileRank,
    detectRsiBullishDivergence,
    detectRsiBearishDivergence,
    detectMacdHistogramBullishConvergence,
    detectMacdHistogramBearishConvergence,
    detectBollingerSqueezeBullish,
    detectBollingerSqueezeBearish,
    detectSupportProximityBullish,
    detectResistanceProximityBearish,
} from './domain/signals/anticipation';

export {
    detectCandlePattern,
    detectMultiCandlePattern,
} from './domain/analysis/candle';

export {
    getCandlePatternLabel,
    getMultiCandlePatternLabel,
    findCandlePatternLabel,
    CANDLE_PATTERN_LABELS,
    MULTI_CANDLE_PATTERN_LABELS,
} from './domain/analysis/candle-labels';

export {
    getSinglePatternTrend,
    getMultiPatternTrend,
    EXCLUDED_SINGLE_PATTERNS,
} from './domain/analysis/candle-trend';

export {
    detectCandlePatternEntries,
    getDetectionBars,
    selectLastCandlePatternEntries,
    CANDLE_PATTERN_DETECTION_BARS,
    MULTI_CANDLE_PATTERN_BUFFER,
} from './domain/analysis/candle-detection';

export {
    buildAnalysisPrompt,
    PROMPT_CONFIG_BY_TIMEFRAME,
} from './domain/analysis/prompt';

export { buildMarketBriefingPrompt } from './domain/analysis/marketBriefingPrompt';

export { buildChatPrompt } from './domain/chat/buildChatPrompt';

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
    SubmitBriefingResult,
    PollBriefingResult,
} from './domain/types';
