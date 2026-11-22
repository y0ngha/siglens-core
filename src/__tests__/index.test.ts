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
    InvestorFlowsSnapshot,
    RunInvestorFlowsAnalysisResult,
    ConfluenceHtfMode,
    ConfluenceParams,
    ConfluenceSnapshot,
    EvaluateConfluenceOptions,
    FinancialSignalType,
    NewsTimeRange,
    PatternTrend,
    SectorGroupDef,
    UsageRepository,
} from '@/index';
import {
    AGENT_BARS_TIMEFRAMES,
    AGENT_FILINGS_LIST_MAX,
    AGENT_FILINGS_WINDOW_DAYS,
    AGENT_FILING_TEXT_MAX_CHARS,
    AGENT_MACRO_INSTRUMENTS,
    AGENT_MACRO_QUOTES_MAX,
    AGENT_X_POST_TEXT_MAX_CHARS,
    AGENT_X_POSTS_MAX,
    AGENT_X_POSTS_PAGE_SIZE,
    AGENT_X_POSTS_WINDOW_DAYS,
    aggregateBarsToMonthly,
    aggregateBarsToWeekly,
    barPeriodStartSeconds,
    hasUsablePrices,
    buildPlanCheck,
    calculateMA,
    findMaCrosses,
    rsiZone,
    classifyOscillatorZones,
    isCompanyEarningsEvent,
    pullbackEventCaveat,
    planEntryPrice,
    CONFLUENCE_HTF_MODE,
    CONFLUENCE_MIN,
    CONFLUENCE_SPAN,
    CONFLUENCE_TRIGGER_SCORE,
    confluenceFamilyWeight,
    evaluateConfluence,
    isConfluenceExit,
    scoreConfluence,
    signalFamily,
    VOLUME_FAMILIES,
    runFinancialsAnalysis,
    checkAnalysisLimit,
    checkChatbotLimit,
    clusterKeyLevels,
    computeFinancialsScorecard,
    createChatTokenStore,
    DEEPSEEK_V4_1_FLASH_MODEL,
    DEEPSEEK_V4_1_PRO_MODEL,
    DEFAULT_TIER,
    EMA_DEFAULT_PERIODS,
    EMPTY_INDICATOR_RESULT,
    EMPTY_SMC_RESULT,
    extractReconciledActionLines,
    FEAR_GREED_LABEL_CUTOFFS,
    GEMINI_FLASH_LITE_MODEL,
    buildRevealedTierConfig,
    getAllowedModels,
    getMeteredRevealPolicy,
    getAllowedTimeframes,
    getTierLimit,
    hashUsageIp,
    HIGH_CONFIDENCE_WEIGHT,
    isAllowed,
    isDeepSeekModel,
    isInfoDepthAllowed,
    isModelAllowed,
    isTier,
    isTimeframeAllowed,
    normalizeFinancialsAnalysisResponse,
    normalizeFinancialsSnapshot,
    POC_WINDOW_DEFAULT,
    requestChatCompletion,
    RSI_DEFAULT_PERIOD,
    scoreToLabel,
    TIER_CONFIG,
    VALID_CHAT_MODELS,
    validateActionPrices,
} from '@/index';
import * as coreApi from '@/index';
import { describe, expect, it } from 'vitest';

