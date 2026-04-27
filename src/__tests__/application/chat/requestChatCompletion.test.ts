import { constants } from 'node:http2';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
    GEMINI_2_5_FLASH_LITE_MODEL,
    GEMINI_2_5_FLASH_MODEL,
} from '@/application/chat/constants';
import { requestChatCompletion } from '@/application/chat/requestChatCompletion';
import type { RequestChatCompletionParams } from '@/application/chat/types';
import type { AnalysisResponse, ChatModel } from '@/domain/types';
import type { ChatTokenStore } from '@/infrastructure/chat/types';

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

    const tokenStore: ChatTokenStore = {
        tryConsumeToken,
        refundConsumedToken,
        getRemainingTokens,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        tryConsumeToken.mockResolvedValue(true);
        refundConsumedToken.mockResolvedValue(undefined);
        getRemainingTokens.mockResolvedValue(4);
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
        const result = await requestChatCompletion(
            createParams({
                history: [{ role: 'model', content: '이전 답변입니다.' }],
                userMessage: 'RSI도 설명해줘',
                freeApiKey: 'free-key',
                model: GEMINI_2_5_FLASH_LITE_MODEL,
            }),
            { tokenStore, callGemini }
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
