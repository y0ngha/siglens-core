import { constants } from 'node:http2';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
    GEMINI_2_5_FLASH_LITE_MODEL,
    GEMINI_2_5_FLASH_MODEL,
} from '@/application/chat/constants';
import { requestChatCompletion } from '@/application/chat/requestChatCompletion';
import type { RequestChatCompletionParams } from '@/application/chat/types';
import type { AnalysisResponse, ChatModel, TierConfig } from '@/domain/types';
import type { ChatTokenStore } from '@/infrastructure/chat/types';
import type { UsageRepository } from '@/infrastructure/db';

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
    timeframes: { free: ['1Day'], member: ['1Day'], pro: ['1Day'] },
    infoDepth: { free: ['summary'], member: ['summary'], pro: ['summary'] },
    models: {
        free: ['gemini-2.5-flash'],
        member: ['gemini-2.5-flash'],
        pro: ['gemini-2.5-flash'],
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
        paidApiKey: 'paid-key',
        ...overrides,
    };
}

describe('requestChatCompletion', () => {
    const tryConsumeToken = vi.fn();
    const refundConsumedToken = vi.fn();
    const getRemainingTokens = vi.fn();
    const callGemini = vi.fn();
    const getUsageToday = vi.fn();
    const recordUsage = vi.fn();

    const tokenStore: ChatTokenStore = {
        tryConsumeToken,
        refundConsumedToken,
        getRemainingTokens,
    };
    const usageRepository: UsageRepository = {
        getUsageToday,
        recordUsage,
    };

    beforeEach(() => {
        vi.clearAllMocks();
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
        callGemini.mockResolvedValue(
            '분석 기준으로는 조금 기다리는 편이 좋아요.'
        );
    });

    it('returns token_exhausted when token consumption is denied', async () => {
        tryConsumeToken.mockResolvedValueOnce(false);

        const result = await requestChatCompletion(createParams(), {
            tokenStore,
            callGemini,
        });

        expect(result).toEqual({ ok: false, error: 'token_exhausted' });
        expect(callGemini).not.toHaveBeenCalled();
    });

    it('returns chatbot_limit_exceeded before consuming a token when daily usage is exhausted', async () => {
        getUsageToday.mockResolvedValueOnce({ analysis: 0, chatbot: 1 });

        const result = await requestChatCompletion(
            createParams({
                tier: 'free',
                tierConfig: restrictedTierConfig,
            }),
            { tokenStore, usageRepository, callGemini }
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
        expect(callGemini).not.toHaveBeenCalled();
        expect(recordUsage).not.toHaveBeenCalled();
    });

    it('returns server_error when the paid key is missing', async () => {
        const result = await requestChatCompletion(
            createParams({ paidApiKey: undefined }),
            { tokenStore, callGemini }
        );

        expect(result).toEqual({ ok: false, error: 'server_error' });
        expect(tryConsumeToken).not.toHaveBeenCalled();
    });

    it('returns server_error when the model is invalid at runtime', async () => {
        const result = await requestChatCompletion(
            createParams({ model: 'invalid-model' as ChatModel }),
            { tokenStore, callGemini }
        );

        expect(result).toEqual({ ok: false, error: 'server_error' });
        expect(tryConsumeToken).not.toHaveBeenCalled();
    });

    it('builds a Gemini request and returns message with remaining tokens', async () => {
        const usageOccurredAt = new Date('2026-04-29T00:00:00.000Z');
        const result = await requestChatCompletion(
            createParams({
                history: [{ role: 'model', content: '이전 답변입니다.' }],
                userMessage: 'RSI도 설명해줘',
                freeApiKey: 'free-key',
                model: GEMINI_2_5_FLASH_LITE_MODEL,
                tier: 'free',
                userId: 'user-1',
                usageOccurredAt,
                tierConfig: restrictedTierConfig,
            }),
            { tokenStore, usageRepository, callGemini }
        );

        expect(result).toEqual({
            ok: true,
            message: '분석 기준으로는 조금 기다리는 편이 좋아요.',
            remainingTokens: 4,
        });
        expect(tryConsumeToken).toHaveBeenCalledWith(
            '6694f83c9f476da31f5df6bcc520034e7e57d421d247b9d34f49edbfc84a764c'
        );
        expect(callGemini).toHaveBeenCalledWith(
            expect.objectContaining({
                freeApiKey: 'free-key',
                paidApiKey: 'paid-key',
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
            usageOccurredAt
        );
        expect(recordUsage).toHaveBeenCalledWith({
            userId: 'user-1',
            ipAddress: '1.2.3.4',
            actionType: 'chatbot',
            modelUsed: GEMINI_2_5_FLASH_LITE_MODEL,
            occurredAt: usageOccurredAt,
        });
    });

    it('keeps a successful chat response when usage recording fails', async () => {
        recordUsage.mockRejectedValueOnce(new Error('usage db failed'));

        const result = await requestChatCompletion(
            createParams({
                tier: 'free',
                tierConfig: restrictedTierConfig,
            }),
            { tokenStore, usageRepository, callGemini }
        );

        expect(result).toEqual({
            ok: true,
            message: '분석 기준으로는 조금 기다리는 편이 좋아요.',
            remainingTokens: 4,
        });
        expect(refundConsumedToken).not.toHaveBeenCalled();
    });

    it('uses the default Gemini chat model when no model is provided', async () => {
        await requestChatCompletion(createParams(), {
            tokenStore,
            callGemini,
        });

        const firstCall = (callGemini as Mock).mock.calls[0]?.[0];
        expect(firstCall).toMatchObject({ model: GEMINI_2_5_FLASH_MODEL });
    });

    it('maps Gemini rate limit errors to rate_limited', async () => {
        callGemini.mockRejectedValueOnce(
            Object.assign(new Error('rate limit'), {
                status: constants.HTTP_STATUS_TOO_MANY_REQUESTS,
            })
        );

        const result = await requestChatCompletion(createParams(), {
            tokenStore,
            callGemini,
        });

        expect(result).toEqual({ ok: false, error: 'rate_limited' });
        expect(refundConsumedToken).not.toHaveBeenCalled();
        expect(getRemainingTokens).not.toHaveBeenCalled();
        expect(recordUsage).not.toHaveBeenCalled();
    });

    it('maps Gemini service unavailable errors to server_busy', async () => {
        callGemini.mockRejectedValueOnce(
            Object.assign(new Error('busy'), {
                status: constants.HTTP_STATUS_SERVICE_UNAVAILABLE,
            })
        );

        const result = await requestChatCompletion(createParams(), {
            tokenStore,
            callGemini,
        });

        expect(result).toEqual({ ok: false, error: 'server_busy' });
        expect(refundConsumedToken).toHaveBeenCalledWith(
            '6694f83c9f476da31f5df6bcc520034e7e57d421d247b9d34f49edbfc84a764c'
        );
    });

    it('maps Gemini errors without numeric status to server_error', async () => {
        callGemini.mockRejectedValueOnce(
            Object.assign(new Error('bad status'), { status: '503' })
        );

        const result = await requestChatCompletion(createParams(), {
            tokenStore,
            callGemini,
        });

        expect(result).toEqual({ ok: false, error: 'server_error' });
        expect(refundConsumedToken).toHaveBeenCalledWith(
            '6694f83c9f476da31f5df6bcc520034e7e57d421d247b9d34f49edbfc84a764c'
        );
    });

    it('maps non-object thrown values to server_error', async () => {
        callGemini.mockRejectedValueOnce('string error');

        const result = await requestChatCompletion(createParams(), {
            tokenStore,
            callGemini,
        });

        expect(result).toEqual({ ok: false, error: 'server_error' });
        expect(refundConsumedToken).toHaveBeenCalledWith(
            '6694f83c9f476da31f5df6bcc520034e7e57d421d247b9d34f49edbfc84a764c'
        );
    });

    it('keeps the original server_error when token refund fails', async () => {
        callGemini.mockRejectedValueOnce(new Error('network failed'));
        refundConsumedToken.mockRejectedValueOnce(new Error('refund failed'));

        const result = await requestChatCompletion(createParams(), {
            tokenStore,
            callGemini,
        });

        expect(result).toEqual({ ok: false, error: 'server_error' });
    });
});
