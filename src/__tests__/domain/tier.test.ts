import { describe, expect, it } from 'vitest';
import { MODEL_SPECS } from '@/domain/analysis/modelSpecs';
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

// 전체 모델 로스터를 여기에 하드코딩하지 않는다 — 명시적 로스터 트립와이어는
// modelSpecs.test.ts('covers every active model identifier exactly once')가 소유하고,
// 이 파일은 그 로스터를 MODEL_SPECS에서 도출해 tier 배치만 검증한다.
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
        // 두 가지를 한 번에 고정한다.
        // (1) restrictions가 꺼져 있으면 tier와 무관하게 전체 목록을 정렬해 돌려준다.
        // (2) 그 전체 목록 = MODEL_SPECS의 모든 ActiveModelId. MODEL_SPECS는
        //     `satisfies Record<ActiveModelId, ModelSpec>`로 컴파일러가 누락을 잡지만
        //     tier 목록은 평범한 리터럴 배열이라, 모델을 추가하면서 tier.ts만 빠뜨려도
        //     타입 체크는 통과한다 — 그 모델은 어떤 등급에서도 선택 불가능한 유령이 된다.
        // 로스터를 여기에 다시 하드코딩하지 않고 MODEL_SPECS에서 도출하는 이유는,
        // 명시적 로스터 트립와이어를 modelSpecs.test.ts가 이미 소유하고 있어서다.
        it('returns every model in MODEL_SPECS when restrictions are disabled', () => {
            expect(getAllowedModels('free')).toEqual(
                Object.keys(MODEL_SPECS).toSorted()
            );
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

        it('grants skill-detection output to free tier so its sampled skills stay visible', () => {
            // Free runs analysis with <=3 skills per group (createSkillSamplingPlan)
            // and now sees that limited detection output, while the deeper
            // full_detail fragments remain member-only.
            expect(isInfoDepthAllowed('free', 'skill_detection')).toBe(true);
            expect(isInfoDepthAllowed('free', 'full_detail')).toBe(false);
        });

        it('allows every report detail for member and pro tiers', () => {
            expect(isInfoDepthAllowed('member', 'skill_detection')).toBe(true);
            expect(isInfoDepthAllowed('member', 'full_detail')).toBe(true);
            expect(isInfoDepthAllowed('pro', 'skill_detection')).toBe(true);
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

        // isPremiumModel/requiresByokKey는 free 목록 밖이기만 하면 통과하므로
        // member/pro 배치 자체는 검증하지 못한다. 아래 두 테스트가 배치를 고정한다 —
        // claude-opus-5를 MEMBER_MODELS로 옮기면 반드시 실패해야 한다.
        it('places the 2026-07 member-tier models in member but not free', () => {
            for (const model of [
                'claude-sonnet-5',
                'gpt-5.6-terra',
                'gemini-3.6-flash',
                'gemini-3.5-flash-lite',
            ] as const) {
                expect(
                    isModelAllowed('member', model, restrictedConfig),
                    model
                ).toBe(true);
                expect(
                    isModelAllowed('free', model, restrictedConfig),
                    model
                ).toBe(false);
            }
        });

        it('places the 2026-07 flagships in pro only', () => {
            for (const model of ['claude-opus-5', 'gpt-5.6-sol'] as const) {
                expect(
                    isModelAllowed('pro', model, restrictedConfig),
                    model
                ).toBe(true);
                expect(
                    isModelAllowed('member', model, restrictedConfig),
                    model
                ).toBe(false);
                expect(
                    isModelAllowed('free', model, restrictedConfig),
                    model
                ).toBe(false);
            }
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
            expect(isPremiumModel('gemini-3.5-flash-lite')).toBe(true);
            expect(isPremiumModel('gemini-3.6-flash')).toBe(true);
            expect(isPremiumModel('claude-sonnet-4-6')).toBe(true);
            expect(isPremiumModel('claude-sonnet-5')).toBe(true);
            expect(isPremiumModel('gpt-5.4')).toBe(true);
            expect(isPremiumModel('gpt-5.6-terra')).toBe(true);
        });

        it('returns true for pro-only models', () => {
            expect(isPremiumModel('gemini-3.1-pro-preview')).toBe(true);
            expect(isPremiumModel('claude-opus-4-7')).toBe(true);
            expect(isPremiumModel('claude-opus-5')).toBe(true);
            expect(isPremiumModel('gpt-5.5')).toBe(true);
            expect(isPremiumModel('gpt-5.6-sol')).toBe(true);
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

        it('gates the 2026-07 model generation behind BYOK for non-pro tiers', () => {
            const latest: readonly ModelId[] = [
                'claude-opus-5',
                'claude-sonnet-5',
                'gpt-5.6-sol',
                'gpt-5.6-terra',
                'gemini-3.6-flash',
                'gemini-3.5-flash-lite',
            ];
            for (const model of latest) {
                expect(requiresByokKey('free', model), model).toBe(true);
                expect(requiresByokKey('member', model), model).toBe(true);
                expect(requiresByokKey('pro', model), model).toBe(false);
            }
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
