import { describe, expect, it } from 'vitest';
import {
    DEFAULT_TIER,
    TIER_CONFIG,
    getTierLimit,
    isAllowed,
    isInfoDepthAllowed,
    isModelAllowed,
    isTier,
    isTimeframeAllowed,
} from '@/domain/tier';
import type { TierConfig } from '@/domain/types';

const restrictedConfig: TierConfig = {
    ...TIER_CONFIG,
    limits: {
        analysisPerDay: { free: 0, member: 3, pro: Infinity },
        chatbotPerDay: { free: 0, member: 0, pro: Infinity },
    },
    featureFlags: {
        enableTierRestrictions: true,
    },
};

describe('tier gating', () => {
    it('defines fully-open default tier configuration', () => {
        expect(DEFAULT_TIER).toBe('free');
        expect(TIER_CONFIG.limits.analysisPerDay.free).toBe(Infinity);
        expect(TIER_CONFIG.limits.chatbotPerDay.pro).toBe(Infinity);
        expect(TIER_CONFIG.featureFlags.enableTierRestrictions).toBe(false);
    });

    it('allows usage-limited features when restrictions are disabled', () => {
        const config: TierConfig = {
            ...restrictedConfig,
            featureFlags: { enableTierRestrictions: false },
        };

        expect(isAllowed('free', 'analysisPerDay', config)).toBe(true);
        expect(isAllowed('free', 'chatbotPerDay', config)).toBe(true);
    });

    it('checks feature limits when restrictions are enabled', () => {
        expect(isAllowed('free', 'analysisPerDay', restrictedConfig)).toBe(
            false
        );
        expect(isAllowed('member', 'analysisPerDay', restrictedConfig)).toBe(
            true
        );
        expect(isAllowed('pro', 'chatbotPerDay', restrictedConfig)).toBe(true);
    });

    it('returns the configured daily tier limit', () => {
        expect(getTierLimit('member', 'analysisPerDay', restrictedConfig)).toBe(
            3
        );
    });

    it('allows all timeframes, info depth, and models when restrictions are disabled', () => {
        expect(isTimeframeAllowed('free', '5Min')).toBe(true);
        expect(isInfoDepthAllowed('free', 'full_detail')).toBe(true);
        expect(isModelAllowed('free', 'claude-opus-4')).toBe(true);
    });

    it('checks timeframes, info depth, and models when restrictions are enabled', () => {
        expect(isTimeframeAllowed('free', '1Day', restrictedConfig)).toBe(true);
        expect(isTimeframeAllowed('free', '1Hour', restrictedConfig)).toBe(
            false
        );
        expect(
            isInfoDepthAllowed('member', 'partial_detail', restrictedConfig)
        ).toBe(true);
        expect(isInfoDepthAllowed('member', 'entry', restrictedConfig)).toBe(
            false
        );
        expect(
            isModelAllowed('member', 'claude-sonnet-4', restrictedConfig)
        ).toBe(true);
        expect(
            isModelAllowed('member', 'claude-opus-4', restrictedConfig)
        ).toBe(false);
    });

    it('identifies valid tier literals', () => {
        expect(isTier('free')).toBe(true);
        expect(isTier('enterprise')).toBe(false);
    });
});
