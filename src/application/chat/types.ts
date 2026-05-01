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
