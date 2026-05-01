import { LLM_PROVIDER_VALUES as DOMAIN_LLM_PROVIDER_VALUES } from '@/domain/llm';
import { TIER_VALUES } from '@/domain/tier';
import type { OAuthProvider } from '@/domain/types';

/**
 * Database enum values for the user `tier` column.
 *
 * Re-exported from {@link TIER_VALUES} (`domain/tier.ts`) to enforce a single
 * source of truth across the domain and database layers.
 */
export const USER_TIER_VALUES = TIER_VALUES;

/**
 * Database enum values for the user API key `provider` column.
 *
 * Re-exported from `LLM_PROVIDER_VALUES` (`domain/llm/types.ts`) to enforce a
 * single source of truth across the domain and database layers.
 */
export const LLM_PROVIDER_VALUES = DOMAIN_LLM_PROVIDER_VALUES;

/** All valid usage action type values tracked in usage logs. */
export const USAGE_ACTION_TYPE_VALUES = [
    'analysis',
    'chatbot',
    'premium_model',
] as const;

/** All supported OAuth provider identifiers. */
export const OAUTH_PROVIDER_VALUES = [
    'google',
    'kakao',
    'apple',
] as const satisfies readonly OAuthProvider[];
