import { describe, expect, it } from 'vitest';
import {
    AI_SYSTEM_PROMPT,
    computeFinancialsScorecard,
    DEEPSEEK_V4_1_FLASH_MODEL,
    DEEPSEEK_V4_1_PRO_MODEL,
    DEFAULT_TIER,
    EMA_DEFAULT_PERIODS,
    GEMINI_FLASH_LITE_MODEL,
    buildRevealedTierConfig,
    getAllowedModels,
    getMeteredRevealPolicy,
    getAllowedTimeframes,
    getTierLimit,
    HIGH_CONFIDENCE_WEIGHT,
    isAllowed,
    isDeepSeekModel,
    isInfoDepthAllowed,
    isModelAllowed,
    isTier,
    isTimeframeAllowed,
    normalizeFinancialsAnalysisResponse,
    normalizeFinancialsSnapshot,
    TIER_CONFIG,
    VALID_CHAT_MODELS,
} from '@/index.client';
import * as clientApi from '@/index.client';
import type {
    BacktestBenchmarks,
    BacktestDistribution,
    BacktestRunData,
    BacktestTickerBaseline,
    MeasuredSignalBaseRate,
    MeasuredSignalHorizon,
    MeasuredSignalScope,
    InvestorFlowsDataProvider,
    InvestorFlowsScorecard,
    FinancialSignal,
    FinancialSignalType,
    FinancialStatementsProvider,
    FinancialsAnalysisResponse,
    FinancialsSnapshot,
    ModelId,
    OverallAnalysisResponse,
    SectorGroupDef,
    SkillType,
    TierConfig,
} from '@/index.client';

