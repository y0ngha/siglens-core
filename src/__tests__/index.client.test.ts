import { describe, expect, it } from 'vitest';
import {
    CANDLE_PATTERN_DETECTION_BARS,
    DEFAULT_TIER,
    detectGoldenCross,
    EMA_DEFAULT_PERIODS,
    GEMINI_2_5_FLASH_MODEL,
    GEMINI_2_5_PRO_MODEL,
    getAllowedModels,
    HIGH_CONFIDENCE_WEIGHT,
    isModelAllowed,
    normalizeTrend,
    TIER_CONFIG,
    VALID_CHAT_MODELS,
} from '@/index.client';
import * as clientApi from '@/index.client';
import type { ModelId, SkillType, TierConfig } from '@/index.client';

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
        expect(getAllowedModels('free')).toContain('claude-opus-4');
        expect(isModelAllowed('free', modelId, tierConfig)).toBe(true);
        expect(HIGH_CONFIDENCE_WEIGHT).toBe(0.8);
        expect(typeof detectGoldenCross).toBe('function');
        expect(normalizeTrend('bullish')).toBe('bullish');
        expect(skillType).toBe('indicator_guide');
    });

    it('does not export server-only runtime entrypoints', () => {
        expect('FileSkillsLoader' in clientApi).toBe(false);
        expect('submitAnalysis' in clientApi).toBe(false);
        expect('requestChatCompletion' in clientApi).toBe(false);
        expect('createCacheProvider' in clientApi).toBe(false);
    });
});
