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
    | 'server_busy';

export interface RequestChatCompletionParams {
    symbol: string;
    timeframe: Timeframe;
    analysis: AnalysisResponse;
    history: ChatMessage[];
    userMessage: string;
    clientIp: string;
    model?: ModelId;
    freeApiKey?: string;
    paidApiKey?: string;
    occurredAt?: Date;
    tierContext?: UserTierContext;
}

export interface RequestChatCompletionDependencies {
    tokenStore?: ChatTokenStore;
    usageRepository?: UsageRepository;
    usageLogs?: UsageLogRepository;
    /**
     * AI provider implementation.
     *
     * The default falls back to {@link callGeminiWithKeyFallback}, which only
     * understands Gemini model identifiers. If the configured `tierConfig`
     * grants access to non-Gemini models (e.g. `gpt-*`, `claude-*`) and a
     * caller selects one, requests will reach the Gemini API with an
     * unrecognised model and surface as a runtime `server_error` rather than
     * an upfront validation failure.
     *
     * Supply a custom implementation that routes by `options.model` to the
     * appropriate provider whenever non-Gemini models are enabled.
     */
    callAiProvider?: (options: CallAiProviderOptions) => Promise<string>;
    /**
     * @deprecated Use {@link callAiProvider} instead. Will be removed in the next major version.
     */
    callGemini?: (options: CallAiProviderOptions) => Promise<string>;
    tierConfig?: TierConfig;
    /**
     * @deprecated Pass `occurredAt` via {@link RequestChatCompletionParams} instead.
     * During the deprecation period, this is used as a fallback when `occurredAt` is not provided.
     * Will be removed in the next major version.
     */
    getCurrentDate?: () => Date;
}

/** Result returned by {@link requestChatCompletion}. */
export type ChatActionResult =
    | { ok: true; message: string; remainingTokens: number }
    | { ok: false; error: ChatErrorCode }
    | { ok: false; error: ChatbotLimitError };

export type RequestChatCompletionResult = ChatActionResult;
