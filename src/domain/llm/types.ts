import type { LlmProvider } from '@/domain/types';

/** All valid {@link LlmProvider} values. Useful for runtime membership checks. */
export const LLM_PROVIDER_VALUES: readonly LlmProvider[] = [
    'anthropic',
    'google',
    'openai',
] as const;