describe('browser public API exports', () => {
    it('exports the measured base rates and their lookup (WP-18 C4, API-1: both entrypoints)', () => {
        expect(typeof clientApi.measuredBaseRateFor).toBe('function');
        expect(clientApi.BASE_RATE_MIN_N).toBe(100);
        expect(clientApi.CANDLE_OUTCOME_BARS).toBe(5);
        expect(clientApi.PRICE_LEVEL_BASE_RATE.subject).toBe('price_level');
        expect(Object.keys(clientApi.PRICE_LEVEL_FAMILY_BASE_RATES)).toContain(
            'fib'
        );
        expect(clientApi.priceLevelFamilyBaseRateFor('fib')?.key).toBe('fib');
        expect(clientApi.priceLevelFamilyBaseRateFor('vwap')).toBeNull();
        expect(Object.keys(clientApi.PATTERN_BASE_RATES)).toContain(
            'double_bottom'
        );
        expect(Object.keys(clientApi.CANDLE_BASE_RATES)).toContain('hammer');
        expect(clientApi.PATTERN_POOLED_BASE_RATE).toMatchObject({
            subject: 'chart_pattern',
            key: 'pooled',
        });
        expect(clientApi.CANDLE_POOLED_BASE_RATE).toMatchObject({
            subject: 'candle_pattern',
            key: 'pooled',
        });
        expect(
            clientApi.measuredBaseRateFor(
                'chart_pattern',
                'double_bottom',
                '1Day'
            )
        ).toBe(clientApi.PATTERN_BASE_RATES.double_bottom);
        expect(
            clientApi.measuredBaseRateFor('candle_pattern', 'hammer', '1Day')
        ).toBe(clientApi.CANDLE_BASE_RATES.hammer);
        expect(
            clientApi.measuredBaseRateFor(
                'chart_pattern',
                'double_bottom',
                '1Hour'
            )
        ).toBeNull();
    });

    it('exports the canonical serializer behind tradesSha256 (WP-26, API-1: both entrypoints)', () => {
        expect(
            clientApi.canonicalJson({
                b: [2, undefined],
                a: { y: 1, x: undefined },
            })
        ).toBe('{"a":{"y":1},"b":[2,null]}');
        expect(() => clientApi.canonicalJson(Number.NaN)).toThrow(TypeError);
    });

    it('exports the measured signal base rates and their lookup (WP-32 G14, API-1: both entrypoints)', () => {
        expect(typeof clientApi.measuredSignalBaseRateFor).toBe('function');
        expect(Object.keys(clientApi.MEASURED_SIGNAL_BASE_RATES)).toContain(
            'golden_cross'
        );
        const entry: MeasuredSignalBaseRate | null =
            clientApi.measuredSignalBaseRateFor('golden_cross', '1Day');
        expect(entry).toBe(clientApi.MEASURED_SIGNAL_BASE_RATES.golden_cross);
        const scope: MeasuredSignalScope | undefined = entry?.scope;
        const horizon: MeasuredSignalHorizon | undefined = entry?.horizons[0];
        expect(scope?.timeframe).toBe('1Day');
        expect(horizon?.h).toBe(1);
        expect(
            clientApi.measuredSignalBaseRateFor('golden_cross', '1Hour')
        ).toBeNull();
    });

    it('exports the backtest benchmark types with the optional run fields (WP-26 core-1, API-3: both entrypoints)', () => {
        // Compile-time: the benchmark rides on the run data and the baselines as optional additions.
        const distribution: BacktestDistribution = {
            p5: -1,
            median: 0,
            p95: 1,
        };
        const benchmarks: BacktestBenchmarks = {
            version: 1,
            tradesSha256: 'sha',
            barsFingerprint: 'bars',
            coreSha: 'core',
            holdPortfolio: { returnPct: 1, maxDrawdownPct: -1 },
            exposureMatchedHold: {
                exposurePct: 50,
                returnPct: 1,
                maxDrawdownPct: -1,
            },
            strategyMarkToMarketMaxDrawdownPct: -1,
            perTradeExcess: {
                basis: 'same_length_drift',
                n: 1,
                meanPct: 0,
                ci95: { low: -1, high: 1 },
                clusters: 'week',
            },
            randomEntry: {
                draws: 1,
                seed: 1,
                returnPct: distribution,
                maxDrawdownPct: distribution,
                shareAboveStrategyReturn: 0.5,
                shareWithSmallerDrawdown: 0.5,
            },
            bracket: {
                n: 1,
                initialPlan: { resolvedRaces: 1, targetFirstShare: 0.5 },
                placebo: { resolvedRaces: 1, targetFirstShare: 0.5 },
                storedTargetFirstShare: 0.5,
            },
        };
        const older = {} as BacktestRunData;
        const withBenchmarks: BacktestRunData = { ...older, benchmarks };
        const baseline: BacktestTickerBaseline = {
            ticker: 'AAA',
            buyHoldPct: 1,
            buyHoldMaxDrawdownPct: -1,
            tradingDays: 1,
            exposureMatchedHoldPct: 1,
            markToMarketMaxDrawdownPct: -1,
        };
        expect(withBenchmarks.benchmarks?.version).toBe(1);
        expect(baseline.tradingDays).toBe(1);
    });

    it('exports domain values used by browser consumers', () => {
        const skillType: SkillType = 'indicator_guide';
        const modelId: ModelId = 'gemini-3.1-pro-preview';
        const tierConfig: TierConfig = TIER_CONFIG;
        const sectorGroup: SectorGroupDef = {
            label: 'Technology',
            symbols: ['AAPL'],
        };
        expect(sectorGroup.label).toBe('Technology');

        expect(EMA_DEFAULT_PERIODS).toEqual([9, 20, 21, 60]);
        expect(GEMINI_FLASH_LITE_MODEL).toBe('gemini-3.5-flash-lite');
        expect(DEEPSEEK_V4_1_FLASH_MODEL).toBe('deepseek-v4.1-flash');
        expect(DEEPSEEK_V4_1_PRO_MODEL).toBe('deepseek-v4.1-pro');
        expect(VALID_CHAT_MODELS).toContain('gemini-3.5-flash-lite');
        expect(VALID_CHAT_MODELS).toContain('deepseek-v4.1-flash');
        expect(isDeepSeekModel('deepseek-v4.1-flash')).toBe(true);
        expect(isDeepSeekModel('gemini-3.6-flash')).toBe(false);
        expect(DEFAULT_TIER).toBe('free');
        expect(getAllowedModels('free')).toContain('claude-opus-5');
        expect(getMeteredRevealPolicy('free')?.revealAs).toBe('member');
        expect(typeof buildRevealedTierConfig).toBe('function');
        expect(getAllowedTimeframes('free')).toEqual(['1Day']);
        expect(isTimeframeAllowed('free', '5Min')).toBe(false);
        expect(isInfoDepthAllowed('free', 'full_detail')).toBe(false);
        expect(isModelAllowed('free', modelId, tierConfig)).toBe(true);
        expect(HIGH_CONFIDENCE_WEIGHT).toBe(0.8);
        expect(typeof DEFAULT_TIER).toBe('string');
        expect(typeof TIER_CONFIG).toBe('object');
        expect(typeof getTierLimit).toBe('function');
        expect(typeof isAllowed).toBe('function');
        expect(typeof isInfoDepthAllowed).toBe('function');
        expect(typeof isModelAllowed).toBe('function');
        expect(typeof isTier).toBe('function');
        expect(typeof isTimeframeAllowed).toBe('function');
        expect(clientApi.FEAR_GREED_LABEL_CUTOFFS.NEUTRAL_MAX).toBe(55);
        expect(clientApi.POC_WINDOW_DEFAULT).toBe(60);
        expect(clientApi.scoreToLabel(10)).toBe('EXTREME_FEAR');
        expect(typeof clientApi.classifyMaStack).toBe('function');
        expect(typeof clientApi.rsiZone).toBe('function');
        expect(clientApi.rsiZone(37.5)).toBe('neutral');
        expect(typeof clientApi.classifyOscillatorZones).toBe('function');
        expect(
            clientApi.classifyOscillatorZones({
                rsi: 37.5,
                stochasticK: null,
                williamsR: null,
                cci: null,
                mfi: null,
            }).zones.rsi
        ).toBe('neutral');
        expect(clientApi.STRATEGY_KIND_SOURCE_REF).toEqual({
            divergence: 'kind:divergence',
            fibonacci: 'kind:fibonacci',
            elliott: 'kind:elliott',
        });
        // The chart localizes level labels in the browser bundle (siglens).
        expect(clientApi.OVERLAY_LEVEL_LABELS).toEqual({
            breakout: 'breakout',
            invalidation: 'invalidation',
            target: 'target',
            wave5Cap: 'wave5_cap',
        });
        expect(clientApi.STRATEGY_OVERLAY_KINDS).toEqual([
            'divergence',
            'fibonacci',
            'elliott',
        ]);
        // The siglens catalog validator checks `computed_card` tags against this list (API-1: both entrypoints).
        expect(clientApi.COMPUTED_CARD_KINDS).toHaveLength(38);
        expect(clientApi.COMPUTED_CARD_KINDS).toContain('ma_cycle');
        expect(clientApi.COMPUTED_CARD_KINDS).toContain('rsi');
        expect(clientApi.MA_CYCLE_PERIODS).toEqual({
            short: 5,
            medium: 20,
            long: 60,
        });
        expect(clientApi.CYCLE_LOOKBACK_BARS).toBe(120);
        // Consumers round displayed KRX prices with the same rule core uses.
        expect(clientApi.roundToKrxTick(205_325)).toBe(205_500);
        expect(clientApi.krxTickSize(215_000)).toBe(500);
        expect(skillType).toBe('indicator_guide');
    });

    it('exports fundamental / news / overall domain symbols for browser consumers', () => {
        // Runtime exports must be callable on the browser entry.
        expect(typeof AI_SYSTEM_PROMPT).toBe('string');
        expect(AI_SYSTEM_PROMPT.length).toBeGreaterThan(0);

        // Type assignability check (compile-time only).
        const overall = {} as OverallAnalysisResponse;
        void overall;
    });

    it('exports the new-signal and extreme-zone-entry rules for browser consumers', () => {
        expect(typeof clientApi.detectNewConfirmedSignals).toBe('function');
        expect(typeof clientApi.findExtremeZoneEntryOn).toBe('function');
        expect(typeof clientApi.confirmedSignalTimeline).toBe('function');
        expect(clientApi.SIGNAL_SCAN_DAILY_LOOKBACK_DAYS).toBe(400);
    });

    it('exports the MA-cross detector constants (golden/death 50/200, short-term 20/50)', () => {
        expect(clientApi.GOLDEN_CROSS_FAST_PERIOD).toBe(50);
        expect(clientApi.GOLDEN_CROSS_SLOW_PERIOD).toBe(200);
        expect(clientApi.SHORT_MA_CROSS_FAST_PERIOD).toBe(20);
        expect(clientApi.SHORT_MA_CROSS_SLOW_PERIOD).toBe(50);
        expect(clientApi.CROSS_LOOKBACK_BARS).toBe(3);
    });

    it('does not export server-only runtime entrypoints', () => {
        expect('FileSkillsLoader' in clientApi).toBe(false);
        expect('createSkillsProvider' in clientApi).toBe(false);
        expect('submitAnalysis' in clientApi).toBe(false);
        expect('requestChatCompletion' in clientApi).toBe(false);
        expect('createCacheProvider' in clientApi).toBe(false);
    });

    it('exports the pure investor flows (수급) helpers for browser consumers, not the server use-case', () => {
        expect(typeof clientApi.evaluateInvestorFlows).toBe('function');
        expect(typeof clientApi.normalizeInvestorFlowsAnalysisResponse).toBe(
            'function'
        );
        expect(clientApi.INVESTOR_FLOWS_AXES).toEqual([
            'institutional',
            'insider',
            'largeHolders',
            'short',
            'dilution',
        ]);
        expect(typeof clientApi.evaluateSqueezeRisk).toBe('function');
        expect(
            clientApi.evaluateSqueezeRisk(
                {
                    asOf: '2026-10-15',
                    sharesOutstanding: null,
                    floatShares: null,
                    institutional: {
                        quarters: [],
                        topHolders: [],
                        topHoldersPeriod: null,
                    },
                    insider: { transactions: [] },
                    largeHolders: null,
                    shortInterest: null,
                    shortVolume: null,
                },
                { dailyBars: [] }
            ).sufficiency
        ).toBe('insufficient');
        expect('runInvestorFlowsAnalysis' in clientApi).toBe(false);
        expect('buildInvestorFlowsAnalysisPrompt' in clientApi).toBe(false);

        const scorecard = {} as InvestorFlowsScorecard;
        const provider = {} as InvestorFlowsDataProvider;
        void scorecard;
        void provider;
    });

    it('exports financials pure-domain helpers for browser consumers', () => {
        // Runtime functions must be present and callable.
        expect(typeof computeFinancialsScorecard).toBe('function');
        expect(typeof normalizeFinancialsAnalysisResponse).toBe('function');
        expect(typeof normalizeFinancialsSnapshot).toBe('function');

        // Verify server-only use-cases are NOT present on the client barrel.
        expect('submitFinancialsAnalysis' in clientApi).toBe(false);
        expect('pollFinancialsAnalysis' in clientApi).toBe(false);
        expect('cancelFinancialsAnalysisJob' in clientApi).toBe(false);
        // Reclassified as @internal (return type changed to AssembledPrompt) —
        // must NOT be present on either public barrel.
        expect('buildFinancialsAnalysisPrompt' in clientApi).toBe(false);
        expect('buildCongressTrendPrompt' in clientApi).toBe(false);
        expect('buildEconomicEventAnalysisPrompt' in clientApi).toBe(false);
        expect('buildIndicatorTranslationPrompt' in clientApi).toBe(false);
        expect('buildOptionsAnalysisPrompt' in clientApi).toBe(false);

        // Type-level assertions (compile-time only — void to suppress lint).
        const signalType: FinancialSignalType = 'margin_expansion';
        const signal: FinancialSignal = {
            type: signalType,
            direction: 'positive',
            labelKo: '마진 개선',
        };
        const snapshot = {} as FinancialsSnapshot;
        const response = {} as FinancialsAnalysisResponse;
        const provider = {} as FinancialStatementsProvider;
        void signal;
        void snapshot;
        void response;
        void provider;
    });
});

