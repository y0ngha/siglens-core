import { TIER_CONFIG } from '@/domain/tier';
import type { TierConfig } from '@/domain/types';

/**
 * @internal
 *
 * Test fixture for BYOK + tier-forwarding tests across all 4 analysis modules.
 * Decouples tests from production TIER_CONFIG model lists so model
 * additions/removals don't break BYOK assertion semantics.
 */
export const TEST_TIER_CONFIG: TierConfig = {
    ...TIER_CONFIG,
    models: {
        free: ['gemini-2.5-flash'],
        member: ['gemini-2.5-flash', 'gemini-2.5-pro'],
        pro: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    },
    featureFlags: { enableTierRestrictions: false },
};
