import type { ChatUsageLimitError } from '@/application/usage/types';
import type { CallGeminiWithKeyFallbackOptions } from '@/infrastructure/ai/types';
import type { ChatTokenStore } from '@/infrastructure/chat/types';
import type { UsageLogRepository, UsageRepository } from '@/infrastructure/db';
import type {
    AnalysisResponse,
    ChatErrorCode,
    ChatMessage,
    ChatModel,
    Tier,
    TierConfig,
    Timeframe,
    UserTierContext,
} from '@/domain/types';

export interface RequestChatCompletionParams {
    symbol: string;
    timeframe: Timeframe;
    analysis: AnalysisResponse;
    history: ChatMessage[];
    userMessage: string;
    clientIp: string;
    tier?: Tier;
    userId?: string | null;
    model?: ChatModel;
    freeApiKey?: string;
    paidApiKey?: string;
    usageOccurredAt?: Date;
    tierConfig?: TierConfig;
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
    | { ok: false; error: ChatErrorCode | ChatUsageLimitError };

export type RequestChatCompletionResult = ChatActionResult;
