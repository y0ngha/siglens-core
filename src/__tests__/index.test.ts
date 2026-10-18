import type {
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
    aggregateBarsToWeekly,
    buildPlanCheck,
    calculateMA,
    rsiZone,
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

    it('exports rsiZone so consumers share one RSI zone boundary', () => {
        expect(typeof rsiZone).toBe('function');
        expect(rsiZone(70)).toBe('overbought');
        expect(rsiZone(37.5)).toBe('neutral');
        expect(rsiZone(30)).toBe('oversold');
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
