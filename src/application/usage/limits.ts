import { getTierLimit, TIER_CONFIG } from '@/domain/tier';
import type { TierLimitedFeature } from '@/domain/types';
import type {
    AnalysisUsageLimitError,
    ChatbotUsageLimitError,
    UsageLimitDependencies,
    UsageLimitError,
    UsageLimitInput,
} from './types';

const FEATURE_COUNT_KEY: Record<TierLimitedFeature, 'analysis' | 'chatbot'> = {
    analysisPerDay: 'analysis',
    chatbotPerDay: 'chatbot',
};

interface UsageLimitErrorTemplate {
    analysisPerDay: Omit<AnalysisUsageLimitError, 'tier'>;
    chatbotPerDay: Omit<ChatbotUsageLimitError, 'tier'>;
}

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

/** Check whether an IP/tier pair may submit another analysis request today. */
export async function checkAnalysisLimit(
    input: UsageLimitInput,
    dependencies: UsageLimitDependencies
): Promise<boolean> {
    return checkUsageLimit('analysisPerDay', input, dependencies);
}

/** Check whether an IP/tier pair may send another chatbot request today. */
export async function checkChatbotLimit(
    input: UsageLimitInput,
    dependencies: UsageLimitDependencies
): Promise<boolean> {
    return checkUsageLimit('chatbotPerDay', input, dependencies);
}

/** Build a structured error for a blocked daily usage-limited feature. */
export function buildUsageLimitError(
    feature: 'analysisPerDay',
    tier: UsageLimitInput['tier']
): AnalysisUsageLimitError;
export function buildUsageLimitError(
    feature: 'chatbotPerDay',
    tier: UsageLimitInput['tier']
): ChatbotUsageLimitError;
export function buildUsageLimitError(
    feature: TierLimitedFeature,
    tier: UsageLimitInput['tier']
): UsageLimitError {
    return feature === 'analysisPerDay'
        ? { ...USAGE_LIMIT_ERROR.analysisPerDay, tier }
        : { ...USAGE_LIMIT_ERROR.chatbotPerDay, tier };
}
