import { describe, expect, it } from 'vitest';
import {
    isModelAllowedForTier,
    requiresUserApiKey,
    shouldUseServerKey,
} from '@/domain/keyRouting';
import type { ActiveModelId } from '@/domain/types';

/** Free class — server key for everyone, anonymous included. */
const FREE_MODEL: ActiveModelId = 'gemini-3.6-flash';
/** Member class — server key, but sign-in required. */
const MEMBER_MODEL: ActiveModelId = 'claude-sonnet-5-5';
/** Byok class — the caller's own key on any non-pro tier. */
const BYOK_MODEL: ActiveModelId = 'claude-opus-5';

describe('shouldUseServerKey', () => {
    it('returns true for free models regardless of tier', () => {
        expect(shouldUseServerKey(FREE_MODEL, 'free')).toBe(true);
        expect(shouldUseServerKey(FREE_MODEL, 'member')).toBe(true);
        expect(shouldUseServerKey(FREE_MODEL, 'pro')).toBe(true);
        expect(shouldUseServerKey(FREE_MODEL, undefined)).toBe(true);
    });

    it('returns true for member models regardless of tier', () => {
        // Regression guard for the three-way access axis. The pre-axis form
        // (`isFreeModel(model) || tier === 'pro'`) returned false here, so a
        // member requesting a model the server pays for was told
        // "User API key required" and the call threw.
        expect(shouldUseServerKey(MEMBER_MODEL, 'member')).toBe(true);
        expect(shouldUseServerKey(MEMBER_MODEL, 'pro')).toBe(true);
        // Whether an anonymous caller may pick a member model at all is the
        // consumer's auth gate to decide; key routing only answers "whose key".
        expect(shouldUseServerKey(MEMBER_MODEL, 'free')).toBe(true);
        expect(shouldUseServerKey(MEMBER_MODEL, undefined)).toBe(true);
    });

    it('returns true for pro tier on byok models', () => {
        expect(shouldUseServerKey(BYOK_MODEL, 'pro')).toBe(true);
    });

    it('returns false for non-pro tier on byok models', () => {
        expect(shouldUseServerKey(BYOK_MODEL, 'free')).toBe(false);
        expect(shouldUseServerKey(BYOK_MODEL, 'member')).toBe(false);
        expect(shouldUseServerKey(BYOK_MODEL, undefined)).toBe(false);
    });
});

describe('requiresUserApiKey', () => {
    it('is the exact inverse of shouldUseServerKey', () => {
        for (const model of [FREE_MODEL, MEMBER_MODEL, BYOK_MODEL]) {
            for (const tier of ['free', 'member', 'pro', undefined] as const) {
                expect(
                    requiresUserApiKey(model, tier),
                    `${model} / ${tier}`
                ).toBe(!shouldUseServerKey(model, tier));
            }
        }
    });

    it('returns false for free and member models regardless of tier', () => {
        for (const model of [FREE_MODEL, MEMBER_MODEL]) {
            for (const tier of ['free', 'member', 'pro', undefined] as const) {
                expect(requiresUserApiKey(model, tier), model).toBe(false);
            }
        }
    });

    it('returns true for byok models on non-pro tiers only', () => {
        expect(requiresUserApiKey(BYOK_MODEL, 'free')).toBe(true);
        expect(requiresUserApiKey(BYOK_MODEL, 'member')).toBe(true);
        expect(requiresUserApiKey(BYOK_MODEL, undefined)).toBe(true);
        expect(requiresUserApiKey(BYOK_MODEL, 'pro')).toBe(false);
    });
});

