/** LLM API key provider identifier. Single source of truth for key storage routing. */
export type LlmProvider = 'anthropic' | 'google' | 'openai';

/** All valid {@link LlmProvider} values. Used for membership checks and Drizzle enum sync. */
export const LLM_PROVIDER_VALUES: readonly LlmProvider[] = [
    'anthropic',
    'google',
    'openai',
] as const;
