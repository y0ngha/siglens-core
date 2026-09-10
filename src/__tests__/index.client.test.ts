import { describe, expect, it } from 'vitest';
import {
    AI_SYSTEM_PROMPT,
    computeFinancialsScorecard,
    DEEPSEEK_V4_1_FLASH_MODEL,
    DEEPSEEK_V4_1_PRO_MODEL,
    DEFAULT_TIER,
    EMA_DEFAULT_PERIODS,
    GEMINI_FLASH_LITE_MODEL,
    getAllowedModels,
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

    it('does not export server-only runtime entrypoints', () => {
        expect('FileSkillsLoader' in clientApi).toBe(false);
        expect('createSkillsProvider' in clientApi).toBe(false);
        expect('submitAnalysis' in clientApi).toBe(false);
        expect('requestChatCompletion' in clientApi).toBe(false);
        expect('createCacheProvider' in clientApi).toBe(false);
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
