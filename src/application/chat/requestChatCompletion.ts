import { constants } from 'node:http2';
import { buildChatPrompt } from '@/domain/chat/buildChatPrompt';
import type {
    ChatActionResult,
    ChatErrorCode,
    ChatModel,
    ChatPromptPayload,
    Tier,
    TierConfig,
} from '@/domain/types';
import { DEFAULT_TIER, TIER_CONFIG, isModelAllowed } from '@/domain/tier';
import { callGeminiWithKeyFallback } from '@/infrastructure/ai/gemini';
import type { GeminiContent } from '@/infrastructure/ai/types';
import {
    createChatTokenStore,
    hashClientIp,
} from '@/infrastructure/chat/tokenStore';
import {
    GEMINI_2_5_FLASH_MODEL,
    VALID_CHAT_MODELS,
} from '@/application/chat/constants';
import type {
    RequestChatCompletionDependencies,
    RequestChatCompletionParams,
} from '@/application/chat/types';

const ISO_DATE_LENGTH = 10;
const PREMIUM_MODEL_USAGE_ACTION = 'premium_model';
const FREE_USAGE_UNTRACKED_TIER = 'free' as const satisfies Tier;

const COMPENSATED_CHAT_ERRORS = [
    'server_busy',
    'server_error',
] as const satisfies readonly ChatErrorCode[];

function getHttpErrorStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null || !('status' in error)) {
        return undefined;
    }

    const status = error.status;
    return typeof status === 'number' ? status : undefined;
}

function toChatErrorResult(error: unknown): ChatActionResult {
    const status = getHttpErrorStatus(error);

    if (status === constants.HTTP_STATUS_TOO_MANY_REQUESTS) {
        return { ok: false, error: 'rate_limited' };
    }

    if (status === constants.HTTP_STATUS_SERVICE_UNAVAILABLE) {
        return { ok: false, error: 'server_busy' };
    }

    return { ok: false, error: 'server_error' };
}

function isValidChatModel(model: ChatModel): boolean {
    return VALID_CHAT_MODELS.some(validModel => validModel === model);
}

function isPremiumChatModel(model: ChatModel, config: TierConfig): boolean {
    return !config.models.free.includes(model);
}

function toUsageDate(date: Date): string {
    return date.toISOString().slice(0, ISO_DATE_LENGTH);
}

function toGeminiContents(payload: ChatPromptPayload): GeminiContent[] {
    return payload.messages.map(message => ({
        role: message.role,
        parts: [{ text: message.content }],
    }));
}

function shouldRefundConsumedToken(result: ChatActionResult): boolean {
    return (
        !result.ok &&
        COMPENSATED_CHAT_ERRORS.some(error => error === result.error)
    );
}

function isPremiumUsageTrackedTier(tier: Tier): boolean {
    return tier !== FREE_USAGE_UNTRACKED_TIER;
}

async function callSafely(action: () => Promise<void>): Promise<void> {
    try {
        await action();
    } catch {
        return;
    }
}

/**
 * Request a Gemini chat completion for an existing analysis.
 *
 * The caller owns runtime-specific request handling such as reading Next.js
 * headers and environment variables. This use-case owns SigLens chat policy:
 * IP hashing, token consumption, prompt construction, Gemini payload mapping,
 * key fallback invocation, remaining-token lookup, and UI-facing error codes.
 *
 * Token consumption is compensated when Gemini failures map to server-owned
 * errors (`server_busy` or `server_error`). User/quota outcomes
 * (`token_exhausted` and `rate_limited`) are not refunded.
 */
export async function requestChatCompletion(
    params: RequestChatCompletionParams,
    dependencies: RequestChatCompletionDependencies = {}
): Promise<ChatActionResult> {
    const model = params.model ?? GEMINI_2_5_FLASH_MODEL;
    if (!isValidChatModel(model) || !params.paidApiKey) {
        return { ok: false, error: 'server_error' };
    }

    const tierContext = params.tierContext ?? {
        userId: null,
        tier: DEFAULT_TIER,
    };
    const tierConfig = dependencies.tierConfig ?? TIER_CONFIG;
    if (!isModelAllowed(tierContext.tier, model, tierConfig)) {
        return { ok: false, error: 'model_not_allowed' };
    }

    const tokenStore = dependencies.tokenStore ?? createChatTokenStore();
    const callGemini = dependencies.callGemini ?? callGeminiWithKeyFallback;
    const hashedClientId = hashClientIp(params.clientIp);
    const allowed = await tokenStore.tryConsumeToken(hashedClientId);

    if (!allowed) {
        return { ok: false, error: 'token_exhausted' };
    }

    const prompt = buildChatPrompt(
        params.symbol,
        params.timeframe,
        params.analysis,
        params.history,
        params.userMessage
    );

    try {
        const message = await callGemini({
            freeApiKey: params.freeApiKey,
            paidApiKey: params.paidApiKey,
            model,
            contents: toGeminiContents(prompt),
            systemInstruction: prompt.systemPrompt,
        });
        const remainingTokens =
            await tokenStore.getRemainingTokens(hashedClientId);
        const usageLogs = dependencies.usageLogs;
        const getCurrentDate =
            dependencies.getCurrentDate ?? (() => new Date());
        if (
            tierContext.userId !== null &&
            isPremiumUsageTrackedTier(tierContext.tier) &&
            isPremiumChatModel(model, tierConfig) &&
            usageLogs !== undefined
        ) {
            const userId = tierContext.userId;
            await callSafely(() =>
                usageLogs.recordUsage({
                    userId,
                    ipHash: hashedClientId,
                    actionType: PREMIUM_MODEL_USAGE_ACTION,
                    modelUsed: model,
                    date: toUsageDate(getCurrentDate()),
                })
            );
        }

        return { ok: true, message, remainingTokens };
    } catch (error) {
        const result = toChatErrorResult(error);
        if (shouldRefundConsumedToken(result)) {
            await callSafely(() =>
                tokenStore.refundConsumedToken(hashedClientId)
            );
        }

        return result;
    }
}
