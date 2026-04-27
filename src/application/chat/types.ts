import type {
    AnalysisResponse,
    ChatActionResult,
    ChatMessage,
    ChatModel,
    Timeframe,
} from '@/domain/types';
import type { ChatTokenStore } from '@/infrastructure/chat/types';
import type { CallGeminiWithKeyFallbackOptions } from '@/infrastructure/ai/types';

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
}

export interface RequestChatCompletionDependencies {
    tokenStore?: ChatTokenStore;
    callGemini?: (options: CallGeminiWithKeyFallbackOptions) => Promise<string>;
}

export type RequestChatCompletionResult = ChatActionResult;
