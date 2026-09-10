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
    // 세 목록은 누적이다 — 어떤 등급에서 처음 등장하는지가 곧 접근 등급이다.
    // `gemini-3.1-pro-preview`가 pro에만 있으므로 byok 등급이 되고, 그래야
    // 비-pro 호출이 BYOK 게이트에 걸린다.
    models: {
        free: ['gemini-3.6-flash'],
        member: ['gemini-3.6-flash'],
        pro: ['gemini-3.6-flash', 'gemini-3.1-pro-preview'],
    },
    featureFlags: { enableTierRestrictions: false },
};
