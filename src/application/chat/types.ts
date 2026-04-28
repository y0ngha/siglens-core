import type {
    AnalysisResponse,
    ChatActionResult,
    ChatMessage,
    ChatModel,
    Tier,
    TierConfig,
    Timeframe,
} from '@/domain/types';
import type { ChatTokenStore } from '@/infrastructure/chat/types';
import type { CallGeminiWithKeyFallbackOptions } from '@/infrastructure/ai/types';
import type { UsageRepository } from '@/infrastructure/db';

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
}

export interface RequestChatCompletionDependencies {
    tokenStore?: ChatTokenStore;
    usageRepository?: UsageRepository;
    callGemini?: (options: CallGeminiWithKeyFallbackOptions) => Promise<string>;
}

export type RequestChatCompletionResult = ChatActionResult;
