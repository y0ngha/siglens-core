import type {
    Tier,
    TierConfig,
    TierInfoDepth,
    TierLimitedFeature,
    TierModel,
    Timeframe,
} from '@/domain/types';

const TIER_VALUES: readonly Tier[] = ['free', 'member', 'pro'];
const FREE_TIMEFRAMES: readonly Timeframe[] = ['1Day'];
const MEMBER_TIMEFRAMES: readonly Timeframe[] = ['1Hour', '4Hour', '1Day'];
const PRO_TIMEFRAMES: readonly Timeframe[] = [
    '5Min',
    '15Min',
    '30Min',
    '1Hour',
    '4Hour',
    '1Day',
];
const FREE_INFO_DEPTH: readonly TierInfoDepth[] = ['direction', 'summary'];
const MEMBER_INFO_DEPTH: readonly TierInfoDepth[] = [
    'direction',
    'summary',
    'partial_detail',
];
const PRO_INFO_DEPTH: readonly TierInfoDepth[] = [
    'direction',
    'summary',
    'full_detail',
    'entry',
    'stoploss',
    'target',
    'confidence',
];
const FREE_MODELS: readonly TierModel[] = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
];
const MEMBER_MODELS: readonly TierModel[] = [
    'gemini-2.5-pro',
    'claude-sonnet-4',
];
const PRO_MODELS: readonly TierModel[] = [
    'gemini-2.5-pro',
    'claude-sonnet-4',
    'claude-opus-4',
];

/** Default tier assigned to unauthenticated or newly-created users. */
export const DEFAULT_TIER: Tier = 'free';

/** Central source of truth for tier limits and gated capabilities. */
export const TIER_CONFIG = {
    limits: {
        analysisPerDay: { free: Infinity, member: Infinity, pro: Infinity },
        chatbotPerDay: { free: Infinity, member: Infinity, pro: Infinity },
    },
    timeframes: {
        free: FREE_TIMEFRAMES,
        member: MEMBER_TIMEFRAMES,
        pro: PRO_TIMEFRAMES,
    },
    infoDepth: {
        free: FREE_INFO_DEPTH,
        member: MEMBER_INFO_DEPTH,
        pro: PRO_INFO_DEPTH,
    },
    models: {
        free: FREE_MODELS,
        member: MEMBER_MODELS,
        pro: PRO_MODELS,
    },
    featureFlags: {
        enableTierRestrictions: false,
    },
} as const satisfies TierConfig;

/** Return whether a daily usage-limited feature is enabled for the tier. */
export function isAllowed(
    tier: Tier,
    feature: TierLimitedFeature,
    config: TierConfig = TIER_CONFIG
): boolean {
    return config.featureFlags.enableTierRestrictions
        ? config.limits[feature][tier] > 0
        : true;
}

/** Return the configured daily limit for a tiered feature. */
export function getTierLimit(
    tier: Tier,
    feature: TierLimitedFeature,
    config: TierConfig = TIER_CONFIG
): number {
    return config.limits[feature][tier];
}

/** Return whether a timeframe is available to the tier. */
export function isTimeframeAllowed(
    tier: Tier,
    timeframe: Timeframe,
    config: TierConfig = TIER_CONFIG
): boolean {
    return config.featureFlags.enableTierRestrictions
        ? config.timeframes[tier].includes(timeframe)
        : true;
}

/** Return whether an AI detail fragment is available to the tier. */
export function isInfoDepthAllowed(
    tier: Tier,
    infoDepth: TierInfoDepth,
    config: TierConfig = TIER_CONFIG
): boolean {
    return config.featureFlags.enableTierRestrictions
        ? config.infoDepth[tier].includes(infoDepth)
        : true;
}

/** Return whether an AI model is available to the tier. */
export function isModelAllowed(
    tier: Tier,
    model: TierModel,
    config: TierConfig = TIER_CONFIG
): boolean {
    return config.featureFlags.enableTierRestrictions
        ? config.models[tier].includes(model)
        : true;
}

/** Runtime guard for values loaded from external systems. */
export function isTier(value: string): value is Tier {
    return TIER_VALUES.some(tier => tier === value);
}
