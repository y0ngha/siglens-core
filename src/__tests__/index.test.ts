import { describe, expect, it } from 'vitest';
import {
    asArray,
    CANDLE_PATTERN_DETECTION_BARS,
    CCI_BULLISH_CROSS_LEVEL,
    clusterKeyLevels,
    CROSS_LOOKBACK_BARS,
    detectBollingerSqueezeBearish,
    detectGoldenCross,
    EMA_DEFAULT_PERIODS,
    EMPTY_INDICATOR_RESULT,
    EMPTY_SMC_RESULT,
    EXCLUDED_SINGLE_PATTERNS,
    extractReconciledActionLines,
    extendTrendline,
    HIGH_CONFIDENCE_WEIGHT,
    requestChatCompletion,
    createChatTokenStore,
    GEMINI_2_5_FLASH_MODEL,
    VALID_CHAT_MODELS,
    normalizeActionRecommendation,
    normalizeTrend,
    postProcessAnalysisWithReconcile,
    RSI_DEFAULT_PERIOD,
    validateActionPrices,
} from '@/index';
import type { PatternTrend } from '@/index';

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

    it('exports chat application and infrastructure entrypoints', () => {
        expect(typeof requestChatCompletion).toBe('function');
        expect(typeof createChatTokenStore).toBe('function');
        expect(GEMINI_2_5_FLASH_MODEL).toBe('gemini-2.5-flash');
        expect(VALID_CHAT_MODELS).toContain('gemini-2.5-flash-lite');
    });
});
