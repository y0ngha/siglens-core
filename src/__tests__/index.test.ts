import { TIMEFRAMES } from '@/domain/constants/market';
import type { PatternTrend, UsageRepository } from '@/index';
import {
    checkAnalysisLimit,
    checkChatbotLimit,
    clusterKeyLevels,
    createChatTokenStore,
    DEFAULT_TIER,
    EMA_DEFAULT_PERIODS,
    EMPTY_INDICATOR_RESULT,
    EMPTY_SMC_RESULT,
    extractReconciledActionLines,
    FEAR_GREED_LABEL_CUTOFFS,
    GEMINI_2_5_FLASH_MODEL,
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
    POC_WINDOW_DEFAULT,
    requestChatCompletion,
    RSI_DEFAULT_PERIOD,
    scoreToLabel,
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
        expect(FEAR_GREED_LABEL_CUTOFFS.NEUTRAL_MAX).toBe(55);
        expect(POC_WINDOW_DEFAULT).toBe(60);
        expect(scoreToLabel(10)).toBe('EXTREME_FEAR');
    });

    it('exports advanced domain helpers from package entrypoint', () => {
        const trend: PatternTrend = 'neutral';

        expect(typeof clusterKeyLevels).toBe('function');
        expect(validateActionPrices(undefined)).toBeUndefined();
        expect(extractReconciledActionLines(undefined)).toBeUndefined();
        expect(trend).toBe('neutral');
    });

    it('exports tier gating helpers from package entrypoint', () => {
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
        expect(VALID_CHAT_MODELS).toContain('gemini-2.5-flash-lite');
    });
});
