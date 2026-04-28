import { describe, expect, it } from 'vitest';
import {
    DEFAULT_TIER,
    TIER_CONFIG,
    getAllowedModels,
    getTierLimit,
    isAllowed,
    isInfoDepthAllowed,
    isModelAllowed,
    isTier,
    isTimeframeAllowed,
} from '@/domain/tier';
import type { ModelId, TierConfig } from '@/domain/types';

const ALL_CONFIGURED_MODELS: readonly ModelId[] = [
    'claude-opus-4',
    'claude-sonnet-4',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',
];

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

describe('tier', () => {
    it('defines fully-open default tier configuration', () => {
        expect(DEFAULT_TIER).toBe('free');
        expect(TIER_CONFIG.limits.analysisPerDay.free).toBe(Infinity);
        expect(TIER_CONFIG.limits.chatbotPerDay.pro).toBe(Infinity);
        expect(TIER_CONFIG.featureFlags.enableTierRestrictions).toBe(false);
    });

    describe('isAllowed', () => {
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
            expect(
                isAllowed('member', 'analysisPerDay', restrictedConfig)
            ).toBe(true);
            expect(isAllowed('pro', 'chatbotPerDay', restrictedConfig)).toBe(
                true
            );
        });
    });

    describe('getTierLimit', () => {
        it('returns the configured daily tier limit', () => {
            expect(
                getTierLimit('member', 'analysisPerDay', restrictedConfig)
            ).toBe(3);
        });

        it('returns Infinity for uncapped tiers with default config', () => {
            expect(getTierLimit('free', 'analysisPerDay')).toBe(Infinity);
        });
    });

    describe('getAllowedModels', () => {
        it('returns every configured model when restrictions are disabled', () => {
            expect(getAllowedModels('free')).toEqual(ALL_CONFIGURED_MODELS);
        });

        it('returns tier-specific models when restrictions are enabled', () => {
            expect(getAllowedModels('member', restrictedConfig)).toEqual([
                ...restrictedConfig.models.member,
            ]);
        });
    });

    describe('isTimeframeAllowed', () => {
        it('allows all timeframes when restrictions are disabled', () => {
            expect(isTimeframeAllowed('free', '5Min')).toBe(true);
        });

        it('checks timeframes when restrictions are enabled', () => {
            expect(isTimeframeAllowed('free', '1Day', restrictedConfig)).toBe(
                true
            );
            expect(isTimeframeAllowed('free', '1Hour', restrictedConfig)).toBe(
                false
            );
        });
    });

    describe('isInfoDepthAllowed', () => {
        it('allows all info depth fragments when restrictions are disabled', () => {
            expect(isInfoDepthAllowed('free', 'full_detail')).toBe(true);
        });

        it('checks info depth fragments when restrictions are enabled', () => {
            expect(
                isInfoDepthAllowed('member', 'partial_detail', restrictedConfig)
            ).toBe(true);
            expect(
                isInfoDepthAllowed('member', 'entry', restrictedConfig)
            ).toBe(false);
        });
    });

    describe('isModelAllowed', () => {
        it('allows all models when restrictions are disabled', () => {
            expect(isModelAllowed('free', 'claude-opus-4')).toBe(true);
        });

        it('checks models when restrictions are enabled', () => {
            expect(
                isModelAllowed('member', 'claude-sonnet-4', restrictedConfig)
            ).toBe(true);
            expect(
                isModelAllowed('member', 'claude-opus-4', restrictedConfig)
            ).toBe(false);
        });
    });

    describe('isTier', () => {
        it('identifies valid tier literals', () => {
            expect(isTier('free')).toBe(true);
            expect(isTier('member')).toBe(true);
            expect(isTier('pro')).toBe(true);
            expect(isTier('enterprise')).toBe(false);
        });
    });
});
