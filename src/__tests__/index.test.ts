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
    DrizzleSessionRepository,
    DrizzleUserRepository,
    EMA_DEFAULT_PERIODS,
    EMPTY_INDICATOR_RESULT,
    EMPTY_SMC_RESULT,
    EXCLUDED_SINGLE_PATTERNS,
    extractReconciledActionLines,
    extendTrendline,
    getDatabaseClient,
    HIGH_CONFIDENCE_WEIGHT,
    koreanTickers,
    loginUser,
    logoutUser,
    normalizeActionRecommendation,
    normalizeTrend,
    OAUTH_PROVIDER_VALUES,
    oauthAccounts,
    oauthProviderEnum,
    postProcessAnalysisWithReconcile,
    readDatabaseConfig,
    registerUser,
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
import type {
    EmailAuthUserRepository,
    PasswordHasher,
    PasswordVerifier,
    PatternTrend,
    SessionRepository,
    UserRepository,
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
        expect(typeof getDatabaseClient).toBe('function');
        expect(typeof tryGetDatabaseClient).toBe('function');
        expect(typeof readDatabaseConfig).toBe('function');
        expect(typeof tryReadDatabaseConfig).toBe('function');
        expect(typeof registerUser).toBe('function');
        expect(typeof loginUser).toBe('function');
        expect(typeof logoutUser).toBe('function');
        expect(typeof DrizzleUserRepository).toBe('function');
        expect(typeof DrizzleSessionRepository).toBe('function');
        expect(users.email.name).toBe('email');
        expect(sessions.userId.name).toBe('user_id');
        expect(usageLogs.userId.name).toBe('user_id');
        expect(oauthAccounts.userId.name).toBe('user_id');
        expect(typeof koreanTickers).toBe('object');
        expect(typeof assetTranslations).toBe('object');
        expect(userTierEnum.enumValues).toEqual(['free', 'member', 'pro']);
        expect(usageActionTypeEnum.enumValues).toEqual(['analysis', 'chatbot']);
        expect(oauthProviderEnum.enumValues).toEqual([
            'google',
            'kakao',
            'apple',
        ]);
        expect(USER_TIER_VALUES).toEqual(['free', 'member', 'pro']);
        expect(USAGE_ACTION_TYPE_VALUES).toEqual(['analysis', 'chatbot']);
        expect(OAUTH_PROVIDER_VALUES).toEqual(['google', 'kakao', 'apple']);
    });

    it('exports auth interfaces from package entrypoint', async () => {
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
        const emailAuthRepository: EmailAuthUserRepository = {
            findEmailAuthUserByEmail: async () => null,
        };
        const sessionRepository: SessionRepository = {
            createSession: async input => ({
                id: 'session-1',
                userId: input.userId,
                expiresAt: input.expiresAt,
                createdAt: new Date('2026-04-26T00:00:00.000Z'),
            }),
            deleteSession: async () => true,
        };
        const passwordVerifier: PasswordVerifier = {
            verifyPassword: async () => true,
        };

        expect(repository).toHaveProperty('findByEmail');
        expect(passwordHasher).toHaveProperty('hashPassword');
        expect(emailAuthRepository).toHaveProperty('findEmailAuthUserByEmail');
        expect(sessionRepository).toHaveProperty('createSession');
        expect(passwordVerifier).toHaveProperty('verifyPassword');

        const logoutResult = await logoutUser(
            { sessionToken: 'session-1' },
            { sessions: sessionRepository }
        );
        expect(logoutResult.ok).toBe(true);
        expect(logoutResult.sessionInvalidated).toBe(true);
        expect(logoutResult.cookie).toBeDefined();
    });
});
