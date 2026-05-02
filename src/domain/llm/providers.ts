import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
import type { AIProvider, ActiveModelId, LlmProvider, ModelId } from '@/domain/types';

const AI_PROVIDER_TO_LLM_PROVIDER: Record<AIProvider, LlmProvider> = {
    claude: 'anthropic',
    gemini: 'google',
    chatgpt: 'openai',
};

/**
 * Resolve the LLM key-storage provider for any model identifier.
 *
 * @param modelId - Any {@link ModelId}, including deprecated aliases.
 * @returns The {@link LlmProvider} that hosts the given model
 *   (`'anthropic'`, `'google'`, or `'openai'`).
 */
export function getProviderForModel(modelId: ModelId): LlmProvider {
    if (modelId in MODEL_SPECS) {
        // Safe cast — verified by `modelId in MODEL_SPECS` above.
        const provider = MODEL_SPECS[modelId as ActiveModelId].provider;
        return AI_PROVIDER_TO_LLM_PROVIDER[provider];
    }
    // Deprecated model identifiers not present in MODEL_SPECS — infer from prefix.
    if (modelId.startsWith('claude-')) {
        return 'anthropic';
    }
    if (modelId.startsWith('gemini-')) {
        return 'google';
    }
    return 'openai';
}
