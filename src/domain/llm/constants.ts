import type { LlmProvider } from '@/domain/types';

/** All supported LLM provider identifiers for stored user API keys. */
export const LLM_PROVIDER_VALUES = [
    'anthropic',
    'google',
    'openai',
] as const satisfies readonly LlmProvider[];
