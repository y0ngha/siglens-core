import { describe, expect, it } from 'vitest';
import {
    isModelAllowedForTier,
    requiresUserApiKey,
    shouldUseServerKey,
} from '@/domain/keyRouting';
import type { ActiveModelId } from '@/domain/types';

const FREE_MODEL: ActiveModelId = 'gemini-2.5-flash'; // siglens-provided
const PREMIUM_MODEL: ActiveModelId = 'gemini-2.5-pro'; // not siglens-provided

describe('shouldUseServerKey', () => {
    it('returns true for siglens-provided models regardless of tier', () => {
        expect(shouldUseServerKey(FREE_MODEL, 'free')).toBe(true);
        expect(shouldUseServerKey(FREE_MODEL, 'member')).toBe(true);
        expect(shouldUseServerKey(FREE_MODEL, 'pro')).toBe(true);
        expect(shouldUseServerKey(FREE_MODEL, undefined)).toBe(true);
    });

    it('returns true for pro tier on premium models', () => {
        expect(shouldUseServerKey(PREMIUM_MODEL, 'pro')).toBe(true);
    });

    it('returns false for non-pro tier on premium models', () => {
        expect(shouldUseServerKey(PREMIUM_MODEL, 'free')).toBe(false);
        expect(shouldUseServerKey(PREMIUM_MODEL, 'member')).toBe(false);
        expect(shouldUseServerKey(PREMIUM_MODEL, undefined)).toBe(false);
    });
});

describe('requiresUserApiKey', () => {
    it('returns false for siglens-provided models regardless of tier', () => {
        expect(requiresUserApiKey(FREE_MODEL, 'free')).toBe(false);
        expect(requiresUserApiKey(FREE_MODEL, 'member')).toBe(false);
        expect(requiresUserApiKey(FREE_MODEL, 'pro')).toBe(false);
        expect(requiresUserApiKey(FREE_MODEL, undefined)).toBe(false);
    });

    it('returns false for pro tier on premium models', () => {
        expect(requiresUserApiKey(PREMIUM_MODEL, 'pro')).toBe(false);
    });

    it('returns true for non-pro tier on premium models', () => {
        expect(requiresUserApiKey(PREMIUM_MODEL, 'free')).toBe(true);
        expect(requiresUserApiKey(PREMIUM_MODEL, 'member')).toBe(true);
        expect(requiresUserApiKey(PREMIUM_MODEL, undefined)).toBe(true);
    });
});

describe('isModelAllowedForTier (defense-in-depth)', () => {
    // 정책 배경(enableTierRestrictions, siglens-worker#21 regression)의 canonical 설명은
    // src/domain/keyRouting.ts의 isModelAllowedForTier JSDoc — 여기서는 그 정책 하에서 이
    // 함수가 실제로 무엇을 검증하는지만 assert한다: 어느 tier에도 등록되지 않은 model만
    // 걸러낸다.
    const FREE_TIER_MODEL: ActiveModelId = 'gemini-2.5-flash'; // 모든 tier에 존재
    const MEMBER_PRO_MODEL: ActiveModelId = 'gemini-2.5-pro'; // member+pro tier 목록에 존재 (free 목록엔 없음)
    const PRO_ONLY_MODEL: ActiveModelId = 'claude-opus-4-7'; // pro tier 목록에만 존재
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
    // isFreeModel, which intentionally ignores enableTierRestrictions and must not move.
    //
    // If core ever puts a new pro-only model (claude-opus-5 etc.) into a lower tier's roster
    // by mistake, isModelAllowedForTier would go along with it (model gating is off), but
    // shouldUseServerKey/requiresUserApiKey — driven by isFreeModel, independent of
    // enableTierRestrictions — must still hold the cost line. The three-way co-assertion below
    // (allowed + requiresUserApiKey + shouldUseServerKey on one line of sight) is the
    // regression net for that scenario.
    //
    // PRO_LIST_MODEL is kept as its own constant, distinct from the file-level PREMIUM_MODEL
    // ('gemini-2.5-pro'), so this block's model id doesn't silently shadow that one.
    const PRO_LIST_MODEL: ActiveModelId = 'claude-opus-5'; // pro 전용 (free/member 리스트엔 없음)

    it('still requires a user key and withholds the server key for a non-pro tier on a pro-list model', () => {
        expect(isModelAllowedForTier(PRO_LIST_MODEL, 'member')).toBe(true);
        expect(requiresUserApiKey(PRO_LIST_MODEL, 'member')).toBe(true);
        expect(shouldUseServerKey(PRO_LIST_MODEL, 'member')).toBe(false);

        expect(isModelAllowedForTier(PRO_LIST_MODEL, 'free')).toBe(true);
        expect(requiresUserApiKey(PRO_LIST_MODEL, 'free')).toBe(true);
        expect(shouldUseServerKey(PRO_LIST_MODEL, 'free')).toBe(false);
    });

    it('still waives the user key and grants the server key for pro tier on a pro-list model', () => {
        expect(isModelAllowedForTier(PRO_LIST_MODEL, 'pro')).toBe(true);
        expect(requiresUserApiKey(PRO_LIST_MODEL, 'pro')).toBe(false);
        expect(shouldUseServerKey(PRO_LIST_MODEL, 'pro')).toBe(true);
    });

    it('still uses the server key with no user key required for a free-list model on any tier', () => {
        expect(isModelAllowedForTier(FREE_MODEL, 'member')).toBe(true);
        expect(requiresUserApiKey(FREE_MODEL, 'member')).toBe(false);
        expect(shouldUseServerKey(FREE_MODEL, 'member')).toBe(true);
    });
});
