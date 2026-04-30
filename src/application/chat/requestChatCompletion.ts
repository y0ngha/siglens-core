import {
    GEMINI_2_5_FLASH_MODEL,
    VALID_CHAT_MODELS,
} from '@/application/chat/constants';
import type {
    ChatActionResult,
    RequestChatCompletionDependencies,
    RequestChatCompletionParams,
} from '@/application/chat/types';
import { buildUsageLimitError, checkChatbotLimit } from '@/application/usage';
import { buildChatPrompt } from '@/domain/chat/buildChatPrompt';
import { DEFAULT_TIER } from '@/domain/tier';
import type {
    ChatErrorCode,
    ChatModel,
    ChatPromptPayload,
} from '@/domain/types';
import { callGeminiWithKeyFallback } from '@/infrastructure/ai/gemini';
import type { GeminiContent } from '@/infrastructure/ai/types';
import {
    createChatTokenStore,
    hashClientIp,
} from '@/infrastructure/chat/tokenStore';
import type { ChatTokenStore } from '@/infrastructure/chat/types';
import { hashUsageIp } from '@/infrastructure/db';
import type { UsageRepository } from '@/infrastructure/db';
import { constants } from 'node:http2';

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

async function refundConsumedTokenSafely(
    refund: () => Promise<void>
): Promise<void> {
    try {
        await refund();
    } catch {
        return;
    }
}

async function recordChatUsageSafely(
    usageRepository: UsageRepository,
    params: RequestChatCompletionParams,
    model: ChatModel,
    usageOccurredAt: Date
): Promise<void> {
    try {
        await usageRepository.recordUsage({
            userId: params.userId ?? null,
            ipAddress: params.clientIp,
            actionType: 'chatbot',
            modelUsed: model,
            occurredAt: usageOccurredAt,
        });
    } catch (error) {
        console.warn(
            '[recordChatUsageSafely] Failed to record chatbot usage:',
            error
        );
    }
}

async function requestGeminiChatCompletion(
    freeApiKey: RequestChatCompletionParams['freeApiKey'],
    paidApiKey: NonNullable<RequestChatCompletionParams['paidApiKey']>,
    tokenStore: ChatTokenStore,
    callGemini: NonNullable<RequestChatCompletionDependencies['callGemini']>,
    model: ChatModel,
    hashedClientId: string,
    prompt: ChatPromptPayload
): Promise<ChatActionResult> {
    try {
        const message = await callGemini({
            freeApiKey,
            paidApiKey,
            model,
            contents: toGeminiContents(prompt),
            systemInstruction: prompt.systemPrompt,
        });
        const remainingTokens =
            await tokenStore.getRemainingTokens(hashedClientId);

        return { ok: true, message, remainingTokens };
    } catch (error) {
        const result = toChatErrorResult(error);
        if (shouldRefundConsumedToken(result)) {
            await refundConsumedTokenSafely(() =>
                tokenStore.refundConsumedToken(hashedClientId)
            );
        }

        return result;
    }
}

/**
 * Request a Gemini chat completion for an existing analysis.
 *
 * The caller owns runtime-specific request handling such as reading Next.js
 * headers and environment variables. This use-case owns SigLens chat policy:
 * IP hashing, daily usage-limit checking when `usageRepository` is provided,
 * token consumption, prompt construction, Gemini payload mapping, key fallback
 * invocation, remaining-token lookup, best-effort usage recording, and
 * UI-facing error codes.
 *
 * Token consumption is compensated when Gemini failures map to server-owned
 * errors (`server_busy` or `server_error`). User/quota outcomes
 * (`token_exhausted`, `rate_limited`, and daily usage-limit errors) are not
 * refunded.
 *
 * @param params - Chat request payload, including symbol/timeframe analysis
 *   context, message history, user input, client IP, `paidApiKey`, optional
 *   `freeApiKey`, optional `tier`, optional `userId`, optional
 *   `usageOccurredAt`, and optional `tierConfig` override for daily limits.
 * @param dependencies - Optional infrastructure overrides. Pass
 *   `usageRepository` to enable daily chatbot limit checks and best-effort
 *   usage recording; pass `tokenStore` or `callGemini` for tests/custom wiring.
 * @returns Chat result with a Gemini message and remaining token count, or a
 *   UI-facing error code / structured daily usage-limit error.
 */
export async function requestChatCompletion(
    params: RequestChatCompletionParams,
    dependencies: RequestChatCompletionDependencies = {}
): Promise<ChatActionResult> {
    const model = params.model ?? GEMINI_2_5_FLASH_MODEL;
    const paidApiKey = params.paidApiKey;
    if (!isValidChatModel(model) || !paidApiKey) {
        return { ok: false, error: 'server_error' };
    }

    const tokenStore = dependencies.tokenStore ?? createChatTokenStore();
    const callGemini = dependencies.callGemini ?? callGeminiWithKeyFallback;
    const usageRepository = dependencies.usageRepository;
    const tier = params.tier ?? DEFAULT_TIER;
    const usageTracking =
        usageRepository === undefined
            ? undefined
            : {
                  repository: usageRepository,
                  occurredAt: params.usageOccurredAt ?? new Date(),
              };
    const usageAllowed =
        usageTracking === undefined
            ? true
            : await checkChatbotLimit(
                  {
                      ipHash: hashUsageIp(
                          params.clientIp,
                          usageTracking.occurredAt
                      ),
                      tier,
                      now: usageTracking.occurredAt,
                      config: params.tierConfig,
                  },
                  { usage: usageTracking.repository }
              );

    if (!usageAllowed) {
        const error = buildUsageLimitError('chatbotPerDay', tier);

        return {
            ok: false,
            error,
        };
    }

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

    const { freeApiKey } = params;

    const geminiResult = await requestGeminiChatCompletion(
        freeApiKey,
        paidApiKey,
        tokenStore,
        callGemini,
        model,
        hashedClientId,
        prompt
    );

    if (!geminiResult.ok) {
        return geminiResult;
    }

    if (usageTracking !== undefined) {
        await recordChatUsageSafely(
            usageTracking.repository,
            params,
            model,
            usageTracking.occurredAt
        );
    }

    return geminiResult;
}
