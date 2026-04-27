import { describe, expect, it } from 'vitest';
import {
    asArray,
    assetTranslations,
    CANDLE_PATTERN_DETECTION_BARS,
    CCI_BULLISH_CROSS_LEVEL,
    clusterKeyLevels,
    createDatabaseClient,
    CROSS_LOOKBACK_BARS,
    detectBollingerSqueezeBearish,
    detectGoldenCross,
    EMA_DEFAULT_PERIODS,
    EMPTY_INDICATOR_RESULT,
    EMPTY_SMC_RESULT,
    EXCLUDED_SINGLE_PATTERNS,
    extractReconciledActionLines,
    extendTrendline,
    getDatabaseClient,
    HIGH_CONFIDENCE_WEIGHT,
    koreanTickers,
    normalizeActionRecommendation,
    normalizeTrend,
    oauthAccounts,
    OAUTH_PROVIDER_VALUES,
    oauthProviderEnum,
    postProcessAnalysisWithReconcile,
    readDatabaseConfig,
    RSI_DEFAULT_PERIOD,
    sessions,
    tryGetDatabaseClient,
    tryReadDatabaseConfig,
    USAGE_ACTION_TYPE_VALUES,
    usageActionTypeEnum,
    usageLogs,
    users,
    USER_TIER_VALUES,
    userTierEnum,
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

    it('exports database client factory functions', () => {
        expect(typeof createDatabaseClient).toBe('function');
        expect(typeof getDatabaseClient).toBe('function');
        expect(typeof tryGetDatabaseClient).toBe('function');
        expect(typeof readDatabaseConfig).toBe('function');
        expect(typeof tryReadDatabaseConfig).toBe('function');
    });

    it('exports drizzle schema table objects', () => {
        expect(users.email.name).toBe('email');
        expect(sessions.userId.name).toBe('user_id');
        expect(usageLogs.actionType.name).toBe('action_type');
        expect(oauthAccounts.provider.name).toBe('provider');
        expect(koreanTickers.symbol.name).toBe('symbol');
        expect(assetTranslations.symbol.name).toBe('symbol');
    });

    it('exports enum objects matching constant values', () => {
        expect(userTierEnum.enumValues).toEqual([...USER_TIER_VALUES]);
        expect(USER_TIER_VALUES).toEqual(['free', 'member', 'pro']);
        expect(usageActionTypeEnum.enumValues).toEqual([
            ...USAGE_ACTION_TYPE_VALUES,
        ]);
        expect(USAGE_ACTION_TYPE_VALUES).toEqual(['analysis', 'chatbot']);
        expect(oauthProviderEnum.enumValues).toEqual([
            ...OAUTH_PROVIDER_VALUES,
        ]);
        expect(OAUTH_PROVIDER_VALUES).toEqual(['google', 'kakao', 'apple']);
    });
});
