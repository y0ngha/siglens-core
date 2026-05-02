import type { ChatbotLimitError } from '@/application/usage/types';
import type { CallAiProviderOptions } from '@/infrastructure/ai/types';
import type { ChatTokenStore } from '@/infrastructure/chat/types';
import type { UsageLogRepository, UsageRepository } from '@/infrastructure/db';
import type {
    AnalysisResponse,
    ChatMessage,
    ModelId,
    TierConfig,
    Timeframe,
    UserTierContext,
} from '@/domain/types';

/** Error code produced by chat infrastructure or application policy. */
export type ChatErrorCode =
    | 'token_exhausted'
    | 'model_not_allowed'
    | 'rate_limited'
    | 'server_error'
    | 'server_busy'
    | 'user_api_key_required';

export interface RequestChatCompletionParams {
    symbol: string;
    timeframe: Timeframe;
    analysis: AnalysisResponse;
    history: ChatMessage[];
    userMessage: string;
    clientIp: string;
    model?: ModelId;
    /**
     * Server-owned API key for all AI provider calls.
     * When `paidApiKey` is also present, this key is the **primary** credential
     * and `paidApiKey` is the fallback. For `'pro'`-tier users (who do not
     * supply a `paidApiKey`), this is the sole credential forwarded to the AI
     * provider.
     */
    freeApiKey?: string;
    /**
     * User-registered API key. Must be provided when a non-`'pro'`-tier user
     * requests a premium model. Omitting it in that case returns
     * `user_api_key_required`. `'pro'`-tier users are exempt — the server
     * covers all models via `freeApiKey` and never requires a personal key.
     */
    paidApiKey?: string;
    occurredAt?: Date;
    tierContext?: UserTierContext;
}

export interface RequestChatCompletionDependencies {
    tokenStore?: ChatTokenStore;
    usageRepository?: UsageRepository;
    usageLogs?: UsageLogRepository;
    /**
     * AI provider implementation. Required.
     *
     * Implementations must route by `options.model` to the appropriate
     * upstream provider (Gemini, OpenAI, Anthropic, etc.) and return the
     * generated text. The core library no longer ships a default adapter —
     * callers wire up their own provider client and inject it here.
     */
    callAiProvider: (options: CallAiProviderOptions) => Promise<string>;
    tierConfig?: TierConfig;
}

/** Result returned by {@link requestChatCompletion}. */
export type ChatActionResult =
    | { ok: true; message: string; remainingTokens: number }
    | { ok: false; error: ChatErrorCode }
    | { ok: false; error: ChatbotLimitError };

export type RequestChatCompletionResult = ChatActionResult;
