import {
    GEMINI_2_5_FLASH_LITE_MODEL,
    GEMINI_2_5_FLASH_MODEL,
    GEMINI_2_5_PRO_MODEL,
} from '@/application/chat/constants';
import { requestChatCompletion } from '@/application/chat/requestChatCompletion';
import type { RequestChatCompletionParams } from '@/application/chat/types';
import { TIER_CONFIG } from '@/domain/tier';
import type {
    AnalysisResponse,
    CurrentAnalysisContext,
    ModelId,
    TierConfig,
} from '@/domain/types';
import type { ChatTokenStore } from '@/infrastructure/chat/types';
import type { UsageLogRepository, UsageRepository } from '@/infrastructure/db';
import { constants } from 'node:http2';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MINIMAL_ANALYSIS: AnalysisResponse = {
    summary: 'AAPL trending up.',
    trend: 'bullish',
    riskLevel: 'medium',
    indicatorResults: [],
    keyLevels: { support: [], resistance: [] },
    priceTargets: {
        bullish: { targets: [], condition: '' },
        bearish: { targets: [], condition: '' },
    },
    patternSummaries: [],
    strategyResults: [],
    candlePatterns: [],
    trendlines: [],
};

const restrictedTierConfig: TierConfig = {
    limits: {
        analysisPerDay: { free: Infinity, member: Infinity, pro: Infinity },
        chatbotPerDay: { free: 1, member: Infinity, pro: Infinity },
    },
    timeframes: TIER_CONFIG.timeframes,
    infoDepth: TIER_CONFIG.infoDepth,
    models: {
        free: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
        member: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
        pro: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
    },
    featureFlags: { enableTierRestrictions: true },
};
function createParams(
    overrides: Partial<RequestChatCompletionParams> = {}
): RequestChatCompletionParams {
    return {
        symbol: 'AAPL',
        timeframe: '1Day',
        analysis: MINIMAL_ANALYSIS,
        history: [],
        userMessage: '지금 사도 돼?',
        clientIp: '1.2.3.4',
        // Default: server key + user BYOK key both present. Tests that verify
        // contract violations should override these.
        serverApiKey: 'server-key',
        userApiKey: 'user-key',
        ...overrides,
    };
}

