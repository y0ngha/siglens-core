import { constants } from 'node:http2';
import {
    GEMINI_2_5_FLASH_MODEL,
    VALID_CHAT_MODELS,
} from '@/application/chat/constants';
import type {
    ChatActionResult,
    ChatErrorCode,
    RequestChatCompletionDependencies,
    RequestChatCompletionParams,
} from '@/application/chat/types';
import { buildUsageLimitError, checkChatbotLimit } from '@/application/usage';
import { buildChatPrompt } from '@/domain/chat/buildChatPrompt';
import {
    DEFAULT_TIER,
    TIER_CONFIG,
    getAllowedModels,
    isModelAllowed,
} from '@/domain/tier';
import type {
    ChatPromptPayload,
    ModelId,
    Tier,
    TierConfig,
} from '@/domain/types';
import type { AiContents } from '@/infrastructure/ai/types';
import {
    createChatTokenStore,
    hashClientIp,
} from '@/infrastructure/chat/tokenStore';
import type { ChatTokenStore } from '@/infrastructure/chat/types';
import { type UsageRepository } from '@/infrastructure/db';
import { hashUsageIp } from '@/infrastructure/usage/hash';

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

// Runtime guard against `as ModelId` casts; rejects model identifiers not
// present in the active tier configuration. Falls back to the static
// `VALID_CHAT_MODELS` snapshot when the caller does not inject a custom
// `TierConfig`.
function isValidChatModel(model: ModelId, config?: TierConfig): boolean {
    const allowed: readonly ModelId[] =
        config === undefined ? VALID_CHAT_MODELS : getAllowedModels('pro', config);
    return allowed.some(validModel => validModel === model);
}

/**
 * Resolve the primary / fallback API key pair forwarded to the AI provider.
 *
 * Routing matrix — see JSDoc on
 * {@link RequestChatCompletionParams.freeApiKey} for the full contract.
 * Caller-side guards in {@link requestChatCompletion} ensure the keys
 * required by each branch are present before this helper runs:
 * - When `paidApiKey` is absent, the call site has already enforced
 *   pro tier + premium model + present `freeApiKey`, so `freeApiKey`
 *   is the sole server-owned credential and is used as the fallback
 *   (primary is undefined so the provider does not attempt a separate
 *   primary call).
 * - When `paidApiKey` is present, `freeApiKey` is the primary credential
 *   (may be undefined for pro-tier requests that skip the primary call)
 *   and `paidApiKey` is the fallback.
 *
 * @internal
 */
function resolveApiKeys(params: {
    freeApiKey?: string;
    paidApiKey?: string;
}): { primary: string | undefined; fallback: string } {
    if (params.paidApiKey === undefined) {
        // Guard in `requestChatCompletion` ensures `freeApiKey` is defined here.
        return { primary: undefined, fallback: params.freeApiKey! };
    }
    return { primary: params.freeApiKey, fallback: params.paidApiKey };
}

function isPremiumChatModel(model: ModelId, config: TierConfig): boolean {
    return !config.models.free.includes(model);
}

function toUsageDate(date: Date): string {
    return date.toISOString().slice(0, ISO_DATE_LENGTH);
}

function toAiContents(payload: ChatPromptPayload): AiContents {
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
    primaryApiKey: string | undefined,
    fallbackApiKey: string,
    tokenStore: ChatTokenStore,
    callAiProvider: RequestChatCompletionDependencies['callAiProvider'],
    model: ModelId,
    hashedClientId: string,
    prompt: ChatPromptPayload
): Promise<ChatActionResult> {
    try {
        const message = await callAiProvider({
            primaryApiKey,
            fallbackApiKey,
            model,
            contents: toAiContents(prompt),
            systemInstruction: prompt.systemPrompt,
        });
        const remainingTokens =
            await tokenStore.getRemainingTokens(hashedClientId);

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
 * **API key routing** (`freeApiKey` = server-owned key; `paidApiKey` = user-owned key):
 * - `'pro'`-tier users: the server uses `freeApiKey` for premium models
 *   without requiring a user-registered `paidApiKey`; the pro tier covers
 *   premium AI costs server-side. `freeApiKey` must be present → else `server_error`.
 * - Non-pro users: both `freeApiKey` and `paidApiKey` must be provided by the
 *   server. `freeApiKey` is the primary key; `paidApiKey` is the fallback.
 *   Requesting a premium model without `paidApiKey` returns
 *   `user_api_key_required` so the caller can prompt the user to register a key.
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
    const paidApiKey = params.paidApiKey;
    const tierConfig = dependencies.tierConfig ?? TIER_CONFIG;

    if (!isValidChatModel(model, tierConfig)) {
        return { ok: false, error: 'server_error' };
    }

    const tierContext = params.tierContext ?? {
        userId: null,
        tier: DEFAULT_TIER,
    };
    const isPremium = isPremiumChatModel(model, tierConfig);

    if (!paidApiKey) {
        if (!isPremium) {
            return { ok: false, error: 'server_error' };
        }
        if (tierContext.tier !== 'pro') {
            return { ok: false, error: 'user_api_key_required' };
        }
        // Pro tier + premium model: freeApiKey is the server-owned key.
        if (!params.freeApiKey) {
            return { ok: false, error: 'server_error' };
        }
    } else if (tierContext.tier !== 'pro' && !params.freeApiKey) {
        // Non-pro users must always receive both keys from the server
        // (freeApiKey = primary, paidApiKey = fallback). Missing the primary
        // here means the caller did not honor the contract on
        // `RequestChatCompletionParams.freeApiKey`; refuse rather than silently
        // routing fallback-only with primary=undefined.
        return { ok: false, error: 'server_error' };
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
        params.timeframe,
        params.analysis,
        params.history,
        params.userMessage,
        params.currentAnalysisContext
    );

    const { primary: effectivePrimaryKey, fallback: effectiveFallbackKey } =
        resolveApiKeys(params);

    const aiResult = await requestAiChatCompletion(
        effectivePrimaryKey,
        effectiveFallbackKey,
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
