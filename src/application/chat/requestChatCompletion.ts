import { constants } from 'node:http2';
import { buildChatPrompt } from '@/domain/chat/buildChatPrompt';
import type {
    ChatActionResult,
    ChatModel,
    ChatPromptPayload,
} from '@/domain/types';
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

function toGeminiContents(payload: ChatPromptPayload): GeminiContent[] {
    return payload.messages.map(message => ({
        role: message.role,
        parts: [{ text: message.content }],
    }));
}

/**
 * Request a Gemini chat completion for an existing analysis.
 *
 * The caller owns runtime-specific request handling such as reading Next.js
 * headers and environment variables. This use-case owns SigLens chat policy:
 * IP hashing, token consumption, prompt construction, Gemini payload mapping,
 * key fallback invocation, remaining-token lookup, and UI-facing error codes.
 */
export async function requestChatCompletion(
    params: RequestChatCompletionParams,
    dependencies: RequestChatCompletionDependencies = {}
): Promise<ChatActionResult> {
    const model = params.model ?? GEMINI_2_5_FLASH_MODEL;
    if (!isValidChatModel(model) || !params.paidApiKey) {
        return { ok: false, error: 'server_error' };
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

        return { ok: true, message, remainingTokens };
    } catch (error) {
        return toChatErrorResult(error);
    }
}
