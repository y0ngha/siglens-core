/** All supported LLM provider identifiers for stored user API keys. */
export const LLM_PROVIDER_VALUES = ['anthropic', 'google', 'openai'] as const;

/** Identifier of an LLM provider whose API key may be stored per user. */
export type LlmProvider = (typeof LLM_PROVIDER_VALUES)[number];