describe('client entrypoint export presence (API-1)', () => {
    const exportsByName = clientApi as Record<string, unknown>;

    const FUNCTION_EXPORTS: readonly string[] = [
        'calculateIchimokuFutureCloud',
        'canonicalJson',
        'calculateIndicators',
        'calculateMA',
        'computeCryptoFearGreedHistory',
        'computeCryptoFearGreedIndex',
        'computeFearGreedHistory',
        'computeFearGreedIndex',
        'computeLabelTransitions',
        'computeMarketFearGreedHistory',
        'computeMarketFearGreedIndex',
        'computeMarketScoreGap',
        'fearGreedInputs',
        'summarizeExtremeZoneEpisodes',
        'summarizeExtremeZoneOutcomes',
        'classifyTrend',
        'detectSignals',
        'buildChatPrompt',
        'isValidAnalysisLocale',
        'getProviderForModel',
        'getModelAccess',
        'isFreeModel',
        'isPremiumModel',
        'requiresAuth',
        'requiresByokKey',
        'summarizeChainForLlm',
        'aggregateOpenInterest',
        'sanitizeOptionsChain',
        'mapExpirationsToSlots',
        'splitAgentFollowUps',
        'normalizeEconomicIndicatorSeries',
        'normalizeTreasuryRates',
        'computeYieldSpread',
        'normalizeEconomicCalendar',
        'isRateDecisionEvent',
        'selectCalendarEvents',
        'normalizeEconomicEventAnalysis',
        'normalizeIndicatorTranslation',
        'normalizeCongressTrades',
        'summarizeCongressTrades',
        'normalizeCongressTrendResponse',
        'getProvider',
        'getThinkingLevelSequence',
        'isChatGPTModel',
        'isClaudeModel',
        'isGeminiModel',
        'isReasoningToggleable',
        'supportsHardOff',
        'detectCandlePatternEntries',
        'getDetectionBars',
        'selectLastCandlePatternEntries',
        'getCandlePatternLabel',
        'getMultiCandlePatternLabel',
        'getSinglePatternTrend',
        'getMultiPatternTrend',
        'clusterKeyLevels',
        'validateKeyLevels',
        'computeMarketReference',
        'extractReconciledActionLines',
        'validateActionPrices',
        'filterAnalysisResult',
        'bucketedTimestamp',
        'computeStockSignalResult',
        'lookbackIsoFromNow',
        'getEtSessionStatus',
        'isEtRegularSessionOpen',
        'getSessionStatus',
        'isRegularSessionOpen',
        'isUsMarketEarlyClose',
        'isUsMarketHoliday',
        'isUsTradingDay',
        'minutesUntilUsMarketClose',
        'usMarketCloseMinute',
        'isClaudeAdaptiveModelSpec',
        'isClaudeBudgetModelSpec',
        'isClaudeModelSpec',
        'isTemperatureModelSpec',
        'resolveReasoningConfig',
    ];
    const VALUE_EXPORTS: readonly string[] = [
        'CRYPTO_FEAR_GREED_FACTOR_KEYS',
        'EXTREME_FEAR_GREED_ZONES',
        'EXTREME_ZONE_FORWARD_HORIZONS',
        'EXTREME_ZONE_MIN_SAMPLE',
        'EXTREME_ZONE_REENTRY_GAP',
        'MARKET_FEAR_GREED_FACTOR_KEYS',
        'MARKET_FEAR_GREED_SERIES_KEYS',
        'FEAR_GREED_LOOKBACK_DAYS',
        'ANALYSIS_LOCALES',
        'DEFAULT_ANALYSIS_LOCALE',
        'AGENT_FOLLOW_UP_MARKER',
        'US_EQUITY_SESSION',
        'CRYPTO_SESSION',
        'EARLY_CLOSE_MINUTE',
        'REGULAR_CLOSE_MINUTE',
        'MARKET_CLOSE_HOUR',
        'MARKET_CLOSE_MINUTE',
        'MARKET_OPEN_HOUR',
        'MARKET_OPEN_MINUTE',
        'MODEL_SPECS',
        'CCI_DEFAULT_PERIOD',
        'CCI_OVERBOUGHT_LEVEL',
        'CCI_OVERSOLD_LEVEL',
        'CCI_ZERO_LEVEL',
        'DMI_DEFAULT_PERIOD',
        'EMPTY_INDICATOR_RESULT',
        'EMPTY_SMC_RESULT',
        'MA_DEFAULT_PERIODS',
        'MACD_FAST_PERIOD',
        'MACD_SIGNAL_PERIOD',
        'MACD_SLOW_PERIOD',
        'RSI_DEFAULT_PERIOD',
        'RSI_OVERBOUGHT_LEVEL',
        'RSI_OVERSOLD_LEVEL',
        'STOCHASTIC_D_PERIOD',
        'STOCHASTIC_K_PERIOD',
        'STOCHASTIC_OVERBOUGHT_LEVEL',
        'STOCHASTIC_OVERSOLD_LEVEL',
        'STOCHASTIC_SMOOTHING',
        'STOCH_RSI_D_PERIOD',
        'STOCH_RSI_K_PERIOD',
        'STOCH_RSI_OVERBOUGHT_LEVEL',
        'STOCH_RSI_OVERSOLD_LEVEL',
        'STOCH_RSI_RSI_PERIOD',
        'STOCH_RSI_STOCH_PERIOD',
    ];

    it.each(FUNCTION_EXPORTS)('exports %s as a function', name => {
        expect(typeof exportsByName[name]).toBe('function');
    });

    it.each(VALUE_EXPORTS)('exports %s as a defined value', name => {
        expect(exportsByName[name]).toBeDefined();
    });

    it.each([
        'alertablePlanLevels',
        'priceLevelStart',
        'isPriceLevelMet',
        'findPriceLevelTrigger',
    ])('does not export the server-only %s', name => {
        expect(name in exportsByName).toBe(false);
    });
});
