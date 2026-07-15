import { describe, expect, it } from 'vitest';
import { TIMEFRAMES } from '@/domain/constants/market';
import {
    DEFAULT_TIER,
    TIER_CONFIG,
    getAllowedModels,
    getAllowedTimeframes,
    getTierLimit,
    isAllowed,
    isFreeModel,
    isInfoDepthAllowed,
    isModelAllowed,
    isPremiumModel,
    isTier,
    isTimeframeAllowed,
    requiresByokKey,
} from '@/domain/tier';
import type { ModelId, TierConfig } from '@/domain/types';

const ALL_CONFIGURED_MODELS: readonly ModelId[] = [
    'claude-haiku-4-5',
    'claude-opus-4-7',
    'claude-sonnet-4-6',
    'deepseek-v4-flash',
    'deepseek-v4-pro',
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
        enableTimeframeRestrictions: true,
        enableInfoDepthRestrictions: true,
    },
};

describe('tier', () => {
    it('defines fully-open default tier configuration', () => {
        expect(DEFAULT_TIER).toBe('free');
        expect(TIER_CONFIG.limits.analysisPerDay.free).toBe(Infinity);
        expect(TIER_CONFIG.limits.chatbotPerDay.pro).toBe(Infinity);
        expect(TIER_CONFIG.featureFlags.enableTierRestrictions).toBe(false);
        expect(TIER_CONFIG.featureFlags.enableTimeframeRestrictions).toBe(true);
        expect(TIER_CONFIG.featureFlags.enableInfoDepthRestrictions).toBe(true);
    });

    describe('isAllowed', () => {
        it('allows usage-limited features when restrictions are disabled', () => {
            const config: TierConfig = {
                ...restrictedConfig,
                featureFlags: {
                    ...restrictedConfig.featureFlags,
                    enableTierRestrictions: false,
                },
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
        it('limits free tier to the daily timeframe', () => {
            expect(getAllowedTimeframes('free')).toEqual(['1Day']);
        });

        it('returns every timeframe for member and pro tiers', () => {
            expect(getAllowedTimeframes('member')).toEqual([...TIMEFRAMES]);
            expect(getAllowedTimeframes('pro')).toEqual([...TIMEFRAMES]);
        });

        it('returns every timeframe when timeframe restrictions are disabled', () => {
            const config: TierConfig = {
                ...restrictedConfig,
                featureFlags: {
                    ...restrictedConfig.featureFlags,
                    enableTimeframeRestrictions: false,
                },
            };

            expect(getAllowedTimeframes('free', config)).toEqual([
                ...TIMEFRAMES,
            ]);
        });

        it('returns the configured timeframe list when timeframe restrictions are enabled', () => {
            expect(getAllowedTimeframes('member', restrictedConfig)).toEqual([
                ...restrictedConfig.timeframes.member,
            ]);
        });

        it('falls back to enabled legacy tier restrictions when the timeframe flag is omitted', () => {
            const config: TierConfig = {
                ...restrictedConfig,
                featureFlags: { enableTierRestrictions: true },
            };

            expect(getAllowedTimeframes('free', config)).toEqual(['1Day']);
        });

        it('falls back to disabled legacy tier restrictions when the timeframe flag is omitted', () => {
            const config: TierConfig = {
                ...restrictedConfig,
                featureFlags: { enableTierRestrictions: false },
            };

            expect(getAllowedTimeframes('free', config)).toEqual([
                ...TIMEFRAMES,
            ]);
        });
    });

    describe('getAllowedModels', () => {
        it('returns every configured model when restrictions are disabled', () => {
            expect(getAllowedModels('free')).toEqual(ALL_CONFIGURED_MODELS);
        });

        it('returns tier-specific models in sorted order when restrictions are enabled', () => {
            expect(getAllowedModels('member', restrictedConfig)).toEqual(
                [...restrictedConfig.models.member].toSorted()
            );
        });
    });
    describe('isTimeframeAllowed', () => {
        it('limits free tier to the daily timeframe', () => {
            expect(isTimeframeAllowed('free', '1Day')).toBe(true);
            expect(isTimeframeAllowed('free', '1Hour')).toBe(false);
            expect(isTimeframeAllowed('free', '5Min')).toBe(false);
        });

        it('allows all timeframes for member and pro tiers', () => {
            expect(isTimeframeAllowed('member', '5Min')).toBe(true);
            expect(isTimeframeAllowed('pro', '5Min')).toBe(true);
        });
    });

    describe('isInfoDepthAllowed', () => {
        it('limits report details for free tier', () => {
            expect(isInfoDepthAllowed('free', 'direction')).toBe(true);
            expect(isInfoDepthAllowed('free', 'summary')).toBe(true);
            expect(isInfoDepthAllowed('free', 'partial_detail')).toBe(false);
            expect(isInfoDepthAllowed('free', 'full_detail')).toBe(false);
        });

        it('allows every report detail for member and pro tiers', () => {
            expect(isInfoDepthAllowed('member', 'full_detail')).toBe(true);
            expect(isInfoDepthAllowed('pro', 'entry')).toBe(true);
        });

        it('allows every detail when information-depth restrictions are disabled', () => {
            const config: TierConfig = {
                ...restrictedConfig,
                featureFlags: {
                    ...restrictedConfig.featureFlags,
                    enableInfoDepthRestrictions: false,
                },
            };

            expect(isInfoDepthAllowed('free', 'full_detail', config)).toBe(
                true
            );
        });

        it('falls back to enabled legacy tier restrictions when the information-depth flag is omitted', () => {
            const config: TierConfig = {
                ...restrictedConfig,
                featureFlags: { enableTierRestrictions: true },
            };

            expect(isInfoDepthAllowed('free', 'full_detail', config)).toBe(
                false
            );
        });

        it('falls back to disabled legacy tier restrictions when the information-depth flag is omitted', () => {
            const config: TierConfig = {
                ...restrictedConfig,
                featureFlags: { enableTierRestrictions: false },
            };

            expect(isInfoDepthAllowed('free', 'full_detail', config)).toBe(
                true
            );
        });
    });

    describe('isModelAllowed', () => {
        it('allows all models when restrictions are disabled', () => {
            expect(isModelAllowed('free', 'claude-opus-4-7')).toBe(true);
        });

        it('ignores granular timeframe and information-depth restrictions', () => {
            const config: TierConfig = {
                ...TIER_CONFIG,
                featureFlags: {
                    ...TIER_CONFIG.featureFlags,
                    enableTierRestrictions: false,
                },
            };

            expect(isModelAllowed('free', 'claude-opus-4-7', config)).toBe(
                true
            );
        });

        it('checks models when restrictions are enabled', () => {
            expect(
                isModelAllowed('member', 'claude-sonnet-4-6', restrictedConfig)
            ).toBe(true);
            expect(
                isModelAllowed('member', 'claude-opus-4-7', restrictedConfig)
            ).toBe(false);
        });

        it('allows free-tier models (claude-haiku-4-5, gpt-5-mini)', () => {
            expect(
                isModelAllowed('free', 'claude-haiku-4-5', restrictedConfig)
            ).toBe(true);
            expect(isModelAllowed('free', 'gpt-5-mini', restrictedConfig)).toBe(
                true
            );
        });

        it('allows free-tier DeepSeek models (deepseek-v4-flash, deepseek-v4-pro)', () => {
            expect(
                isModelAllowed('free', 'deepseek-v4-flash', restrictedConfig)
            ).toBe(true);
            expect(
                isModelAllowed('free', 'deepseek-v4-pro', restrictedConfig)
            ).toBe(true);
        });

        it('allows gpt-5.4 and gemini-3-flash-preview for member tier', () => {
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
        });

        it('restricts gpt-5.4 and gemini-3-flash-preview from free tier', () => {
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

        it('allows gpt-5.5, gemini-3.1-pro-preview, claude-opus-4-7 for pro tier', () => {
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
            expect(
                isModelAllowed('pro', 'claude-opus-4-7', restrictedConfig)
            ).toBe(true);
        });

        it('restricts pro-only models from member tier', () => {
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
            expect(
                isModelAllowed('member', 'claude-opus-4-7', restrictedConfig)
            ).toBe(false);
        });

        it('restricts pro-only models from free tier', () => {
            expect(isModelAllowed('free', 'gpt-5.5', restrictedConfig)).toBe(
                false
            );
            expect(
                isModelAllowed(
                    'free',
                    'gemini-3.1-pro-preview',
                    restrictedConfig
                )
            ).toBe(false);
            expect(
                isModelAllowed('free', 'claude-opus-4-7', restrictedConfig)
            ).toBe(false);
        });

        it('restricts member-only models (claude-sonnet-4-6) from free tier', () => {
            expect(
                isModelAllowed('member', 'claude-sonnet-4-6', restrictedConfig)
            ).toBe(true);
            expect(
                isModelAllowed('free', 'claude-sonnet-4-6', restrictedConfig)
            ).toBe(false);
        });

        it('rejects deprecated model identifiers (claude-sonnet-4, claude-opus-4) for all tiers', () => {
            expect(
                isModelAllowed('free', 'claude-sonnet-4', restrictedConfig)
            ).toBe(false);
            expect(
                isModelAllowed('member', 'claude-sonnet-4', restrictedConfig)
            ).toBe(false);
            expect(
                isModelAllowed('pro', 'claude-sonnet-4', restrictedConfig)
            ).toBe(false);
            expect(
                isModelAllowed('free', 'claude-opus-4', restrictedConfig)
            ).toBe(false);
            expect(
                isModelAllowed('member', 'claude-opus-4', restrictedConfig)
            ).toBe(false);
            expect(
                isModelAllowed('pro', 'claude-opus-4', restrictedConfig)
            ).toBe(false);
        });

        it('rejects deprecated model identifiers even when restrictions are disabled', () => {
            expect(isModelAllowed('free', 'claude-sonnet-4')).toBe(false);
            expect(isModelAllowed('free', 'claude-opus-4')).toBe(false);
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

    describe('isPremiumModel', () => {
        it('returns false for free-tier models', () => {
            expect(isPremiumModel('gemini-2.5-flash')).toBe(false);
            expect(isPremiumModel('gemini-2.5-flash-lite')).toBe(false);
            expect(isPremiumModel('claude-haiku-4-5')).toBe(false);
            expect(isPremiumModel('gpt-5-mini')).toBe(false);
            expect(isPremiumModel('deepseek-v4-flash')).toBe(false);
            expect(isPremiumModel('deepseek-v4-pro')).toBe(false);
        });

        it('returns true for member-only models', () => {
            expect(isPremiumModel('gemini-2.5-pro')).toBe(true);
            expect(isPremiumModel('gemini-3-flash-preview')).toBe(true);
            expect(isPremiumModel('claude-sonnet-4-6')).toBe(true);
            expect(isPremiumModel('gpt-5.4')).toBe(true);
        });

        it('returns true for pro-only models', () => {
            expect(isPremiumModel('gemini-3.1-pro-preview')).toBe(true);
            expect(isPremiumModel('claude-opus-4-7')).toBe(true);
            expect(isPremiumModel('gpt-5.5')).toBe(true);
        });

        it('ignores enableTierRestrictions flag', () => {
            // Build a config that flips the restriction flag on. Result must be identical.
            const restricted: TierConfig = {
                ...TIER_CONFIG,
                featureFlags: {
                    ...TIER_CONFIG.featureFlags,
                    enableTierRestrictions: true,
                },
            };
            expect(isPremiumModel('gemini-2.5-flash', restricted)).toBe(false);
            expect(isPremiumModel('gemini-2.5-pro', restricted)).toBe(true);
        });
    });

    describe('isFreeModel', () => {
        it('returns true for free-tier models', () => {
            expect(isFreeModel('gemini-2.5-flash')).toBe(true);
            expect(isFreeModel('gemini-2.5-flash-lite')).toBe(true);
            expect(isFreeModel('claude-haiku-4-5')).toBe(true);
            expect(isFreeModel('gpt-5-mini')).toBe(true);
            expect(isFreeModel('deepseek-v4-flash')).toBe(true);
            expect(isFreeModel('deepseek-v4-pro')).toBe(true);
        });

        it('returns false for member-only models', () => {
            expect(isFreeModel('gemini-2.5-pro')).toBe(false);
            expect(isFreeModel('gemini-3-flash-preview')).toBe(false);
            expect(isFreeModel('claude-sonnet-4-6')).toBe(false);
            expect(isFreeModel('gpt-5.4')).toBe(false);
        });

        it('returns false for pro-only models', () => {
            expect(isFreeModel('gemini-3.1-pro-preview')).toBe(false);
            expect(isFreeModel('claude-opus-4-7')).toBe(false);
            expect(isFreeModel('gpt-5.5')).toBe(false);
        });

        it('is the inverse of isPremiumModel', () => {
            // Property-style check across all configured models
            const allModels = [
                ...TIER_CONFIG.models.free,
                ...TIER_CONFIG.models.member,
                ...TIER_CONFIG.models.pro,
            ];
            for (const m of allModels) {
                expect(isFreeModel(m)).toBe(!isPremiumModel(m));
            }
        });

        it('ignores enableTierRestrictions flag', () => {
            const restricted: TierConfig = {
                ...TIER_CONFIG,
                featureFlags: {
                    ...TIER_CONFIG.featureFlags,
                    enableTierRestrictions: true,
                },
            };
            expect(isFreeModel('gemini-2.5-flash', restricted)).toBe(true);
            expect(isFreeModel('gemini-2.5-pro', restricted)).toBe(false);
        });
    });

    describe('requiresByokKey', () => {
        it('returns false for pro tier on premium models', () => {
            expect(requiresByokKey('pro', 'gemini-2.5-pro')).toBe(false);
        });

        it('returns false for non-pro tier on free models', () => {
            expect(requiresByokKey('member', 'gemini-2.5-flash')).toBe(false);
            expect(requiresByokKey('free', 'gemini-2.5-flash')).toBe(false);
        });

        it('returns true for non-pro tier on premium models', () => {
            expect(requiresByokKey('member', 'gemini-2.5-pro')).toBe(true);
            expect(requiresByokKey('free', 'gemini-2.5-pro')).toBe(true);
        });

        it('respects custom config', () => {
            const restricted: TierConfig = {
                ...TIER_CONFIG,
                featureFlags: {
                    ...TIER_CONFIG.featureFlags,
                    enableTierRestrictions: true,
                },
            };
            expect(
                requiresByokKey('member', 'gemini-2.5-pro', restricted)
            ).toBe(true);
        });
    });
});
