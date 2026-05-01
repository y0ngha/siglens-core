import { describe, expect, it } from 'vitest';
import { TIMEFRAMES } from '@/domain/constants/market';
import {
    DEFAULT_TIER,
    TIER_CONFIG,
    getAllowedModels,
    getAllowedTimeframes,
    getTierLimit,
    isAllowed,
    isInfoDepthAllowed,
    isModelAllowed,
    isTier,
    isTimeframeAllowed,
} from '@/domain/tier';
import type { ModelId, TierConfig } from '@/domain/types';

const ALL_CONFIGURED_MODELS: readonly ModelId[] = [
    'claude-haiku-3-5',
    'claude-opus-4-7',
    'claude-sonnet-4-6',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',
    'gemini-3-flash-preview',
    'gemini-3.1-pro-preview',
    'gpt-5-mini',
    'gpt-5.4',
    'gpt-5.5',
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

    describe('getAllowedTimeframes', () => {
        it('returns every timeframe when restrictions are disabled', () => {
            const config: TierConfig = {
                ...restrictedConfig,
                featureFlags: { enableTierRestrictions: false },
            };

            expect(getAllowedTimeframes('free', config)).toEqual([
                ...TIMEFRAMES,
            ]);
        });

        it('returns the configured timeframe list when restrictions are enabled', () => {
            expect(getAllowedTimeframes('member', restrictedConfig)).toEqual([
                ...restrictedConfig.timeframes.member,
            ]);
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
            expect(isModelAllowed('free', 'claude-opus-4-7')).toBe(true);
        });

        it('checks models when restrictions are enabled', () => {
            expect(
                isModelAllowed('member', 'claude-sonnet-4-6', restrictedConfig)
            ).toBe(true);
            expect(
                isModelAllowed('member', 'claude-opus-4-7', restrictedConfig)
            ).toBe(false);
        });

        it('allows new free-tier models (claude-haiku-3-5, gpt-5-mini)', () => {
            expect(
                isModelAllowed('free', 'claude-haiku-3-5', restrictedConfig)
            ).toBe(true);
            expect(isModelAllowed('free', 'gpt-5-mini', restrictedConfig)).toBe(
                true
            );
        });

        it('allows new member-tier models (gpt-5.4, gemini-3-flash-preview) and restricts them from free tier', () => {
            expect(isModelAllowed('member', 'gpt-5.4', restrictedConfig)).toBe(
                true
            );
            expect(
                isModelAllowed(
                    'member',
                    'gemini-3-flash-preview',
                    restrictedConfig
                )
            ).toBe(true);
            expect(isModelAllowed('free', 'gpt-5.4', restrictedConfig)).toBe(
                false
            );
            expect(
                isModelAllowed(
                    'free',
                    'gemini-3-flash-preview',
                    restrictedConfig
                )
            ).toBe(false);
        });

        it('restricts pro-only models (gpt-5.5, gemini-3.1-pro-preview) from member and free tiers', () => {
            expect(isModelAllowed('pro', 'gpt-5.5', restrictedConfig)).toBe(
                true
            );
            expect(
                isModelAllowed(
                    'pro',
                    'gemini-3.1-pro-preview',
                    restrictedConfig
                )
            ).toBe(true);
            expect(isModelAllowed('member', 'gpt-5.5', restrictedConfig)).toBe(
                false
            );
            expect(
                isModelAllowed(
                    'member',
                    'gemini-3.1-pro-preview',
                    restrictedConfig
                )
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
