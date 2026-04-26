import { describe, expect, it } from 'vitest';
import {
    asArray,
    CANDLE_PATTERN_DETECTION_BARS,
    CCI_BULLISH_CROSS_LEVEL,
    clusterKeyLevels,
    createDatabaseClient,
    CROSS_LOOKBACK_BARS,
    detectBollingerSqueezeBearish,
    detectGoldenCross,
    DrizzleUserRepository,
    EMA_DEFAULT_PERIODS,
    EMPTY_INDICATOR_RESULT,
    EMPTY_SMC_RESULT,
    EXCLUDED_SINGLE_PATTERNS,
    extractReconciledActionLines,
    extendTrendline,
    HIGH_CONFIDENCE_WEIGHT,
    normalizeActionRecommendation,
    normalizeTrend,
    OAUTH_PROVIDER_VALUES,
    postProcessAnalysisWithReconcile,
    readDatabaseConfig,
    registerUser,
    RSI_DEFAULT_PERIOD,
    USAGE_ACTION_TYPE_VALUES,
    users,
    USER_TIER_VALUES,
    userTierEnum,
    validateActionPrices,
} from '@/index';
import type {
    DatabaseConfig,
    PasswordHasher,
    PatternTrend,
    UserRepository,
    UserTier,
} from '@/index';

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

    it('exports database helpers from package entrypoint', () => {
        expect(typeof createDatabaseClient).toBe('function');
        expect(typeof readDatabaseConfig).toBe('function');
        expect(typeof registerUser).toBe('function');
        expect(typeof DrizzleUserRepository).toBe('function');
        expect(users.email.name).toBe('email');
        expect(userTierEnum.enumValues).toEqual(['free', 'member', 'pro']);
        expect(USER_TIER_VALUES).toEqual(['free', 'member', 'pro']);
        expect(USAGE_ACTION_TYPE_VALUES).toEqual(['analysis', 'chatbot']);
        expect(OAUTH_PROVIDER_VALUES).toEqual(['google', 'kakao', 'apple']);
    });

    it('exports auth interfaces from package entrypoint', () => {
        const repository: UserRepository = {
            findByEmail: async () => null,
            createEmailUser: async input => ({
                id: 'user-1',
                email: input.email,
                name: input.name ?? null,
                avatarUrl: input.avatarUrl ?? null,
                tier: 'free',
                createdAt: new Date('2026-04-26T00:00:00.000Z'),
                updatedAt: new Date('2026-04-26T00:00:00.000Z'),
            }),
        };
        const passwordHasher: PasswordHasher = {
            hashPassword: async password => `hashed:${password}`,
        };

        expect(repository).toHaveProperty('findByEmail');
        expect(passwordHasher).toHaveProperty('hashPassword');
    });
});
