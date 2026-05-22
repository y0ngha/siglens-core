import type { ChatbotLimitError } from '@/application/usage/types';
import type {
    AnalysisResponse,
    ChatMessage,
    CurrentAnalysisContext,
    ModelId,
    TierConfig,
    Timeframe,
    UserTierContext,
} from '@/domain/types';
import type { CallAiProviderOptions } from '@/domain/ports/aiProvider';
import type { ChatTokenStore } from '@/infrastructure/chat/types';
import type { UsageLogRepository, UsageRepository } from '@/infrastructure/db';

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
    /** Full company name forwarded to the chat prompt. Defaults to `symbol` when omitted. */
    companyName?: string;
    timeframe: Timeframe;
    analysis: AnalysisResponse;
    history: ChatMessage[];
    userMessage: string;
    clientIp: string;
    model?: ModelId;
    /**
     * Server-owned API key for AI provider calls.
     *
     * Must be provided when:
     * - `tierContext.tier === 'pro'` (any model) — `server_error` if absent.
     * - Non-pro tier + free model — `server_error` if absent.
     *
     * Not required (and not used) when:
     * - Non-pro tier + premium model + `userApiKey` present (BYOK path).
     */
    serverApiKey?: string;
    /**
     * User-registered BYOK API key.
     *
     * Must be provided when:
     * - Non-`'pro'`-tier user requests a premium model and `serverApiKey` is
     *   absent — omitting it returns `user_api_key_required`.
     *
     * Ignored when:
     * - `tierContext.tier === 'pro'` — server covers all models via
     *   `serverApiKey`; this field is never forwarded.
     * - Non-pro tier + free model — server key is used; this field is ignored.
     */
    userApiKey?: string;
    occurredAt?: Date;
    tierContext?: UserTierContext;
    /**
     * Tagged union representing the analysis result currently displayed on the
     * user's page (technical / fundamental / news / overall). When provided,
     * the chat system prompt receives an extra `## Current analysis context`
     * section so the assistant can reference the live numbers without
     * re-fetching data. Omit to keep the original behavior.
     */
    currentAnalysisContext?: CurrentAnalysisContext;
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
