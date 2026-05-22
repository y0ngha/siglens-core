import { GEMINI_2_5_FLASH_MODEL } from '@/application/chat/constants';
import type {
    ChatActionResult,
    ChatErrorCode,
    RequestChatCompletionDependencies,
    RequestChatCompletionParams,
} from '@/application/chat/types';
import { buildUsageLimitError, checkChatbotLimit } from '@/application/usage';
import { buildChatPrompt } from '@/domain/chat/buildChatPrompt';
import type { AiContents, ConversationRole } from '@/domain/ports/aiProvider';
import { DEFAULT_TIER, TIER_CONFIG, isModelAllowed } from '@/domain/tier';
import type {
    ChatMessage,
    ChatPromptPayload,
    ModelId,
    Tier,
    TierConfig,
} from '@/domain/types';
import {
    createChatTokenStore,
    hashClientIp,
} from '@/infrastructure/chat/tokenStore';
import type { ChatTokenStore } from '@/domain/ports/chatTokenStore';
import { type UsageRepository } from '@/infrastructure/db';
import { hashUsageIp } from '@/infrastructure/usage/hash';
import { constants } from 'node:http2';

const ISO_DATE_LENGTH = 10;
const PREMIUM_MODEL_USAGE_ACTION = 'premium_model';

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

/**
 * Resolve the API key to forward to the AI provider.
 *
 * Routing rules (caller-side guards in {@link requestChatCompletion} reject the
 * "no key at all" case before this helper runs):
 * - Pro tier (any model): server covers the cost → `serverApiKey` is the sole key.
 * - Free model (any non-pro tier): server covers the cost → `serverApiKey` is
 *   the sole key. BYOK is not used even if registered.
 * - Non-pro tier + premium model + user BYOK (`userApiKey`) registered: user
 *   pays with their own key → `userApiKey` is the sole key, `serverApiKey` is
 *   `undefined`.
 *
 * The "non-pro + premium + no `userApiKey`" case is unreachable here because
 * {@link requestChatCompletion} returns `user_api_key_required` before calling
 * this helper.
 *
 * Exactly one of `userApiKey` / `serverApiKey` is defined in the return value;
 * the other is always `undefined`.
 *
 * @internal
 */
function resolveApiKeys(
    params: { serverApiKey?: string; userApiKey?: string },
    tier: Tier,
    isPremium: boolean
): {
    userApiKey: string | undefined;
    serverApiKey: string | undefined;
} {
    // Non-pro + premium model + user BYOK: use only the user's key.
    if (tier !== 'pro' && isPremium && params.userApiKey !== undefined) {
        return { userApiKey: params.userApiKey, serverApiKey: undefined };
    }
    // Pro tier, free model, or no userApiKey: use server key exclusively.
    // Guards in `requestChatCompletion` ensure `serverApiKey` is defined here.
    return { userApiKey: undefined, serverApiKey: params.serverApiKey };
}

function isPremiumChatModel(model: ModelId, config: TierConfig): boolean {
    return !config.models.free.includes(model);
}

function toUsageDate(date: Date): string {
    return date.toISOString().slice(0, ISO_DATE_LENGTH);
}

function toConversationRole(role: ChatMessage['role']): ConversationRole {
    return role === 'model' ? 'assistant' : 'user';
}

function toAiContents(payload: ChatPromptPayload): AiContents {
    return payload.messages.map(message => ({
        role: toConversationRole(message.role),
        text: message.content,
    }));
}

function shouldRefundConsumedToken(result: ChatActionResult): boolean {
    return (
        !result.ok &&
        COMPENSATED_CHAT_ERRORS.some(error => error === result.error)
    );
}

function isPremiumUsageTrackedTier(tier: Tier): boolean {
    return tier !== DEFAULT_TIER;
}

async function callSafely(action: () => Promise<void>): Promise<void> {
    try {
        await action();
    } catch (error) {
        console.warn('[requestChatCompletion] background action failed', error);
    }
}

