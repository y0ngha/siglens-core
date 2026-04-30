import type { ChatUsageLimitError } from '@/application/usage/types';
import type { CallGeminiWithKeyFallbackOptions } from '@/infrastructure/ai/types';
import type { ChatTokenStore } from '@/infrastructure/chat/types';
import type { UsageLogRepository, UsageRepository } from '@/infrastructure/db';
import type {
    AnalysisResponse,
    ChatMessage,
    ChatModel,
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
    model?: ChatModel;
    freeApiKey?: string;
    paidApiKey?: string;
    usageOccurredAt?: Date;
    tierContext?: UserTierContext;
}

export interface RequestChatCompletionDependencies {
    tokenStore?: ChatTokenStore;
    usageRepository?: UsageRepository;
    usageLogs?: UsageLogRepository;
    callGemini?: (options: CallGeminiWithKeyFallbackOptions) => Promise<string>;
    tierConfig?: TierConfig;
    getCurrentDate?: () => Date;
}

/** Result returned by {@link requestChatCompletion}. */
export type ChatActionResult =
    | { ok: true; message: string; remainingTokens: number }
    | { ok: false; error: ChatErrorCode }
    | { ok: false; error: ChatUsageLimitError };

export type RequestChatCompletionResult = ChatActionResult;