describe('isModelAllowedForTier (defense-in-depth)', () => {
    // 정책 배경(enableTierRestrictions, siglens-worker#21 regression)의 canonical 설명은
    // src/domain/keyRouting.ts의 isModelAllowedForTier JSDoc — 여기서는 그 정책 하에서 이
    // 함수가 실제로 무엇을 검증하는지만 assert한다: 어느 tier에도 등록되지 않은 model만
    // 걸러낸다.
    const FREE_TIER_MODEL: ActiveModelId = 'gemini-3.6-flash'; // 모든 tier에 존재
    const MEMBER_PRO_MODEL: ActiveModelId = 'gemini-3.1-pro-preview'; // member+pro tier 목록에 존재 (free 목록엔 없음)
    const PRO_ONLY_MODEL: ActiveModelId = 'claude-opus-5'; // pro tier 목록에만 존재
    const UNKNOWN_MODEL = 'not-a-real-model' as ActiveModelId;

    it('returns true when tier is undefined (check skipped — caller trusts gated tier)', () => {
        expect(isModelAllowedForTier(PRO_ONLY_MODEL, undefined)).toBe(true);
        expect(isModelAllowedForTier(FREE_TIER_MODEL, undefined)).toBe(true);
    });

    it('allows any registered model regardless of which tier list it historically belonged to', () => {
        expect(isModelAllowedForTier(FREE_TIER_MODEL, 'free')).toBe(true);
        expect(isModelAllowedForTier(MEMBER_PRO_MODEL, 'member')).toBe(true);
        expect(isModelAllowedForTier(PRO_ONLY_MODEL, 'pro')).toBe(true);

        // 정책 전환의 핵심: 예전엔 거부됐던 낮은 tier + 상위-tier-only 모델 조합이 이제 허용된다.
        expect(isModelAllowedForTier(MEMBER_PRO_MODEL, 'free')).toBe(true);
        expect(isModelAllowedForTier(PRO_ONLY_MODEL, 'free')).toBe(true);
        expect(isModelAllowedForTier(PRO_ONLY_MODEL, 'member')).toBe(true);
    });

    it('rejects a model id that is not registered under any tier', () => {
        expect(isModelAllowedForTier(UNKNOWN_MODEL, 'free')).toBe(false);
        expect(isModelAllowedForTier(UNKNOWN_MODEL, 'member')).toBe(false);
        expect(isModelAllowedForTier(UNKNOWN_MODEL, 'pro')).toBe(false);
    });
});

describe('cost guard is unaffected by the model-gating policy change', () => {
    // isModelAllowedForTier now allows every registered model on every tier, but the
    // actual money guard (shouldUseServerKey / requiresUserApiKey) is built on
    // requiresByokKey, which intentionally ignores enableTierRestrictions and must not move.
    //
    // If core ever puts a byok-class model into a lower tier's roster by mistake,
    // isModelAllowedForTier would go along with it (model gating is off), but
    // shouldUseServerKey/requiresUserApiKey — driven by the access class, independent of
    // enableTierRestrictions — must still hold the cost line. The three-way co-assertion below
    // (allowed + requiresUserApiKey + shouldUseServerKey on one line of sight) is the
    // regression net for that scenario.
    //
    // Declared locally rather than reusing the file-level BYOK_MODEL so this block states
    // its own precondition: the model must be absent from the free and member rosters.
    const BYOK_ONLY_MODEL: ActiveModelId = 'claude-opus-5';

    it('still requires a user key and withholds the server key for a non-pro tier on a pro-list model', () => {
        expect(isModelAllowedForTier(BYOK_ONLY_MODEL, 'member')).toBe(true);
        expect(requiresUserApiKey(BYOK_ONLY_MODEL, 'member')).toBe(true);
        expect(shouldUseServerKey(BYOK_ONLY_MODEL, 'member')).toBe(false);

        expect(isModelAllowedForTier(BYOK_ONLY_MODEL, 'free')).toBe(true);
        expect(requiresUserApiKey(BYOK_ONLY_MODEL, 'free')).toBe(true);
        expect(shouldUseServerKey(BYOK_ONLY_MODEL, 'free')).toBe(false);
    });

    it('still waives the user key and grants the server key for pro tier on a pro-list model', () => {
        expect(isModelAllowedForTier(BYOK_ONLY_MODEL, 'pro')).toBe(true);
        expect(requiresUserApiKey(BYOK_ONLY_MODEL, 'pro')).toBe(false);
        expect(shouldUseServerKey(BYOK_ONLY_MODEL, 'pro')).toBe(true);
    });

    it('still uses the server key with no user key required for a free-list model on any tier', () => {
        expect(isModelAllowedForTier(FREE_MODEL, 'member')).toBe(true);
        expect(requiresUserApiKey(FREE_MODEL, 'member')).toBe(false);
        expect(shouldUseServerKey(FREE_MODEL, 'member')).toBe(true);
    });
});