async function recordChatUsageSafely(
    usageRepository: UsageRepository,
    userId: string | null,
    clientIp: string,
    model: ModelId,
    usageOccurredAt: Date
): Promise<void> {
    try {
        await usageRepository.recordUsage({
            userId,
            ipAddress: clientIp,
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

async function checkChatbotUsageAllowed(
    clientIp: string,
    tier: Tier,
    usageTracking: { occurredAt: Date; repository: UsageRepository },
    tierConfig: TierConfig
): Promise<boolean> {
    return checkChatbotLimit(
        {
            ipHash: hashUsageIp(clientIp, usageTracking.occurredAt),
            tier,
            now: usageTracking.occurredAt,
            config: tierConfig,
        },
        { usage: usageTracking.repository }
    );
}

async function requestAiChatCompletion(
    userApiKey: string | undefined,
    serverApiKey: string | undefined,
    tokenStore: ChatTokenStore,
    callAiProvider: RequestChatCompletionDependencies['callAiProvider'],
    model: ModelId,
    hashedClientId: string,
    prompt: ChatPromptPayload
): Promise<ChatActionResult> {
    try {
        const message = await callAiProvider({
            userApiKey,
            serverApiKey,
            model,
            contents: toAiContents(prompt),
            systemInstruction: prompt.systemPrompt,
        });
        const remainingTokens =
            await tokenStore.getRemainingTokens(hashedClientId);

        return { ok: true, message, remainingTokens };
    } catch (error) {
        const result = toChatErrorResult(error);
        console.warn('[requestAiChatCompletion] callAiProvider failed', {
            model,
            errorCode: !result.ok ? result.error : undefined,
            error,
        });
        if (shouldRefundConsumedToken(result)) {
            await callSafely(() =>
                tokenStore.refundConsumedToken(hashedClientId)
            );
        }

        return result;
    }
}

/**
 * Request an AI provider chat completion for an existing analysis.
 *
 * The caller owns runtime-specific request handling such as reading
 * headers and environment variables. This use-case owns SigLens chat policy:
 * model tier gating, IP hashing, daily usage-limit checking when
 * `usageRepository` is provided, token consumption, prompt construction,
 * AI provider payload mapping, key fallback invocation, remaining-token lookup,
 * best-effort usage recording, and UI-facing error codes.
 *
 * **API key routing** (`serverApiKey` = server-owned key; `userApiKey` = user-owned BYOK key):
 * - Pro tier (any model): `serverApiKey` alone is used; server covers all
 *   AI costs. `userApiKey` is ignored even if registered. `serverApiKey` must
 *   be present → else `server_error`.
 * - Free models (non-pro tier): `serverApiKey` alone is used. `userApiKey`
 *   is ignored even if registered. `serverApiKey` must be present → else
 *   `server_error`.
 * - Premium models + non-pro tier + `userApiKey` registered: `userApiKey`
 *   alone is used; `serverApiKey` is not consulted and need not be present.
 * - Premium models + non-pro tier + no `userApiKey`: returns
 *   `user_api_key_required` so the caller can prompt the user to register
 *   a BYOK key.
 *
 * Model-allowed check (`isModelAllowed`) runs after the key/tier guards above.
 *
 * Token refund: when the result is `server_busy` or `server_error`, the
 * consumed token is returned to the caller's bucket via a best-effort
 * background call so server-side failures do not count against the daily
 * allowance.
 *
 * @param params - Chat request parameters: symbol, timeframe, prior analysis,
 *   conversation history, user message, client IP, optional model and API keys,
 *   optional `occurredAt` timestamp, and optional `tierContext`.
 * @param dependencies - Required `callAiProvider` plus optional injectable
 *   dependencies: token store, usage repository, premium usage logs, and
 *   tier configuration. The token store defaults to the built-in Redis-backed
 *   implementation; `callAiProvider` must be supplied by the caller and is
 *   responsible for routing by `options.model` to the upstream provider.
 * @returns A {@link ChatActionResult} — `{ ok: true, message, remainingTokens }`
 *   on success, or `{ ok: false, error }` with a typed error code:
 *   - `user_api_key_required` — premium model requested by a non-pro-tier user
 *     without a registered API key; show a "register your key" CTA.
 *   - `model_not_allowed` — the caller's tier does not have access to this model.
 *   - `token_exhausted` — daily chat token budget consumed.
 *   - `rate_limited` — upstream provider rate limit hit.
 *   - `server_busy` — upstream provider temporarily unavailable (token refunded).
 *   - `server_error` — unexpected server-side failure.
 *   - {@link ChatbotLimitError} — daily usage limit exceeded.
 *
 * @throws {never} Never throws — all infrastructure failures are mapped to typed
 *   error codes in the return value.
 *
 * @see ChatActionResult
 * @see RequestChatCompletionParams
 * @see RequestChatCompletionDependencies
 */
export async function requestChatCompletion(
    params: RequestChatCompletionParams,
    dependencies: RequestChatCompletionDependencies
): Promise<ChatActionResult> {
    const model = params.model ?? GEMINI_2_5_FLASH_MODEL;
    const tierConfig = dependencies.tierConfig ?? TIER_CONFIG;

    const tierContext = params.tierContext ?? {
        userId: null,
        tier: DEFAULT_TIER,
    };

    const isPremium = isPremiumChatModel(model, tierConfig);

    if (tierContext.tier === 'pro' || !isPremium) {
        if (!params.serverApiKey) {
            return { ok: false, error: 'server_error' };
        }
    } else if (!params.userApiKey) {
        // Non-pro + premium model: BYOK is required.
        return { ok: false, error: 'user_api_key_required' };
    }

    if (!isModelAllowed(tierContext.tier, model, tierConfig)) {
        return { ok: false, error: 'model_not_allowed' };
    }

    const tokenStore = dependencies.tokenStore ?? createChatTokenStore();
    const callAiProvider = dependencies.callAiProvider;
    const occurredAt = params.occurredAt ?? new Date();
    const usageRepository = dependencies.usageRepository;
    const usageTracking =
        usageRepository === undefined
            ? undefined
            : {
                  repository: usageRepository,
                  occurredAt,
              };
    const usageAllowed =
        usageTracking === undefined
            ? true
            : await checkChatbotUsageAllowed(
                  params.clientIp,
                  tierContext.tier,
                  usageTracking,
                  tierConfig
              );

    if (!usageAllowed) {
        return {
            ok: false,
            error: buildUsageLimitError('chatbotPerDay', tierContext.tier),
        };
    }

    const hashedClientId = hashClientIp(params.clientIp);
    const allowed = await tokenStore.tryConsumeToken(hashedClientId);

    if (!allowed) {
        return { ok: false, error: 'token_exhausted' };
    }

    const prompt = buildChatPrompt(
        params.symbol,
        params.companyName ?? params.symbol,
        params.timeframe,
        params.analysis,
        params.history,
        params.userMessage,
        params.currentAnalysisContext
    );

    const {
        userApiKey: effectiveUserApiKey,
        serverApiKey: effectiveServerApiKey,
    } = resolveApiKeys(params, tierContext.tier, isPremium);

    const aiResult = await requestAiChatCompletion(
        effectiveUserApiKey,
        effectiveServerApiKey,
        tokenStore,
        callAiProvider,
        model,
        hashedClientId,
        prompt
    );

    if (!aiResult.ok) {
        return aiResult;
    }

    if (usageTracking !== undefined) {
        await recordChatUsageSafely(
            usageTracking.repository,
            tierContext.userId,
            params.clientIp,
            model,
            usageTracking.occurredAt
        );
    }

    const usageLogs = dependencies.usageLogs;
    const shouldRecordPremiumUsage =
        tierContext.userId !== null &&
        isPremiumUsageTrackedTier(tierContext.tier) &&
        isPremium &&
        usageLogs !== undefined;

    if (shouldRecordPremiumUsage) {
        const userId = tierContext.userId;
        await callSafely(() =>
            usageLogs.recordUsage({
                userId,
                ipHash: hashedClientId,
                actionType: PREMIUM_MODEL_USAGE_ACTION,
                modelUsed: model,
                date: toUsageDate(occurredAt),
            })
        );
    }

    return aiResult;
}
