import { TIER_VALUES } from '@/domain/tier';

/**
 * Database enum values for the user `tier` column.
 *
 * Re-exported from {@link TIER_VALUES} (`domain/tier.ts`) to enforce a single
 * source of truth across the domain and database layers.
 */
export const USER_TIER_VALUES = TIER_VALUES;

/** All valid usage action type values tracked in usage logs. */
export const USAGE_ACTION_TYPE_VALUES = [
    'analysis',
    'chatbot',
    'premium_model',
] as const;

/** All supported OAuth provider identifiers. */
export const OAUTH_PROVIDER_VALUES = ['google', 'kakao', 'apple'] as const;