describe('public API exports', () => {
    it('exports the measured base rates and their lookup (WP-18 C4, API-1: both entrypoints)', () => {
        expect(typeof coreApi.measuredBaseRateFor).toBe('function');
        expect(coreApi.BASE_RATE_MIN_N).toBe(100);
        expect(coreApi.PRICE_LEVEL_BASE_RATE.subject).toBe('price_level');
        expect(Object.keys(coreApi.PRICE_LEVEL_FAMILY_BASE_RATES)).toContain(
            'fib'
        );
        expect(coreApi.priceLevelFamilyBaseRateFor('fib')?.key).toBe('fib');
        expect(coreApi.priceLevelFamilyBaseRateFor('vwap')).toBeNull();
        expect(Object.keys(coreApi.PATTERN_BASE_RATES)).toContain(
            'double_bottom'
        );
        expect(Object.keys(coreApi.CANDLE_BASE_RATES)).toContain('hammer');
        expect(
            coreApi.measuredBaseRateFor(
                'chart_pattern',
                'double_bottom',
                '1Day'
            )
        ).toBe(coreApi.PATTERN_BASE_RATES.double_bottom);
        expect(
            coreApi.measuredBaseRateFor('candle_pattern', 'hammer', '1Day')
        ).toBe(coreApi.CANDLE_BASE_RATES.hammer);
        expect(
            coreApi.measuredBaseRateFor(
                'chart_pattern',
                'double_bottom',
                '1Hour'
            )
        ).toBeNull();
    });

    it('exports the canonical serializer behind tradesSha256 (WP-26, API-1: both entrypoints)', () => {
        expect(
            coreApi.canonicalJson({
                b: [2, undefined],
                a: { y: 1, x: undefined },
            })
        ).toBe('{"a":{"y":1},"b":[2,null]}');
        expect(() => coreApi.canonicalJson(Number.NaN)).toThrow(TypeError);
    });

    it('exports the measured signal base rates and their lookup (WP-32 G14, API-1: both entrypoints)', () => {
        expect(typeof coreApi.measuredSignalBaseRateFor).toBe('function');
        expect(Object.keys(coreApi.MEASURED_SIGNAL_BASE_RATES)).toContain(
            'golden_cross'
        );
        const entry: MeasuredSignalBaseRate | null =
            coreApi.measuredSignalBaseRateFor('golden_cross', '1Day');
        expect(entry).toBe(coreApi.MEASURED_SIGNAL_BASE_RATES.golden_cross);
        const scope: MeasuredSignalScope | undefined = entry?.scope;
        const horizon: MeasuredSignalHorizon | undefined = entry?.horizons[0];
        expect(scope?.timeframe).toBe('1Day');
        expect(horizon?.h).toBe(1);
        expect(
            coreApi.measuredSignalBaseRateFor('golden_cross', '1Hour')
        ).toBeNull();
    });

    it('exports indicator constants from package entrypoint', () => {
        expect(RSI_DEFAULT_PERIOD).toBe(14);
        expect(EMA_DEFAULT_PERIODS).toEqual([9, 20, 21, 60]);
        expect(EMPTY_INDICATOR_RESULT.smc).toBe(EMPTY_SMC_RESULT);
        expect(HIGH_CONFIDENCE_WEIGHT).toBe(0.8);
        expect(FEAR_GREED_LABEL_CUTOFFS.NEUTRAL_MAX).toBe(55);
        expect(POC_WINDOW_DEFAULT).toBe(60);
        expect(scoreToLabel(10)).toBe('EXTREME_FEAR');
    });

    it('exports the MA-stack classifier from package entrypoint', () => {
        // siglens' get_bars_indicators derived.maStack reads this instead of a local copy.
        expect(typeof coreApi.classifyMaStack).toBe('function');
        expect(coreApi.STRATEGY_KIND_SOURCE_REF).toEqual({
            divergence: 'kind:divergence',
            fibonacci: 'kind:fibonacci',
            elliott: 'kind:elliott',
        });
        expect(coreApi.STRATEGY_OVERLAY_KINDS).toEqual([
            'divergence',
            'fibonacci',
            'elliott',
        ]);
        // The siglens catalog validator checks `computed_card` tags against this list (API-1: both entrypoints).
        expect(coreApi.COMPUTED_CARD_KINDS).toHaveLength(38);
        expect(coreApi.COMPUTED_CARD_KINDS).toContain('ma_cycle');
        expect(coreApi.COMPUTED_CARD_KINDS).toContain('rsi');
    });

    it('exports the new-signal and extreme-zone-entry rules from package entrypoint', () => {
        // siglens' alert mail reads both instead of re-implementing the rules (API-1: also on index.client).
        expect(typeof coreApi.detectNewConfirmedSignals).toBe('function');
        expect(typeof coreApi.findExtremeZoneEntryOn).toBe('function');
        expect(typeof coreApi.confirmedSignalTimeline).toBe('function');
        expect(coreApi.SIGNAL_SCAN_DAILY_LOOKBACK_DAYS).toBe(400);
    });

    it('exports the MA-cross detector constants (golden/death 50/200, short-term 20/50)', () => {
        expect(coreApi.GOLDEN_CROSS_FAST_PERIOD).toBe(50);
        expect(coreApi.GOLDEN_CROSS_SLOW_PERIOD).toBe(200);
        expect(coreApi.SHORT_MA_CROSS_FAST_PERIOD).toBe(20);
        expect(coreApi.SHORT_MA_CROSS_SLOW_PERIOD).toBe(50);
        expect(coreApi.CROSS_LOOKBACK_BARS).toBe(3);
    });

    it('exports the indicator-confluence rule from package entrypoint', () => {
        // Consumers (trader, backtests) must drive the same rule from one place —
        // a second implementation is how the two silently drift apart.
        expect(typeof evaluateConfluence).toBe('function');
        expect(typeof scoreConfluence).toBe('function');
        expect(typeof isConfluenceExit).toBe('function');
        expect(CONFLUENCE_MIN).toBe(2.5);
        expect(CONFLUENCE_SPAN).toBe(15);
        expect(CONFLUENCE_TRIGGER_SCORE).toBe(92);
        expect([...VOLUME_FAMILIES].sort()).toEqual(['cmf', 'mfi']);
        expect(signalFamily('bollinger_lower_bounce')).toBe('bollinger');
        expect(
            confluenceFamilyWeight(['rsi_oversold', 'rsi_bullish_divergence'])
        ).toBe(1);
        expect(scoreConfluence(null)).toBe(50);

        const params: ConfluenceParams = {
            min: 3,
            exitMin: 2.5,
            span: 15,
            expectedWeight: 0.5,
            htf: null,
            requireVolume: true,
        };
        // `htfMode` is optional on stored params (older snapshots lack it) but a consumer
        // must be able to name the type to read it back from config.
        const mode: ConfluenceHtfMode = CONFLUENCE_HTF_MODE;
        expect(mode).toBe('uptrend');
        const opts: EvaluateConfluenceOptions = {
            timeframe: '30Min',
            htfMode: 'notUptrend',
        };
        const snap: ConfluenceSnapshot | null = evaluateConfluence([], opts);
        expect(params.min).toBe(3);
        expect(snap).toBeNull();
    });

    it('exports the company-earnings helpers (server-only, API-1 asymmetry)', () => {
        expect(typeof isCompanyEarningsEvent).toBe('function');
        expect(
            isCompanyEarningsEvent(new Date('2026-10-15'), ['2026-11-18'])
        ).toBe(false);
        expect(typeof pullbackEventCaveat).toBe('function');
        expect(
            pullbackEventCaveat({ events: [], earningsDates: [], bars: [] })
        ).toBeNull();
    });

    it('exports findMaCrosses (server-only) with window coverage', () => {
        expect(typeof findMaCrosses).toBe('function');
        expect(findMaCrosses([])).toEqual({
            crosses: [],
            evaluatedBars: 0,
            complete: false,
        });
    });

    it('exports rsiZone so consumers share one RSI zone boundary', () => {
        expect(typeof rsiZone).toBe('function');
        expect(rsiZone(70)).toBe('overbought');
        expect(rsiZone(37.5)).toBe('neutral');
        expect(rsiZone(30)).toBe('oversold');
    });

    it('exports classifyOscillatorZones so consumers share the oscillator zones', () => {
        expect(typeof classifyOscillatorZones).toBe('function');
        const view = classifyOscillatorZones({
            rsi: 30,
            stochasticK: 20,
            williamsR: null,
            cci: null,
            mfi: null,
        });
        expect(view.zones.rsi).toBe(rsiZone(30));
        expect(view.zones.stochastic).toBe('oversold');
        expect(view.zones.williamsR).toBeNull();
    });

    it('exports calculateMA so consumers stop re-implementing it', () => {
        const bars = Array.from({ length: 5 }, (_, i) => ({
            time: 1700000000 + i * 86400,
            open: 10,
            high: 10,
            low: 10,
            close: 10,
            volume: 1,
        }));
        expect(calculateMA(bars, 3).at(-1)).toBe(10);
    });

    it('exports advanced domain helpers from package entrypoint', () => {
        const trend: PatternTrend = 'neutral';

        expect(typeof clusterKeyLevels).toBe('function');
        expect(validateActionPrices(undefined)).toBeUndefined();
        expect(extractReconciledActionLines(undefined)).toBeUndefined();
        expect(trend).toBe('neutral');
    });

    it('exports the get_macro_quotes instrument list and per-call cap siglens maps to provider symbols', () => {
        expect(AGENT_MACRO_INSTRUMENTS).toContain('wti');
        expect(AGENT_MACRO_INSTRUMENTS).toContain('usd_krw');
        expect(AGENT_MACRO_INSTRUMENTS).toContain('jpy_krw');
        expect(AGENT_MACRO_QUOTES_MAX).toBe(8);
    });

    it('exports the get_x_posts contract numbers the siglens executor implements', () => {
        expect(AGENT_X_POSTS_MAX).toBe(12);
        expect(AGENT_X_POSTS_WINDOW_DAYS).toBe(14);
        expect(AGENT_X_POSTS_PAGE_SIZE).toBe(10);
        expect(AGENT_X_POST_TEXT_MAX_CHARS).toBe(600);
    });

    it('exports the get_company_filings contract numbers the siglens executor implements', () => {
        expect(AGENT_FILINGS_LIST_MAX).toBe(10);
        expect(AGENT_FILINGS_WINDOW_DAYS).toBe(120);
        expect(AGENT_FILING_TEXT_MAX_CHARS).toBe(12_000);
    });

    it('exports the weekly/monthly bar helpers siglens uses for get_bars_indicators 1Week/1Month', () => {
        expect(AGENT_BARS_TIMEFRAMES).toContain('1Week');
        expect(AGENT_BARS_TIMEFRAMES).toContain('1Month');
        const day = Math.floor(Date.UTC(2024, 0, 15) / 1000);
        const bar = {
            time: day,
            open: 1,
            high: 2,
            low: 1,
            close: 2,
            volume: 10,
        };
        expect(aggregateBarsToMonthly([bar])[0]?.time).toBe(
            Math.floor(Date.UTC(2024, 0, 1) / 1000)
        );
        expect(barPeriodStartSeconds('week', day)).toBe(day);
        expect(hasUsablePrices(bar)).toBe(true);
        expect(hasUsablePrices({ ...bar, close: 0 })).toBe(false);
    });

    it('exports aggregateBarsToWeekly so siglens can build the agent tool higherTimeframe rollup', () => {
        expect(typeof aggregateBarsToWeekly).toBe('function');
        const monday = Math.floor(Date.UTC(2024, 0, 1) / 1000);
        const bars = [
            {
                time: monday,
                open: 1,
                high: 2,
                low: 1,
                close: 2,
                volume: 10,
            },
        ];
        expect(aggregateBarsToWeekly(bars)).toEqual([
            { time: monday, open: 1, high: 2, low: 1, close: 2, volume: 10 },
        ]);
    });

    it('exports buildPlanCheck so siglens can compute sinceAnalysis.planNow against a live price', () => {
        expect(typeof buildPlanCheck).toBe('function');
        const check = buildPlanCheck(
            {
                positionAnalysis: '',
                entry: '',
                exit: '',
                riskReward: '',
                entryPrices: [100],
                stopLoss: 97,
                takeProfitPrices: [105],
            },
            103, // live/current price
            100 // plan's own entry price
        );
        expect(check).not.toBeNull();
        expect(check?.currentPrice).toBe(103);
        expect(check?.belowStopLoss).toBe(false);
    });

    it('exports planEntryPrice — the same entry reference buildPlanCheck uses internally', () => {
        expect(
            planEntryPrice(
                {
                    positionAnalysis: '',
                    entry: '',
                    exit: '',
                    riskReward: '',
                    entryPrices: [100, 110],
                },
                undefined
            )
        ).toBe(105);
        // No usable entryPrices -> falls back.
        expect(
            planEntryPrice(
                {
                    positionAnalysis: '',
                    entry: '',
                    exit: '',
                    riskReward: '',
                    entryPrices: [],
                },
                99
            )
        ).toBe(99);
    });

    it('exports consumer-implemented port/config types from package entrypoint', () => {
        const range: NewsTimeRange = '7d';
        const sectorGroup: SectorGroupDef = {
            label: 'Technology',
            symbols: ['AAPL', 'MSFT'],
        };

        expect(range).toBe('7d');
        expect(sectorGroup.symbols).toContain('AAPL');
    });

    it('exports tier gating helpers from package entrypoint', () => {
        expect(DEFAULT_TIER).toBe('free');
        expect(TIER_CONFIG.featureFlags.enableTierRestrictions).toBe(false);
        expect(TIER_CONFIG.featureFlags.enableTimeframeRestrictions).toBe(true);
        expect(TIER_CONFIG.featureFlags.enableInfoDepthRestrictions).toBe(true);
        expect(isAllowed('free', 'analysisPerDay')).toBe(true);
        expect(getAllowedTimeframes('free')).toEqual(['1Day']);
        expect(getTierLimit('free', 'analysisPerDay')).toBe(Infinity);
        expect(isTimeframeAllowed('free', '5Min')).toBe(false);
        expect(isInfoDepthAllowed('free', 'full_detail')).toBe(false);
        expect(isModelAllowed('free', 'claude-opus-5')).toBe(true);
        expect(getAllowedModels('free')).toContain('claude-opus-5');
        expect(isTier('member')).toBe(true);
        expect(getMeteredRevealPolicy('free')?.dailySymbols).toBe(1);
        expect(buildRevealedTierConfig('free').infoDepth.free).toEqual(
            TIER_CONFIG.infoDepth.member
        );
        expect(typeof checkAnalysisLimit).toBe('function');
        expect(typeof checkChatbotLimit).toBe('function');
    });

    it('exports the usage IP hash helper from package entrypoint', () => {
        expect(typeof hashUsageIp).toBe('function');
    });

    it('exports usage repository interface from package entrypoint', () => {
        const usageRepository: UsageRepository = {
            recordUsage: async input => ({
                id: 'usage-1',
                userId: input.userId ?? null,
                ipHash: hashUsageIp(
                    input.ipAddress,
                    new Date('2026-04-28T00:00:00.000Z')
                ),
                actionType: input.actionType,
                modelUsed: input.modelUsed,
                date: '2026-04-28',
                createdAt: new Date('2026-04-28T00:00:00.000Z'),
            }),
            getUsageToday: async () => ({ analysis: 0, chatbot: 0 }),
        };

        expect(usageRepository).toHaveProperty('recordUsage');
    });

    it('exports chat application and infrastructure entrypoints', () => {
        expect(typeof requestChatCompletion).toBe('function');
        expect(typeof createChatTokenStore).toBe('function');
        expect(GEMINI_FLASH_LITE_MODEL).toBe('gemini-3.5-flash-lite');
        expect(DEEPSEEK_V4_1_FLASH_MODEL).toBe('deepseek-v4.1-flash');
        expect(DEEPSEEK_V4_1_PRO_MODEL).toBe('deepseek-v4.1-pro');
        expect(VALID_CHAT_MODELS).toContain('gemini-3.5-flash-lite');
        expect(VALID_CHAT_MODELS).toContain('deepseek-v4.1-flash');
    });

    it('exports the DeepSeek model type guard from package entrypoint', () => {
        expect(isDeepSeekModel('deepseek-v4.1-flash')).toBe(true);
        expect(isDeepSeekModel('gemini-3.6-flash')).toBe(false);
    });

    it('exports financials domain and application entrypoints', () => {
        expect(typeof runFinancialsAnalysis).toBe('function');
        expect(typeof computeFinancialsScorecard).toBe('function');
        expect(typeof normalizeFinancialsAnalysisResponse).toBe('function');
        expect(typeof normalizeFinancialsSnapshot).toBe('function');

        // Compile-time check: FinancialSignalType must be exported.
        const signalType: FinancialSignalType = 'net_cash';
        void signalType;
    });

    it('exports the investor flows (수급) entrypoints, scorecard types and the provider port', () => {
        expect(typeof coreApi.runInvestorFlowsAnalysis).toBe('function');
        expect(typeof coreApi.evaluateInvestorFlows).toBe('function');
        expect(typeof coreApi.normalizeInvestorFlowsAnalysisResponse).toBe(
            'function'
        );
        expect(coreApi.INVESTOR_FLOWS_AXES).toEqual([
            'institutional',
            'insider',
            'largeHolders',
            'short',
            'dilution',
        ]);
        expect(typeof coreApi.evaluateSqueezeRisk).toBe('function');
        expect(
            coreApi.evaluateSqueezeRisk(
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

        // Compile-time: siglens implements the port and injects the scorecard.
        const snapshot = {} as InvestorFlowsSnapshot;
        const provider: InvestorFlowsDataProvider = {
            getInvestorFlowsSnapshot: async () => snapshot,
        };
        const scorecard = {} as InvestorFlowsScorecard;
        const result = {
            status: 'no_data',
        } satisfies RunInvestorFlowsAnalysisResult;
        void provider;
        void scorecard;
        void result;
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

    it('keeps investor-flows prompt, schema and cache-key internals private (API-2)', () => {
        expect('buildInvestorFlowsAnalysisPrompt' in coreApi).toBe(false);
        expect('investorFlowsSystemPrompt' in coreApi).toBe(false);
        expect('INVESTOR_FLOWS_RESPONSE_SCHEMA' in coreApi).toBe(false);
        expect('buildInvestorFlowsCacheKey' in coreApi).toBe(false);
        expect('INVESTOR_FLOWS_PROMPT_TEMPLATE_VERSION' in coreApi).toBe(false);
    });

    it('does not export prompt builders reclassified as @internal', () => {
        // Return type changed to AssembledPrompt; no external consumer calls
        // these directly (only submit* use-cases do, via deep imports), so
        // they were removed from the Tier 2 public barrel.
        expect('buildFinancialsAnalysisPrompt' in coreApi).toBe(false);
        expect('buildCongressTrendPrompt' in coreApi).toBe(false);
        expect('buildEconomicEventAnalysisPrompt' in coreApi).toBe(false);
        expect('buildIndicatorTranslationPrompt' in coreApi).toBe(false);
        expect('buildOptionsAnalysisPrompt' in coreApi).toBe(false);
    });
});

describe('package entrypoint export presence (API-1)', () => {
    const exportsByName = coreApi as Record<string, unknown>;

    const FUNCTION_EXPORTS: readonly string[] = [
        'canonicalJson',
        'callAnalysisAi',
        'callBriefingAi',
        'resolveBriefingModel',
        'isModelAllowedForTier',
        'requiresUserApiKey',
        'shouldUseServerKey',
        'UserApiKeyMissingError',
        'fetchBarsWithIndicators',
        'peekAnalysisCache',
        'peekBriefingCache',
        'runAnalysis',
        'runBriefing',
        'runNewsAnalysis',
        'runNewsCardAnalysis',
        'runMarketNewsDigest',
        'peekMarketNewsDigestCache',
        'runOverallAnalysis',
        'runCongressTrend',
        'runMacroBriefing',
        'runEconomicEventAnalysis',
        'runIndicatorTranslation',
        'getMarketSummary',
        'getSectorSignals',
        'peekMacroBriefingCache',
        'peekMacroBriefingCacheEntry',
        'runFundamentalAnalysis',
        'peekOverallAnalysisCache',
        'runAgentTurn',
        'calculateIchimokuFutureCloud',
        'calculateIndicators',
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
        'isExpectedSignal',
        'classifyPullback',
        'evaluatePullback',
        'buildChatPrompt',
        'isValidAnalysisLocale',
        'normalizeCongressTrades',
        'summarizeCongressTrades',
        'normalizeCongressTrendResponse',
        'normalizeEconomicIndicatorSeries',
        'normalizeTreasuryRates',
        'computeYieldSpread',
        'normalizeEconomicCalendar',
        'isRateDecisionEvent',
        'selectCalendarEvents',
        'normalizeEconomicEventAnalysis',
        'normalizeIndicatorTranslation',
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
        'getMultiPatternTrend',
        'getSinglePatternTrend',
        'buildPlanState',
        'filterAnalysisResult',
        'validateKeyLevels',
        'computeMarketReference',
        'krxTickSize',
        'roundToKrxTick',
        'bucketizePosition',
        'getProviderForModel',
        'getModelAccess',
        'isFreeModel',
        'isPremiumModel',
        'requiresAuth',
        'requiresByokKey',
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
        'agentLimit',
        'classifyProviderError',
        'findToolSpec',
        'selectTools',
        'selectToolSetSpecs',
        'formatAttachedImagesMarker',
        'validateArgs',
        'findAgentTheme',
        'summarizeTheme',
        'computeIndexHistoryStats',
        'computeSwingHistory',
        'closeOnOrBefore',
        'calendarPeriodChange',
        'isIsoDate',
        'minusCalendarMonths',
        'computeBarChangeStats',
        'computeBarRangeStats',
        'computeCloseStreak',
        'computeEarningsReactions',
        'scanLongTermMaCrosses',
        'computePriceStats',
        'priceStatsEarliestDate',
        'tallyEarningsReactions',
        'readPutCallRatio',
        'buildLevelLadder',
        'alignNewsWithPriceMoves',
        'findUngroundedNumbers',
        'splitAgentFollowUps',
        'buildAgentSystemPrompt',
        'buildAgentTurnContext',
        'composeAgentUserMessage',
        'selectHistoryWindow',
        'estimateTokens',
        'buildSuggestionsPrompt',
        'parseSuggestions',
        'computeBarsEffectiveTtl',
        'analysisHistoryQuery',
        'createCacheProvider',
        'hashClientIp',
        'readFmpConfig',
        'tryReadFmpConfig',
        'getReanalyzeCooldownMs',
        'releaseReanalyzeCooldown',
        'tryAcquireReanalyzeCooldown',
        'createCounterStore',
        'CounterStoreUnavailableError',
        'isClaudeAdaptiveModelSpec',
        'isClaudeBudgetModelSpec',
        'isClaudeModelSpec',
        'isTemperatureModelSpec',
        'resolveReasoningConfig',
        'summarizeChainForLlm',
        'aggregateOpenInterest',
        'sanitizeOptionsChain',
        'mapExpirationsToSlots',
        'runOptionsAnalysis',
        'buildOutcomeWindow',
        'computeForwardReturns',
        'extractOutcomeSubject',
        'labelAnalysisOutcome',
        'labelLevelOutcome',
        'outcomeEarliestLabelTime',
        'summarizeOutcomeRecord',
    ];
    const VALUE_EXPORTS: readonly string[] = [
        'DEFAULT_KEY_POLICY',
        'CRYPTO_FEAR_GREED_FACTOR_KEYS',
        'EXTREME_FEAR_GREED_ZONES',
        'EXTREME_ZONE_FORWARD_HORIZONS',
        'EXTREME_ZONE_MIN_SAMPLE',
        'EXTREME_ZONE_REENTRY_GAP',
        'MARKET_FEAR_GREED_FACTOR_KEYS',
        'MARKET_FEAR_GREED_SERIES_KEYS',
        'FEAR_GREED_LOOKBACK_DAYS',
        'CONFLUENCE_EXIT_MIN',
        'CONFLUENCE_EXIT_SCORE',
        'CONFLUENCE_EXPECTED_WEIGHT',
        'CONFLUENCE_MIN_BARS',
        'CONFLUENCE_SHRINK',
        'CONFLUENCE_TREND_MA_PERIOD',
        'PULLBACK_BASE_RATES',
        'PULLBACK_EXIT_MA_PERIOD',
        'PULLBACK_NEAR_WILLIAMS_R',
        'PULLBACK_RSI_PERIOD',
        'PULLBACK_TREND_MA_PERIOD',
        'PULLBACK_WASHOUT_WILLIAMS_R',
        'PULLBACK_WILLIAMS_R_PERIOD',
        'AI_SYSTEM_PROMPT',
        'ANALYSIS_LOCALES',
        'DEFAULT_ANALYSIS_LOCALE',
        'OVERLAY_LEVEL_LABELS',
        'US_EQUITY_SESSION',
        'CRYPTO_SESSION',
        'EARLY_CLOSE_MINUTE',
        'REGULAR_CLOSE_MINUTE',
        'AGENT_LIMITS',
        'AGENT_GLOBAL_LIMITS',
        'AGENT_TURN_CAPS',
        'TOOL_TIMEOUT_MS',
        'AGENT_TOOL_SPECS',
        'AGENT_TOOL_NAMES',
        'FRESH_ANALYSIS_KINDS',
        'AGENT_CHART_KINDS',
        'AGENT_CHART_PERIODS',
        'AGENT_COMPARE_SYMBOLS_MIN',
        'AGENT_COMPARE_SYMBOLS_MAX',
        'BUILT_IN_AGENT_TOOL_SET',
        'AGENT_IMAGES_PER_MESSAGE_MAX',
        'AGENT_THEMES',
        'AGENT_THEME_IDS',
        'THEME_CHANGE_WINDOWS',
        'AGENT_HISTORY_INDICES',
        'SWING_EPISODES_LISTED_MAX',
        'SWING_LOOKBACK_YEARS',
        'SWING_MIN_PCT',
        'LONG_TERM_MA_CROSS',
        'AGENT_PRICE_STATS_DEFAULT_PERIOD',
        'AGENT_PRICE_STATS_MAX_DATES',
        'AGENT_PRICE_STATS_MAX_SUBJECTS',
        'AGENT_PRICE_STATS_PERIODS',
        'PRICE_STATS_NOTE_TEMPLATES',
        'BARS_RESULT_NOTES',
        'FUNDAMENTALS_RESULT_NOTES',
        'AGENT_FOLLOW_UP_MARKER',
        'AGENT_PROMPT_VERSION',
        'SUGGESTIONS_PROMPT_VERSION',
        'SUGGESTION_COUNT',
        'SUGGESTION_MAX_CHARS',
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
        'MA_DEFAULT_PERIODS',
        'MACD_FAST_PERIOD',
        'MACD_SIGNAL_PERIOD',
        'MACD_SLOW_PERIOD',
        'RSI_OVERBOUGHT_LEVEL',
        'RSI_OVERSOLD_LEVEL',
        'STOCH_RSI_D_PERIOD',
        'STOCH_RSI_K_PERIOD',
        'STOCH_RSI_OVERBOUGHT_LEVEL',
        'STOCH_RSI_OVERSOLD_LEVEL',
        'STOCH_RSI_RSI_PERIOD',
        'STOCH_RSI_STOCH_PERIOD',
        'STOCHASTIC_D_PERIOD',
        'STOCHASTIC_K_PERIOD',
        'STOCHASTIC_OVERBOUGHT_LEVEL',
        'STOCHASTIC_OVERSOLD_LEVEL',
        'STOCHASTIC_SMOOTHING',
        'OUTCOME_LABEL_VERSION',
        'OUTCOME_SUBJECT_VERSION',
    ];

    it.each(FUNCTION_EXPORTS)('exports %s as a function', name => {
        expect(typeof exportsByName[name]).toBe('function');
    });

    it.each(VALUE_EXPORTS)('exports %s as a defined value', name => {
        expect(exportsByName[name]).toBeDefined();
    });
});
