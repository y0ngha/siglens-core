import type { LlmProvider } from '@/domain/types';

/** All valid {@link LlmProvider} values. Useful for runtime membership checks. */
export const LLM_PROVIDER_VALUES = Object.keys({
    anthropic: true,
    google: true,
    openai: true,
} satisfies Record<LlmProvider, true>) as LlmProvider[];
