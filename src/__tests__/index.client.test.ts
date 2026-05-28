import { describe, expect, it } from 'vitest';
import {
    AI_SYSTEM_PROMPT,
    CANDLE_PATTERN_DETECTION_BARS,
    DEFAULT_TIER,
    detectGoldenCross,
    EMA_DEFAULT_PERIODS,
    filterAnalysisResult,
    GEMINI_2_5_FLASH_MODEL,
    GEMINI_2_5_PRO_MODEL,
    getAllowedModels,
    getAllowedTimeframes,
    getTierLimit,
    HIGH_CONFIDENCE_WEIGHT,
    isAllowed,
    isInfoDepthAllowed,
    isModelAllowed,
    isTier,
    isTimeframeAllowed,
    normalizeNewsAnalysisResponse,
    normalizeTrend,
    TIER_CONFIG,
    VALID_CHAT_MODELS,
} from '@/index.client';
import * as clientApi from '@/index.client';
import type {
    FundamentalSnapshot,
    ModelId,
    NewsAnalysisResponse,
    OverallAnalysisResponse,
    SkillType,
    TierConfig,
} from '@/index.client';

describe('browser public API exports', () => {
    it('exports domain values used by browser consumers', () => {
        const skillType: SkillType = 'indicator_guide';
        const modelId: ModelId = 'gemini-2.5-pro';
        const tierConfig: TierConfig = TIER_CONFIG;

        expect(CANDLE_PATTERN_DETECTION_BARS).toBe(15);
        expect(EMA_DEFAULT_PERIODS).toEqual([9, 20, 21, 60]);
        expect(GEMINI_2_5_FLASH_MODEL).toBe('gemini-2.5-flash');
        expect(GEMINI_2_5_PRO_MODEL).toBe('gemini-2.5-pro');
        expect(VALID_CHAT_MODELS).toContain('gemini-2.5-flash-lite');
        expect(DEFAULT_TIER).toBe('free');
        expect(getAllowedModels('free')).toContain('claude-opus-4-7');
        expect(getAllowedTimeframes('free')).toContain('1Day');
        expect(isModelAllowed('free', modelId, tierConfig)).toBe(true);
        expect(HIGH_CONFIDENCE_WEIGHT).toBe(0.8);
        expect(typeof filterAnalysisResult).toBe('function');
        expect(typeof DEFAULT_TIER).toBe('string');
        expect(typeof TIER_CONFIG).toBe('object');
        expect(typeof getTierLimit).toBe('function');
        expect(typeof isAllowed).toBe('function');
        expect(typeof isInfoDepthAllowed).toBe('function');
        expect(typeof isModelAllowed).toBe('function');
        expect(typeof isTier).toBe('function');
        expect(typeof isTimeframeAllowed).toBe('function');
        expect(typeof detectGoldenCross).toBe('function');
        expect(normalizeTrend('bullish')).toBe('bullish');
        expect(clientApi.FEAR_GREED_LABEL_CUTOFFS.NEUTRAL_MAX).toBe(55);
        expect(clientApi.POC_WINDOW_DEFAULT).toBe(60);
        expect(clientApi.scoreToLabel(10)).toBe('EXTREME_FEAR');
        expect(skillType).toBe('indicator_guide');
    });

    it('exports fundamental / news / overall domain symbols for browser consumers', () => {
        // Type-level imports — verify the new domain types are reachable from the
        // browser entry by assigning a representative literal to each.
        const snapshotKeys: Array<keyof FundamentalSnapshot> = ['profile'];
        expect(snapshotKeys).toContain('profile');

        // Runtime exports must be callable on the browser entry.
        expect(typeof normalizeNewsAnalysisResponse).toBe('function');
        expect(typeof AI_SYSTEM_PROMPT).toBe('string');
        expect(AI_SYSTEM_PROMPT.length).toBeGreaterThan(0);

        // Smoke-call normalize on a minimal payload to confirm it runs in the
        // browser bundle (no Node-only deps pulled in transitively).
        const news: NewsAnalysisResponse = normalizeNewsAnalysisResponse(
            JSON.stringify({
                currentDriverKo: 'driver',
                keyEventsKo: ['event'],
                upcomingEventsKo: ['upcoming'],
                overallSentiment: 'neutral',
            })
        );
        expect(news.overallSentiment).toBe('neutral');

        // Verify representative new exports exist on the namespace import.
        expect('buildFundamentalAnalysisPrompt' in clientApi).toBe(true);
        expect('buildNewsAnalysisPrompt' in clientApi).toBe(true);
        expect('buildOverallAnalysisPrompt' in clientApi).toBe(true);
        expect('normalizeFundamentalAnalysisResponse' in clientApi).toBe(true);
        expect('normalizeFundamentalSnapshot' in clientApi).toBe(true);
        expect('normalizeOverallAnalysisResponse' in clientApi).toBe(true);
        expect('normalizeNewsCardAnalysis' in clientApi).toBe(true);

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
});
