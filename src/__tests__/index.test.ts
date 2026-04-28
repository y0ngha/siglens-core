import { describe, expect, it } from 'vitest';
import {
    asArray,
    assetTranslations,
    CANDLE_PATTERN_DETECTION_BARS,
    CCI_BULLISH_CROSS_LEVEL,
    clusterKeyLevels,
    createDatabaseClient,
    CROSS_LOOKBACK_BARS,
    DEFAULT_TIER,
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
    HIGH_CONFIDENCE_WEIGHT,
    getTierLimit,
    isAllowed,
    isInfoDepthAllowed,
    isModelAllowed,
    isTier,
    isTimeframeAllowed,
    koreanTickers,
    bcryptPasswordHasher,
    bcryptPasswordVerifier,
    deleteAccount,
    findUserBySessionToken,
    loginUser,
    logoutUser,
    requestChatCompletion,
    createChatTokenStore,
    GEMINI_2_5_FLASH_MODEL,
    VALID_CHAT_MODELS,
    normalizeActionRecommendation,
    normalizeTrend,
    OAUTH_PROVIDER_VALUES,
    oauthAccounts,
    oauthProviderEnum,
    postProcessAnalysisWithReconcile,
    registerUser,
    RSI_DEFAULT_PERIOD,
    sessions,
    socialLoginUser,
    TIER_CONFIG,
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
    OAuthUserRepository,
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

    it('exports tier gating helpers from package entrypoint', () => {
        expect(DEFAULT_TIER).toBe('free');
        expect(TIER_CONFIG.featureFlags.enableTierRestrictions).toBe(false);
        expect(isAllowed('free', 'analysisPerDay')).toBe(true);
        expect(getTierLimit('free', 'analysisPerDay')).toBe(Infinity);
        expect(isTimeframeAllowed('free', '5Min')).toBe(true);
        expect(isInfoDepthAllowed('free', 'full_detail')).toBe(true);
        expect(isModelAllowed('free', 'claude-opus-4')).toBe(true);
        expect(isTier('member')).toBe(true);
    });

    it('exports auth application entrypoints from package entrypoint', () => {
        expect(typeof registerUser).toBe('function');
        expect(typeof loginUser).toBe('function');
        expect(typeof socialLoginUser).toBe('function');
        expect(typeof logoutUser).toBe('function');
        expect(typeof findUserBySessionToken).toBe('function');
        expect(typeof deleteAccount).toBe('function');
    });

    it('exports bcrypt password adapters from package entrypoint', () => {
        expect(typeof bcryptPasswordHasher.hashPassword).toBe('function');
        expect(typeof bcryptPasswordVerifier.verifyPassword).toBe('function');
    });

    it('exports database client factory from package entrypoint', () => {
        expect(typeof createDatabaseClient).toBe('function');
    });

    it('exports database repository classes from package entrypoint', () => {
        expect(typeof DrizzleUserRepository).toBe('function');
        expect(typeof DrizzleSessionRepository).toBe('function');
    });

    it('exports database schema objects from package entrypoint', () => {
        expect(users.email.name).toBe('email');
        expect(sessions.userId.name).toBe('user_id');
        expect(usageLogs.actionType.name).toBe('action_type');
        expect(oauthAccounts.provider.name).toBe('provider');
        expect(koreanTickers.symbol.name).toBe('symbol');
        expect(assetTranslations.symbol.name).toBe('symbol');
        expect(userTierEnum.enumValues).toEqual([...USER_TIER_VALUES]);
        expect(usageActionTypeEnum.enumValues).toEqual([
            ...USAGE_ACTION_TYPE_VALUES,
        ]);
        expect(oauthProviderEnum.enumValues).toEqual([
            ...OAUTH_PROVIDER_VALUES,
        ]);
    });

    it('exports database enum values from package entrypoint', () => {
        expect(USER_TIER_VALUES).toEqual(['free', 'member', 'pro']);
        expect(USAGE_ACTION_TYPE_VALUES).toEqual(['analysis', 'chatbot']);
        expect(OAUTH_PROVIDER_VALUES).toEqual(['google', 'kakao', 'apple']);
    });

    it('exports auth interfaces from package entrypoint', () => {
        const repository: UserRepository = {
            findByEmail: async () => null,
            findById: async () => null,
            createEmailUser: async input => ({
                id: 'user-1',
                email: input.email,
                name: input.name ?? null,
                avatarUrl: input.avatarUrl ?? null,
                tier: 'free',
                createdAt: new Date('2026-04-26T00:00:00.000Z'),
                updatedAt: new Date('2026-04-26T00:00:00.000Z'),
            }),
            deleteUser: async () => true,
        };
        const passwordHasher: PasswordHasher = {
            hashPassword: async password => `hashed:${password}`,
        };
        const emailAuthRepository: EmailAuthUserRepository = {
            findEmailAuthUserByEmail: async () => null,
        };
        const oauthRepository: OAuthUserRepository = {
            findByOAuthAccount: async () => null,
            findByEmail: async () => null,
            createOAuthUser: async () => null,
        };
        const sessionRepository: SessionRepository = {
            createSession: async input => ({
                id: 'session-1',
                userId: input.userId,
                expiresAt: input.expiresAt,
                createdAt: new Date('2026-04-26T00:00:00.000Z'),
            }),
            findSession: async () => null,
            deleteSession: async () => true,
        };
        const passwordVerifier: PasswordVerifier = {
            verifyPassword: async () => true,
        };

        expect(repository).toHaveProperty('findByEmail');
        expect(passwordHasher).toHaveProperty('hashPassword');
        expect(emailAuthRepository).toHaveProperty('findEmailAuthUserByEmail');
        expect(oauthRepository).toHaveProperty('findByOAuthAccount');
        expect(sessionRepository).toHaveProperty('createSession');
        expect(passwordVerifier).toHaveProperty('verifyPassword');
    });

    it('runs logout through the package entrypoint', async () => {
        const sessionRepository: SessionRepository = {
            createSession: async input => ({
                id: 'session-1',
                userId: input.userId,
                expiresAt: input.expiresAt,
                createdAt: new Date('2026-04-26T00:00:00.000Z'),
            }),
            findSession: async () => null,
            deleteSession: async () => true,
        };

        const logoutResult = await logoutUser(
            { sessionToken: 'session-1' },
            { sessions: sessionRepository }
        );

        expect(logoutResult.ok).toBe(true);
        expect(logoutResult.sessionInvalidated).toBe(true);
        expect(logoutResult.cookie).toBeDefined();
    });

    it('exports chat application and infrastructure entrypoints', () => {
        expect(typeof requestChatCompletion).toBe('function');
        expect(typeof createChatTokenStore).toBe('function');
        expect(GEMINI_2_5_FLASH_MODEL).toBe('gemini-2.5-flash');
        expect(VALID_CHAT_MODELS).toContain('gemini-2.5-flash-lite');
    });
});
