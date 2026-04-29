import { getTierLimit, TIER_CONFIG } from '@/domain/tier';
import type {
    ChatUsageLimitError,
    SubmitAnalysisError,
    TierLimitedFeature,
} from '@/domain/types';
import type {
    UsageLimitDependencies,
    UsageLimitError,
    UsageLimitErrorTemplate,
    UsageLimitInput,
} from './types';

const FEATURE_COUNT_KEY: Record<TierLimitedFeature, 'analysis' | 'chatbot'> = {
    analysisPerDay: 'analysis',
    chatbotPerDay: 'chatbot',
};

const USAGE_LIMIT_ERROR: UsageLimitErrorTemplate = {
    analysisPerDay: {
        code: 'analysis_limit_exceeded',
        message: 'Daily analysis usage limit exceeded.',
        feature: 'analysisPerDay',
    },
    chatbotPerDay: {
        code: 'chatbot_limit_exceeded',
        message: 'Daily chatbot usage limit exceeded.',
        feature: 'chatbotPerDay',
    },
};

async function checkUsageLimit(
    feature: TierLimitedFeature,
    input: UsageLimitInput,
    dependencies: UsageLimitDependencies
): Promise<boolean> {
    const config = input.config ?? TIER_CONFIG;
    if (!config.featureFlags.enableTierRestrictions) {
        return true;
    }

    const limit = getTierLimit(input.tier, feature, config);
    const counts = await dependencies.usage.getUsageToday(
        input.ipHash,
        input.now
    );
    const countKey = FEATURE_COUNT_KEY[feature];

    return counts[countKey] < limit;
}

/**
 * Check whether an IP/tier pair may submit another analysis request today.
 *
 * @param input - Hashed IP, tier, optional clock, and config override.
 * @param dependencies - Repository that reads today's usage count.
 * @returns `true` if the request is allowed; `false` if the daily limit is reached.
 */
export async function checkAnalysisLimit(
    input: UsageLimitInput,
    dependencies: UsageLimitDependencies
): Promise<boolean> {
    return checkUsageLimit('analysisPerDay', input, dependencies);
}

/**
 * Check whether an IP/tier pair may send another chatbot request today.
 *
 * @param input - Hashed IP, tier, optional clock, and config override.
 * @param dependencies - Repository that reads today's usage count.
 * @returns `true` if the request is allowed; `false` if the daily limit is reached.
 */
export async function checkChatbotLimit(
    input: UsageLimitInput,
    dependencies: UsageLimitDependencies
): Promise<boolean> {
    return checkUsageLimit('chatbotPerDay', input, dependencies);
}

/** @internal Build a structured error for a blocked daily usage-limited feature. */
export function buildUsageLimitError(
    feature: 'analysisPerDay',
    tier: UsageLimitInput['tier']
): SubmitAnalysisError;
export function buildUsageLimitError(
    feature: 'chatbotPerDay',
    tier: UsageLimitInput['tier']
): ChatUsageLimitError;
export function buildUsageLimitError(
    feature: TierLimitedFeature,
    tier: UsageLimitInput['tier']
): UsageLimitError {
    return feature === 'analysisPerDay'
        ? { ...USAGE_LIMIT_ERROR.analysisPerDay, tier }
        : { ...USAGE_LIMIT_ERROR.chatbotPerDay, tier };
}
