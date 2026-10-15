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
    getModelAccess,
    requiresAuth,
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
            expect(isModelAllowed('free', 'claude-opus-5')).toBe(true);
        });

        it('ignores granular timeframe and information-depth restrictions', () => {
            const config: TierConfig = {
                ...TIER_CONFIG,
                featureFlags: {
                    ...TIER_CONFIG.featureFlags,
                    enableTierRestrictions: false,
                },
            };

            expect(isModelAllowed('free', 'claude-opus-5', config)).toBe(true);
        });

        it('checks models when restrictions are enabled', () => {
            expect(
                isModelAllowed('member', 'claude-sonnet-5-5', restrictedConfig)
            ).toBe(true);
            expect(
                isModelAllowed('member', 'claude-opus-5', restrictedConfig)
            ).toBe(false);
        });

        it('allows free-tier models (claude-haiku-5-5, gpt-6-luna)', () => {
            expect(
                isModelAllowed('free', 'claude-haiku-5-5', restrictedConfig)
            ).toBe(true);
            expect(isModelAllowed('free', 'gpt-6-luna', restrictedConfig)).toBe(
                true
            );
        });

        it('allows the free DeepSeek line but not the pro one', () => {
            // v4-pro moved to member with the access restructure: it is a
            // thinking model and the server pays for it.
            expect(
                isModelAllowed('free', 'deepseek-v4.1-flash', restrictedConfig)
            ).toBe(true);
            expect(
                isModelAllowed('free', 'deepseek-v4.1-pro', restrictedConfig)
            ).toBe(false);
            expect(
                isModelAllowed('member', 'deepseek-v4.1-pro', restrictedConfig)
            ).toBe(true);
        });

        it('allows gpt-6-sol and gemini-3.8-flash for member tier', () => {
            expect(
                isModelAllowed('member', 'gpt-6-sol', restrictedConfig)
            ).toBe(true);
            expect(
                isModelAllowed('member', 'gemini-3.8-flash', restrictedConfig)
            ).toBe(true);
        });

        it('restricts gpt-6-sol and gemini-3.8-flash from free tier', () => {
            expect(isModelAllowed('free', 'gpt-6-sol', restrictedConfig)).toBe(
                false
            );
            expect(
                isModelAllowed('free', 'gemini-3.8-flash', restrictedConfig)
            ).toBe(false);
        });

        it('allows gpt-5.6-sol, gemini-3.1-pro-preview, claude-opus-5 for pro tier', () => {
            expect(isModelAllowed('pro', 'gpt-5.6-sol', restrictedConfig)).toBe(
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
                isModelAllowed('pro', 'claude-opus-5', restrictedConfig)
            ).toBe(true);
        });

        it('restricts byok models from member tier', () => {
            for (const model of [
                'gpt-5.6-sol',
                'claude-opus-4-8',
                'claude-opus-5',
                'claude-fable-5-1',
                'gpt-6-astra',
            ] as const) {
                expect(
                    isModelAllowed('member', model, restrictedConfig),
                    model
                ).toBe(false);
                expect(
                    isModelAllowed('pro', model, restrictedConfig),
                    model
                ).toBe(true);
            }
        });

        it('restricts byok models from free tier', () => {
            for (const model of [
                'gpt-5.6-sol',
                'claude-opus-5',
                'gpt-6-astra',
            ] as const) {
                expect(
                    isModelAllowed('free', model, restrictedConfig),
                    model
                ).toBe(false);
            }
        });

        it('restricts member-only models (claude-sonnet-5-5) from free tier', () => {
            expect(
                isModelAllowed('member', 'claude-sonnet-5-5', restrictedConfig)
            ).toBe(true);
            expect(
                isModelAllowed('free', 'claude-sonnet-5-5', restrictedConfig)
            ).toBe(false);
        });

        // isPremiumModel/requiresByokKey는 free 목록 밖이기만 하면 통과하므로
        // member/pro 배치 자체는 검증하지 못한다. 아래 두 테스트가 배치를 고정한다 —
        // claude-opus-5를 MEMBER_MODELS로 옮기면 반드시 실패해야 한다.
        it('places the member models in member but not free', () => {
            for (const model of [
                'claude-sonnet-5-5',
                'gpt-6-sol',
                'gemini-3.8-flash',
                'gemini-3.1-pro-preview',
                'deepseek-v4.1-pro',
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
    });

    describe('isTier', () => {
        it('identifies valid tier literals', () => {
            expect(isTier('free')).toBe(true);
            expect(isTier('member')).toBe(true);
            expect(isTier('pro')).toBe(true);
            expect(isTier('enterprise')).toBe(false);
        });
    });

    describe('getModelAccess', () => {
        it('places every model in exactly one access class', () => {
            // The compiler cannot catch a model that exists in MODEL_SPECS but was
            // never placed in domain/tier.ts, so this is the tripwire for it.
            for (const model of Object.keys(MODEL_SPECS) as ModelId[]) {
                expect(() => getModelAccess(model), model).not.toThrow();
            }
        });

        it('throws for a model missing from every list', () => {
            const emptyLists: TierConfig = {
                ...TIER_CONFIG,
                models: { free: [], member: [], pro: [] },
            };
            expect(() =>
                getModelAccess('claude-opus-5', emptyLists)
            ).toThrowError(/not present in any tier model list/);
        });

        it('classifies the free models', () => {
            for (const model of [
                'gpt-6-luna',
                'gemini-3.5-flash-lite',
                'deepseek-v4.1-flash',
                'gemini-3.6-flash',
                'claude-haiku-5-5',
            ] as const) {
                expect(getModelAccess(model), model).toBe('free');
            }
        });

        it('classifies the member models', () => {
            for (const model of [
                'gemini-3.8-flash',
                'deepseek-v4.1-pro',
                'claude-sonnet-5-5',
                'gpt-6-sol',
                'gemini-3.1-pro-preview',
            ] as const) {
                expect(getModelAccess(model), model).toBe('member');
            }
        });

        it('classifies the byok models', () => {
            for (const model of [
                'gpt-5.6-sol',
                'claude-opus-4-8',
                'claude-opus-5',
                'claude-opus-5-5',
                'claude-fable-5-1',
                'gpt-6-astra',
                'gpt-6.1-sol',
                'gemini-4-argon',
            ] as const) {
                expect(getModelAccess(model), model).toBe('byok');
            }
        });

        it('ignores enableTierRestrictions — it classifies, it does not gate', () => {
            const restricted: TierConfig = {
                ...TIER_CONFIG,
                featureFlags: {
                    ...TIER_CONFIG.featureFlags,
                    enableTierRestrictions: true,
                },
            };
            for (const model of Object.keys(MODEL_SPECS) as ModelId[]) {
                expect(getModelAccess(model, restricted), model).toBe(
                    getModelAccess(model)
                );
            }
        });
    });

    describe('reasoning defaults follow the access class', () => {
        it('defaults free and member models to reasoning off', () => {
            // Server-key classes must not spend thinking tokens unasked.
            for (const model of Object.keys(MODEL_SPECS) as ModelId[]) {
                const access = getModelAccess(model);
                if (access === 'byok') continue;
                expect(MODEL_SPECS[model].reasoning.default, model).toBe('off');
            }
        });

        it('leaves byok models on their provider default', () => {
            for (const model of Object.keys(MODEL_SPECS) as ModelId[]) {
                if (getModelAccess(model) !== 'byok') continue;
                expect(MODEL_SPECS[model].reasoning.default, model).toBe('on');
            }
        });
    });

    describe('isPremiumModel', () => {
        it('returns false for free models', () => {
            expect(isPremiumModel('gemini-3.6-flash')).toBe(false);
            expect(isPremiumModel('claude-haiku-5-5')).toBe(false);
        });

        it('returns true for member models as well as byok models', () => {
            // "Premium" means "not free" — it spans both paid-by-server member
            // models and user-key byok models.
            expect(isPremiumModel('claude-sonnet-5-5')).toBe(true);
            expect(isPremiumModel('claude-opus-5')).toBe(true);
        });

        it('is the inverse of isFreeModel for every model', () => {
            for (const model of Object.keys(MODEL_SPECS) as ModelId[]) {
                expect(isPremiumModel(model), model).toBe(!isFreeModel(model));
            }
        });

        it('ignores enableTierRestrictions', () => {
            const restricted: TierConfig = {
                ...TIER_CONFIG,
                featureFlags: {
                    ...TIER_CONFIG.featureFlags,
                    enableTierRestrictions: true,
                },
            };
            expect(isPremiumModel('claude-opus-5', restricted)).toBe(true);
            expect(isPremiumModel('gemini-3.6-flash', restricted)).toBe(false);
        });
    });

    describe('requiresAuth', () => {
        it('is false only for free models', () => {
            for (const model of Object.keys(MODEL_SPECS) as ModelId[]) {
                expect(requiresAuth(model), model).toBe(
                    getModelAccess(model) !== 'free'
                );
            }
        });
    });

    describe('requiresByokKey', () => {
        it('is false for free models on every tier', () => {
            for (const tier of ['free', 'member', 'pro'] as const) {
                expect(requiresByokKey(tier, 'gemini-3.6-flash'), tier).toBe(
                    false
                );
            }
        });

        it('is false for member models on non-pro tiers', () => {
            // Regression guard for the three-way access axis: member models are
            // covered by the server key. The previous binary classifier returned
            // true here, forcing members to supply a key for models we pay for.
            for (const model of [
                'claude-sonnet-5-5',
                'gpt-6-sol',
                'gemini-3.8-flash',
                'deepseek-v4.1-pro',
            ] as const) {
                expect(requiresByokKey('free', model), model).toBe(false);
                expect(requiresByokKey('member', model), model).toBe(false);
            }
        });

        it('is true for byok models on non-pro tiers', () => {
            for (const model of [
                'gpt-5.6-sol',
                'claude-opus-4-8',
                'claude-opus-5',
                'claude-fable-5-1',
                'gpt-6-astra',
            ] as const) {
                expect(requiresByokKey('free', model), model).toBe(true);
                expect(requiresByokKey('member', model), model).toBe(true);
            }
        });

        it('is false for pro tier on every model', () => {
            // Pro is exempt from BYOK — the byok list is exactly what a pro
            // licence would unlock on the server key.
            for (const model of Object.keys(MODEL_SPECS) as ModelId[]) {
                expect(requiresByokKey('pro', model), model).toBe(false);
            }
        });

        it('ignores enableTierRestrictions', () => {
            const restricted: TierConfig = {
                ...TIER_CONFIG,
                featureFlags: {
                    ...TIER_CONFIG.featureFlags,
                    enableTierRestrictions: true,
                },
            };
            expect(requiresByokKey('member', 'claude-opus-5', restricted)).toBe(
                true
            );
            expect(
                requiresByokKey('member', 'claude-sonnet-5-5', restricted)
            ).toBe(false);
        });
    });
});
