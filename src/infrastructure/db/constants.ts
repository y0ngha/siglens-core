/** All valid user subscription tier values, in ascending order. */
export const USER_TIER_VALUES = ['free', 'member', 'pro'] as const;

/** All valid usage action type values tracked in usage logs. */
export const USAGE_ACTION_TYPE_VALUES = ['analysis', 'chatbot'] as const;

/** All supported OAuth provider identifiers. */
export const OAUTH_PROVIDER_VALUES = ['google', 'kakao', 'apple'] as const;
