import type {
    Tier,
    TierConfig,
    TierInfoDepth,
    TierLimitedFeature,
    TierModel,
    Timeframe,
} from '@/domain/types';

/** @internal All supported subscription tiers, ordered free -> member -> pro. */
export const TIER_VALUES = [
    'free',
    'member',
    'pro',
] as const satisfies readonly Tier[];

const FREE_TIMEFRAMES: readonly Timeframe[] = ['1Day'];
const MEMBER_TIMEFRAMES: readonly Timeframe[] = [
    ...FREE_TIMEFRAMES,
    '1Hour',
    '4Hour',
];
const PRO_TIMEFRAMES: readonly Timeframe[] = [
    ...MEMBER_TIMEFRAMES,
    '5Min',
    '15Min',
    '30Min',
];
const FREE_INFO_DEPTH: readonly TierInfoDepth[] = ['direction', 'summary'];
const MEMBER_INFO_DEPTH: readonly TierInfoDepth[] = [
    ...FREE_INFO_DEPTH,
    'partial_detail',
];
const PRO_INFO_DEPTH: readonly TierInfoDepth[] = [
    ...MEMBER_INFO_DEPTH,
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
    ...FREE_MODELS,
    'gemini-2.5-pro',
    'claude-sonnet-4',
];
const PRO_MODELS: readonly TierModel[] = [...MEMBER_MODELS, 'claude-opus-4'];

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

/**
 * Return whether a daily usage-limited feature is enabled for the tier.
 *
 * Always returns `true` when `config.featureFlags.enableTierRestrictions` is `false`.
 *
 * @param tier - The user's subscription tier.
 * @param feature - The daily-limited feature to check.
 * @param config - Tier configuration; defaults to {@link TIER_CONFIG}.
 * @returns `true` if the feature is permitted for the tier, `false` otherwise.
 */
export function isAllowed(
    tier: Tier,
    feature: TierLimitedFeature,
    config: TierConfig = TIER_CONFIG
): boolean {
    return config.featureFlags.enableTierRestrictions
        ? config.limits[feature][tier] > 0
        : true;
}

/**
 * Return the configured daily limit for a tiered feature.
 *
 * @param tier - The user's subscription tier.
 * @param feature - The daily-limited feature to read the limit for.
 * @param config - Tier configuration; defaults to {@link TIER_CONFIG}.
 * @returns The configured daily limit; `Infinity` when uncapped.
 */
export function getTierLimit(
    tier: Tier,
    feature: TierLimitedFeature,
    config: TierConfig = TIER_CONFIG
): number {
    return config.limits[feature][tier];
}

/**
 * Return whether a timeframe is available to the tier.
 *
 * Always returns `true` when `config.featureFlags.enableTierRestrictions` is `false`.
 *
 * @param tier - The user's subscription tier.
 * @param timeframe - The timeframe to check.
 * @param config - Tier configuration; defaults to {@link TIER_CONFIG}.
 * @returns `true` if the timeframe is permitted for the tier, `false` otherwise.
 */
export function isTimeframeAllowed(
    tier: Tier,
    timeframe: Timeframe,
    config: TierConfig = TIER_CONFIG
): boolean {
    return config.featureFlags.enableTierRestrictions
        ? config.timeframes[tier].includes(timeframe)
        : true;
}

/**
 * Return whether an AI detail fragment is available to the tier.
 *
 * Always returns `true` when `config.featureFlags.enableTierRestrictions` is `false`.
 *
 * @param tier - The user's subscription tier.
 * @param infoDepth - The detail fragment to check.
 * @param config - Tier configuration; defaults to {@link TIER_CONFIG}.
 * @returns `true` if the detail fragment is permitted for the tier, `false` otherwise.
 */
export function isInfoDepthAllowed(
    tier: Tier,
    infoDepth: TierInfoDepth,
    config: TierConfig = TIER_CONFIG
): boolean {
    return config.featureFlags.enableTierRestrictions
        ? config.infoDepth[tier].includes(infoDepth)
        : true;
}

/**
 * Return whether an AI model is available to the tier.
 *
 * Always returns `true` when `config.featureFlags.enableTierRestrictions` is `false`.
 *
 * @param tier - The user's subscription tier.
 * @param model - The AI model identifier to check.
 * @param config - Tier configuration; defaults to {@link TIER_CONFIG}.
 * @returns `true` if the model is permitted for the tier, `false` otherwise.
 */
export function isModelAllowed(
    tier: Tier,
    model: TierModel,
    config: TierConfig = TIER_CONFIG
): boolean {
    return config.featureFlags.enableTierRestrictions
        ? config.models[tier].includes(model)
        : true;
}

/**
 * Runtime guard for tier values loaded from external systems.
 *
 * @param value - Arbitrary string value to validate.
 * @returns `true` if `value` is a known {@link Tier}, narrowing the type.
 */
export function isTier(value: string): value is Tier {
    return TIER_VALUES.some(tier => tier === value);
}
