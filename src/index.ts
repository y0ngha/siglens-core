export { createCacheProvider } from './infrastructure/cache/redis';
export {
    ANALYSIS_CACHE_TTL,
    CACHE_EXPIRY_HOUR_KST,
    MARKET_BRIEFING_CACHE_TTL,
    ISO_DATE_HOUR_PREFIX_LENGTH,
    buildAnalysisCacheKey,
    buildBriefingCacheKey,
    computeEffectiveTtl,
} from './infrastructure/cache/config';

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
export { fetchBarsWithIndicators } from './infrastructure/market/barsApi';
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
} from './domain/types';
