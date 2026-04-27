import type {
    AnalysisResponse,
    ChatActionResult,
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

export type RequestChatCompletionResult = ChatActionResult;
