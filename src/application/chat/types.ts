import type {
    AnalysisResponse,
    ChatMessage,
    ChatModel,
    TierConfig,
    Timeframe,
    UserTierContext,
} from '@/domain/types';
import type { ChatTokenStore } from '@/infrastructure/chat/types';
import type { CallGeminiWithKeyFallbackOptions } from '@/infrastructure/ai/types';
import type { UsageLogRepository } from '@/infrastructure/db';

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
    tierContext?: UserTierContext;
}

export interface RequestChatCompletionDependencies {
    tokenStore?: ChatTokenStore;
    callGemini?: (options: CallGeminiWithKeyFallbackOptions) => Promise<string>;
    usageLogs?: UsageLogRepository;
    tierConfig?: TierConfig;
    getCurrentDate?: () => Date;
}

/** Error code returned by the chat completion use-case. */
export type ChatErrorCode =
    | 'token_exhausted'
    | 'model_not_allowed'
    | 'rate_limited'
    | 'server_error'
    | 'server_busy';

/** Result returned by the chat completion use-case. */
export type ChatActionResult =
    | { ok: true; message: string; remainingTokens: number }
    | { ok: false; error: ChatErrorCode };

export type RequestChatCompletionResult = ChatActionResult;
