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
    callAiProvider?: (options: CallAiProviderOptions) => Promise<string>;
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