describe('requestChatCompletion', () => {
    const tryConsumeToken = vi.fn();
    const refundConsumedToken = vi.fn();
    const getRemainingTokens = vi.fn();
    const callAiProvider = vi.fn();
    const getUsageToday = vi.fn();
    const recordUsage = vi.fn();
    const recordPremiumUsage = vi.fn();

    const tokenStore: ChatTokenStore = {
        tryConsumeToken,
        refundConsumedToken,
        getRemainingTokens,
    };
    const usageRepository: UsageRepository = {
        getUsageToday,
        recordUsage,
    };

    const usageLogs: UsageLogRepository = {
        recordUsage: recordPremiumUsage,
    };

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-29T00:00:00.000Z'));
        vi.clearAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        tryConsumeToken.mockResolvedValue(true);
        refundConsumedToken.mockResolvedValue(undefined);
        getRemainingTokens.mockResolvedValue(4);
        getUsageToday.mockResolvedValue({ analysis: 0, chatbot: 0 });
        recordUsage.mockResolvedValue({
            id: 'usage-1',
            userId: null,
            ipHash: 'hashed-ip',
            actionType: 'chatbot',
            modelUsed: GEMINI_2_5_FLASH_MODEL,
            date: '2026-04-29',
            createdAt: new Date('2026-04-29T00:00:00.000Z'),
        });
        callAiProvider.mockResolvedValue(
            '분석 기준으로는 조금 기다리는 편이 좋아요.'
        );
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('returns token_exhausted when token consumption is denied', async () => {
        tryConsumeToken.mockResolvedValueOnce(false);

        const result = await requestChatCompletion(createParams(), {
            tokenStore,
            callAiProvider,
        });

        expect(result).toEqual({ ok: false, error: 'token_exhausted' });
        expect(callAiProvider).not.toHaveBeenCalled();
    });

    it('returns chatbot_limit_exceeded before consuming a token when daily usage is exhausted', async () => {
        getUsageToday.mockResolvedValueOnce({ analysis: 0, chatbot: 1 });

        const result = await requestChatCompletion(
            createParams({
                tierContext: { userId: null, tier: 'free' },
                occurredAt: new Date('2026-04-29T00:00:00.000Z'),
            }),
            {
                tokenStore,
                usageRepository,
                callAiProvider,
                tierConfig: restrictedTierConfig,
            }
        );

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'chatbot_limit_exceeded',
                message: 'Daily chatbot usage limit exceeded.',
                feature: 'chatbotPerDay',
                tier: 'free',
            },
        });
        expect(tryConsumeToken).not.toHaveBeenCalled();
        expect(callAiProvider).not.toHaveBeenCalled();
        expect(recordUsage).not.toHaveBeenCalled();
    });

    it('allows the chat request when the usage check throws (fail-open)', async () => {
        const consoleWarn = vi
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);
        getUsageToday.mockRejectedValueOnce(new Error('DB connection failed'));

        const result = await requestChatCompletion(
            createParams({
                tierContext: { userId: null, tier: 'free' },
                occurredAt: new Date('2026-04-29T00:00:00.000Z'),
            }),
            {
                tokenStore,
                usageRepository,
                callAiProvider,
                tierConfig: restrictedTierConfig,
            }
        );

        expect(result).toEqual({
            ok: true,
            message: '분석 기준으로는 조금 기다리는 편이 좋아요.',
            remainingTokens: 4,
        });
        expect(consoleWarn).toHaveBeenCalledWith(
            '[checkUsageLimit] Usage check failed, allowing request:',
            expect.any(Error)
        );
        consoleWarn.mockRestore();
    });

    it('returns user_api_key_required when a non-pro tier user requests a premium model without a user key', async () => {
        const result = await requestChatCompletion(
            createParams({
                model: GEMINI_2_5_PRO_MODEL,
                userApiKey: undefined,
                tierContext: { userId: null, tier: 'member' },
            }),
            { tokenStore, callAiProvider }
        );

        expect(result).toEqual({ ok: false, error: 'user_api_key_required' });
        expect(tryConsumeToken).not.toHaveBeenCalled();
    });

    it('returns server_error when a free model is requested without a server key', async () => {
        const result = await requestChatCompletion(
            createParams({
                model: GEMINI_2_5_FLASH_MODEL,
                userApiKey: undefined,
                serverApiKey: undefined,
            }),
            { tokenStore, callAiProvider }
        );

        expect(result).toEqual({ ok: false, error: 'server_error' });
        expect(tryConsumeToken).not.toHaveBeenCalled();
    });

    it('allows a pro tier user to call a premium model using serverApiKey when no userApiKey is provided', async () => {
        const result = await requestChatCompletion(
            createParams({
                model: GEMINI_2_5_PRO_MODEL,
                userApiKey: undefined,
                serverApiKey: 'server-key',
                tierContext: { userId: 'user-1', tier: 'pro' },
            }),
            { tokenStore, callAiProvider }
        );

        expect(result).toEqual({
            ok: true,
            message: '분석 기준으로는 조금 기다리는 편이 좋아요.',
            remainingTokens: 4,
        });
        expect(callAiProvider).toHaveBeenCalledWith(
            expect.objectContaining({
                primaryApiKey: undefined,
                fallbackApiKey: 'server-key',
                model: GEMINI_2_5_PRO_MODEL,
            })
        );
        expect(tryConsumeToken).toHaveBeenCalled();
    });

    it('returns server_error when a pro tier user has a userApiKey but no serverApiKey', async () => {
        const result = await requestChatCompletion(
            createParams({
                model: GEMINI_2_5_FLASH_MODEL,
                userApiKey: 'paid-key',
                serverApiKey: undefined,
                tierContext: { userId: 'user-1', tier: 'pro' },
            }),
            { tokenStore, callAiProvider }
        );

        expect(result).toEqual({ ok: false, error: 'server_error' });
        expect(tryConsumeToken).not.toHaveBeenCalled();
        expect(callAiProvider).not.toHaveBeenCalled();
    });

    it('returns server_error when a pro tier user has no userApiKey and no serverApiKey', async () => {
        const result = await requestChatCompletion(
            createParams({
                model: GEMINI_2_5_PRO_MODEL,
                userApiKey: undefined,
                serverApiKey: undefined,
                tierContext: { userId: 'user-1', tier: 'pro' },
            }),
            { tokenStore, callAiProvider }
        );

        expect(result).toEqual({ ok: false, error: 'server_error' });
        expect(tryConsumeToken).not.toHaveBeenCalled();
    });

    it('returns model_not_allowed when the model is invalid at runtime', async () => {
        const result = await requestChatCompletion(
            createParams({ model: 'invalid-model' as ModelId }),
            { tokenStore, callAiProvider }
        );

        expect(result).toEqual({ ok: false, error: 'model_not_allowed' });
        expect(tryConsumeToken).not.toHaveBeenCalled();
    });

    it('returns model_not_allowed before token consumption when tier restrictions reject the model', async () => {
        const result = await requestChatCompletion(
            createParams({
                model: GEMINI_2_5_PRO_MODEL,
                tierContext: { userId: 'user-1', tier: 'free' },
            }),
            {
                tokenStore,
                callAiProvider,
                tierConfig: restrictedTierConfig,
            }
        );

        expect(result).toEqual({ ok: false, error: 'model_not_allowed' });
        expect(tryConsumeToken).not.toHaveBeenCalled();
        expect(callAiProvider).not.toHaveBeenCalled();
    });

    it('builds a Gemini request and returns message with remaining tokens', async () => {
        const occurredAt = new Date('2026-04-29T00:00:00.000Z');
        const result = await requestChatCompletion(
            createParams({
                history: [{ role: 'model', content: '이전 답변입니다.' }],
                userMessage: 'RSI도 설명해줘',
                serverApiKey: 'server-key',
                model: GEMINI_2_5_FLASH_LITE_MODEL,
                tierContext: { userId: 'user-1', tier: 'free' },
                occurredAt,
            }),
            {
                tokenStore,
                usageRepository,
                callAiProvider,
                tierConfig: restrictedTierConfig,
            }
        );

        expect(result).toEqual({
            ok: true,
            message: '분석 기준으로는 조금 기다리는 편이 좋아요.',
            remainingTokens: 4,
        });
        expect(tryConsumeToken).toHaveBeenCalledWith(
            '6694f83c9f476da31f5df6bcc520034e7e57d421d247b9d34f49edbfc84a764c'
        );
        expect(callAiProvider).toHaveBeenCalledWith(
            expect.objectContaining({
                primaryApiKey: undefined,
                fallbackApiKey: 'user-key',
                model: GEMINI_2_5_FLASH_LITE_MODEL,
                contents: [
                    {
                        role: 'model',
                        parts: [{ text: '이전 답변입니다.' }],
                    },
                    {
                        role: 'user',
                        parts: [{ text: 'RSI도 설명해줘' }],
                    },
                ],
                systemInstruction: expect.stringContaining('AAPL'),
            })
        );
        expect(getRemainingTokens).toHaveBeenCalledWith(
            '6694f83c9f476da31f5df6bcc520034e7e57d421d247b9d34f49edbfc84a764c'
        );
        expect(getUsageToday).toHaveBeenCalledWith(
            expect.any(String),
            occurredAt
        );
        expect(recordUsage).toHaveBeenCalledWith({
            userId: 'user-1',
            ipAddress: '1.2.3.4',
            actionType: 'chatbot',
            modelUsed: GEMINI_2_5_FLASH_LITE_MODEL,
            occurredAt: occurredAt,
        });
    });

    it('keeps a successful chat response when usage recording fails', async () => {
        const consoleWarn = vi
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);
        recordUsage.mockRejectedValueOnce(new Error('usage db failed'));

        const result = await requestChatCompletion(
            createParams({
                tierContext: { userId: null, tier: 'free' },
                occurredAt: new Date('2026-04-29T00:00:00.000Z'),
            }),
            {
                tokenStore,
                usageRepository,
                callAiProvider,
                tierConfig: restrictedTierConfig,
            }
        );

        expect(result).toEqual({
            ok: true,
            message: '분석 기준으로는 조금 기다리는 편이 좋아요.',
            remainingTokens: 4,
        });
        expect(refundConsumedToken).not.toHaveBeenCalled();
        expect(consoleWarn).toHaveBeenCalledWith(
            '[recordChatUsageSafely] Failed to record chatbot usage:',
            expect.any(Error)
        );
        consoleWarn.mockRestore();
    });

    it('uses the default Gemini chat model when no model is provided', async () => {
        await requestChatCompletion(createParams(), {
            tokenStore,
            callAiProvider,
        });

        const firstCall = (callAiProvider as Mock).mock.calls[0]?.[0];
        expect(firstCall).toMatchObject({ model: GEMINI_2_5_FLASH_MODEL });
    });

    it('records member premium model usage after a successful response', async () => {
        const result = await requestChatCompletion(
            createParams({
                model: GEMINI_2_5_PRO_MODEL,
                tierContext: { userId: 'user-1', tier: 'member' },
                occurredAt: new Date('2026-04-28T12:34:56.000Z'),
            }),
            {
                tokenStore,
                callAiProvider,
                usageLogs,
            }
        );

        expect(result.ok).toBe(true);
        expect(recordPremiumUsage).toHaveBeenCalledWith({
            userId: 'user-1',
            ipHash: '6694f83c9f476da31f5df6bcc520034e7e57d421d247b9d34f49edbfc84a764c',
            actionType: 'premium_model',
            modelUsed: GEMINI_2_5_PRO_MODEL,
            date: '2026-04-28',
        });
    });

    it('records pro premium model usage after a successful response', async () => {
        const result = await requestChatCompletion(
            createParams({
                model: GEMINI_2_5_PRO_MODEL,
                tierContext: { userId: 'user-1', tier: 'pro' },
                occurredAt: new Date('2026-04-28T12:34:56.000Z'),
            }),
            {
                tokenStore,
                callAiProvider,
                usageLogs,
            }
        );

        expect(result.ok).toBe(true);
        expect(recordPremiumUsage).toHaveBeenCalledWith({
            userId: 'user-1',
            ipHash: '6694f83c9f476da31f5df6bcc520034e7e57d421d247b9d34f49edbfc84a764c',
            actionType: 'premium_model',
            modelUsed: GEMINI_2_5_PRO_MODEL,
            date: '2026-04-28',
        });
    });

    it('records premium usage for a pro tier user calling via serverApiKey without userApiKey', async () => {
        const result = await requestChatCompletion(
            createParams({
                model: GEMINI_2_5_PRO_MODEL,
                userApiKey: undefined,
                serverApiKey: 'server-key',
                tierContext: { userId: 'user-1', tier: 'pro' },
                occurredAt: new Date('2026-04-28T12:34:56.000Z'),
            }),
            {
                tokenStore,
                callAiProvider,
                usageLogs,
            }
        );

        expect(result.ok).toBe(true);
        expect(recordPremiumUsage).toHaveBeenCalledWith({
            userId: 'user-1',
            ipHash: '6694f83c9f476da31f5df6bcc520034e7e57d421d247b9d34f49edbfc84a764c',
            actionType: 'premium_model',
            modelUsed: GEMINI_2_5_PRO_MODEL,
            date: '2026-04-28',
        });
    });

    it('passes the same occurredAt to chatbot usage and premium model usage', async () => {
        const occurredAt = new Date('2026-04-28T09:00:00.000Z');

        await requestChatCompletion(
            createParams({
                model: GEMINI_2_5_PRO_MODEL,
                tierContext: { userId: 'user-1', tier: 'member' },
                occurredAt,
            }),
            {
                tokenStore,
                usageRepository,
                callAiProvider,
                usageLogs,
                tierConfig: restrictedTierConfig,
            }
        );

        expect(recordUsage).toHaveBeenCalledWith(
            expect.objectContaining({ occurredAt })
        );
        expect(recordPremiumUsage).toHaveBeenCalledWith(
            expect.objectContaining({ date: '2026-04-28' })
        );
    });

    it('does not record premium model usage for anonymous users', async () => {
        await requestChatCompletion(
            createParams({
                model: GEMINI_2_5_PRO_MODEL,
                tierContext: { userId: null, tier: 'member' },
            }),
            { tokenStore, callAiProvider, usageLogs }
        );

        expect(recordPremiumUsage).not.toHaveBeenCalled();
    });

    it('does not record premium model usage for free tier users', async () => {
        await requestChatCompletion(
            createParams({
                model: GEMINI_2_5_PRO_MODEL,
                tierContext: { userId: 'user-1', tier: 'free' },
            }),
            { tokenStore, callAiProvider, usageLogs }
        );

        expect(recordPremiumUsage).not.toHaveBeenCalled();
    });

    it('does not record free model usage for members', async () => {
        await requestChatCompletion(
            createParams({
                model: GEMINI_2_5_FLASH_MODEL,
                tierContext: { userId: 'user-1', tier: 'member' },
            }),
            { tokenStore, callAiProvider, usageLogs }
        );

        expect(recordPremiumUsage).not.toHaveBeenCalled();
    });

    it('returns successful response when premium usage tracking is not provided', async () => {
        const result = await requestChatCompletion(
            createParams({
                model: GEMINI_2_5_PRO_MODEL,
                tierContext: { userId: 'user-1', tier: 'member' },
            }),
            { tokenStore, callAiProvider }
        );

        expect(result).toEqual({
            ok: true,
            message: '분석 기준으로는 조금 기다리는 편이 좋아요.',
            remainingTokens: 4,
        });
        expect(recordUsage).not.toHaveBeenCalled();
    });

    it('keeps successful chat response when premium usage tracking fails', async () => {
        recordPremiumUsage.mockRejectedValueOnce(
            new Error('database unavailable')
        );

        const result = await requestChatCompletion(
            createParams({
                model: GEMINI_2_5_PRO_MODEL,
                tierContext: { userId: 'user-1', tier: 'member' },
            }),
            { tokenStore, callAiProvider, usageLogs }
        );

        expect(result).toEqual({
            ok: true,
            message: '분석 기준으로는 조금 기다리는 편이 좋아요.',
            remainingTokens: 4,
        });
        expect(console.warn).toHaveBeenCalledWith(
            '[requestChatCompletion] background action failed',
            expect.any(Error)
        );
    });

    it('maps Gemini rate limit errors to rate_limited', async () => {
        callAiProvider.mockRejectedValueOnce(
            Object.assign(new Error('rate limit'), {
                status: constants.HTTP_STATUS_TOO_MANY_REQUESTS,
            })
        );

        const result = await requestChatCompletion(createParams(), {
            tokenStore,
            callAiProvider,
        });

        expect(result).toEqual({ ok: false, error: 'rate_limited' });
        expect(refundConsumedToken).not.toHaveBeenCalled();
        expect(getRemainingTokens).not.toHaveBeenCalled();
        expect(recordUsage).not.toHaveBeenCalled();
    });

    it('maps Gemini service unavailable errors to server_busy', async () => {
        callAiProvider.mockRejectedValueOnce(
            Object.assign(new Error('busy'), {
                status: constants.HTTP_STATUS_SERVICE_UNAVAILABLE,
            })
        );

        const result = await requestChatCompletion(createParams(), {
            tokenStore,
            callAiProvider,
        });

        expect(result).toEqual({ ok: false, error: 'server_busy' });
        expect(refundConsumedToken).toHaveBeenCalledWith(
            '6694f83c9f476da31f5df6bcc520034e7e57d421d247b9d34f49edbfc84a764c'
        );
    });

    it('maps Gemini errors without numeric status to server_error', async () => {
        callAiProvider.mockRejectedValueOnce(
            Object.assign(new Error('bad status'), { status: '503' })
        );

        const result = await requestChatCompletion(createParams(), {
            tokenStore,
            callAiProvider,
        });

        expect(result).toEqual({ ok: false, error: 'server_error' });
        expect(refundConsumedToken).toHaveBeenCalledWith(
            '6694f83c9f476da31f5df6bcc520034e7e57d421d247b9d34f49edbfc84a764c'
        );
    });

    it('maps non-object thrown values to server_error', async () => {
        callAiProvider.mockRejectedValueOnce('string error');

        const result = await requestChatCompletion(createParams(), {
            tokenStore,
            callAiProvider,
        });

        expect(result).toEqual({ ok: false, error: 'server_error' });
        expect(refundConsumedToken).toHaveBeenCalledWith(
            '6694f83c9f476da31f5df6bcc520034e7e57d421d247b9d34f49edbfc84a764c'
        );
    });

    it('passes currentAnalysisContext through to buildChatPrompt so the system prompt can reference live numbers', async () => {
        const currentAnalysisContext: CurrentAnalysisContext = {
            kind: 'technical',
            payload: {
                ...MINIMAL_ANALYSIS,
                summary: 'AAPL is consolidating near 190.',
                trend: 'neutral',
                riskLevel: 'low',
            },
        };

        const result = await requestChatCompletion(
            createParams({ currentAnalysisContext }),
            { tokenStore, callAiProvider }
        );

        expect(result.ok).toBe(true);
        const firstCall = (callAiProvider as Mock).mock.calls[0]?.[0];
        expect(firstCall.systemInstruction).toContain(
            '## Current analysis context'
        );
        expect(firstCall.systemInstruction).toContain('Kind: technical');
        expect(firstCall.systemInstruction).toContain(
            'AAPL is consolidating near 190.'
        );
    });

    it('omits the current analysis context section when not provided', async () => {
        const result = await requestChatCompletion(createParams(), {
            tokenStore,
            callAiProvider,
        });

        expect(result.ok).toBe(true);
        const firstCall = (callAiProvider as Mock).mock.calls[0]?.[0];
        expect(firstCall.systemInstruction).not.toContain(
            '## Current analysis context'
        );
    });

    it('uses the injected tierConfig to validate model identifiers at runtime', async () => {
        const flashOnlyTierConfig: TierConfig = {
            ...restrictedTierConfig,
            models: {
                free: ['gemini-2.5-flash'],
                member: ['gemini-2.5-flash'],
                pro: ['gemini-2.5-flash'],
            },
        };

        const result = await requestChatCompletion(
            createParams({
                model: GEMINI_2_5_PRO_MODEL,
                tierContext: { userId: 'user-1', tier: 'pro' },
            }),
            {
                tokenStore,
                callAiProvider,
                tierConfig: flashOnlyTierConfig,
            }
        );

        expect(result).toEqual({ ok: false, error: 'model_not_allowed' });
        expect(tryConsumeToken).not.toHaveBeenCalled();
        expect(callAiProvider).not.toHaveBeenCalled();
    });

    it('keeps the original server_error when token refund fails', async () => {
        callAiProvider.mockRejectedValueOnce(new Error('network failed'));
        refundConsumedToken.mockRejectedValueOnce(new Error('refund failed'));

        const result = await requestChatCompletion(createParams(), {
            tokenStore,
            callAiProvider,
        });

        expect(result).toEqual({ ok: false, error: 'server_error' });
        expect(console.warn).toHaveBeenCalledWith(
            '[requestChatCompletion] background action failed',
            expect.any(Error)
        );
    });
});
