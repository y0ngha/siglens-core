import { TIMEFRAMES } from '@/domain/constants/market';
import type {
    ChatbotLimitError,
    PatternTrend,
    TierGateErrorResult,
    UsageLimitError,
    UsageRepository,
} from '@/index';
import {
    asArray,
    CANDLE_PATTERN_DETECTION_BARS,
    CCI_BULLISH_CROSS_LEVEL,
    checkAnalysisLimit,
    checkChatbotLimit,
    clusterKeyLevels,
    createChatTokenStore,
    CROSS_LOOKBACK_BARS,
    DEFAULT_TIER,
    detectBollingerSqueezeBearish,
    detectGoldenCross,
    EMA_DEFAULT_PERIODS,
    EMPTY_INDICATOR_RESULT,
    EMPTY_SMC_RESULT,
    EXCLUDED_SINGLE_PATTERNS,
    extendTrendline,
    extractReconciledActionLines,
    filterAnalysisResult,
    GEMINI_2_5_FLASH_MODEL,
    GEMINI_2_5_PRO_MODEL,
    getAllowedModels,
    getAllowedTimeframes,
    getTierLimit,
    hashUsageIp,
    HIGH_CONFIDENCE_WEIGHT,
    isAllowed,
    isInfoDepthAllowed,
    isModelAllowed,
    isTier,
    isTimeframeAllowed,
    normalizeActionRecommendation,
    normalizeTrend,
    postProcessAnalysisWithReconcile,
    requestChatCompletion,
    RSI_DEFAULT_PERIOD,
    TIER_CONFIG,
    VALID_CHAT_MODELS,
    validateActionPrices,
} from '@/index';
import { describe, expect, it } from 'vitest';

describe('public API exports', () => {
    it('exports indicator constants from package entrypoint', () => {
        expect(RSI_DEFAULT_PERIOD).toBe(14);
        expect(EMA_DEFAULT_PERIODS).toEqual([9, 20, 21, 60]);
        expect(EMPTY_INDICATOR_RESULT.smc).toBe(EMPTY_SMC_RESULT);
        expect(HIGH_CONFIDENCE_WEIGHT).toBe(0.8);
    });

    it('exports advanced domain helpers from package entrypoint', () => {
        const trend: PatternTrend = 'neutral';

        expect(CROSS_LOOKBACK_BARS).toBe(3);
        expect(CCI_BULLISH_CROSS_LEVEL).toBe(100);
        expect(typeof detectGoldenCross).toBe('function');
        expect(typeof detectBollingerSqueezeBearish).toBe('function');
        expect(CANDLE_PATTERN_DETECTION_BARS).toBe(15);
        expect(EXCLUDED_SINGLE_PATTERNS.has('flat')).toBe(true);
        expect(normalizeTrend('bullish')).toBe('bullish');
        expect(normalizeActionRecommendation({})).toBeUndefined();
        expect(asArray(null)).toEqual([]);
        expect(typeof extendTrendline).toBe('function');
        expect(typeof postProcessAnalysisWithReconcile).toBe('function');
        expect(typeof clusterKeyLevels).toBe('function');
        expect(validateActionPrices(undefined)).toBeUndefined();
        expect(extractReconciledActionLines(undefined)).toBeUndefined();
        expect(trend).toBe('neutral');
    });

    it('exports tier gating helpers from package entrypoint', () => {
        const usageLimitError: UsageLimitError = {
            code: 'analysis_limit_exceeded',
            message: 'Daily analysis usage limit exceeded.',
            feature: 'analysisPerDay',
            tier: 'free',
        };
        const chatUsageLimitError: ChatbotLimitError = {
            code: 'chatbot_limit_exceeded',
            message: 'Daily chatbot usage limit exceeded.',
            feature: 'chatbotPerDay',
            tier: 'free',
        };
        const gateError: TierGateErrorResult = {
            status: 'error',
            error: {
                code: 'timeframe_not_allowed',
                message: 'Timeframe 5Min is not available for free tier.',
                tier: 'free',
                timeframe: '5Min',
                allowedTimeframes: getAllowedTimeframes('free'),
            },
        };

        expect(DEFAULT_TIER).toBe('free');
        expect(TIER_CONFIG.featureFlags.enableTierRestrictions).toBe(false);
        expect(isAllowed('free', 'analysisPerDay')).toBe(true);
        expect(getAllowedTimeframes('free')).toEqual([...TIMEFRAMES]);
        expect(getTierLimit('free', 'analysisPerDay')).toBe(Infinity);
        expect(isTimeframeAllowed('free', '5Min')).toBe(true);
        expect(isInfoDepthAllowed('free', 'full_detail')).toBe(true);
        expect(isModelAllowed('free', 'claude-opus-4-7')).toBe(true);
        expect(getAllowedModels('free')).toContain('claude-opus-4-7');
        expect(isTier('member')).toBe(true);
        expect(typeof checkAnalysisLimit).toBe('function');
        expect(typeof checkChatbotLimit).toBe('function');
        expect(usageLimitError.code).toBe('analysis_limit_exceeded');
        expect(chatUsageLimitError.feature).toBe('chatbotPerDay');
        expect(gateError.status).toBe('error');
        expect(typeof filterAnalysisResult).toBe('function');
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
        expect(GEMINI_2_5_FLASH_MODEL).toBe('gemini-2.5-flash');
        expect(GEMINI_2_5_PRO_MODEL).toBe('gemini-2.5-pro');
        expect(VALID_CHAT_MODELS).toContain('gemini-2.5-flash-lite');
    });
});
