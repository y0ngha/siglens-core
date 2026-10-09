import { describe, expect, it } from 'vitest';
import {
    TIER_CONFIG,
    buildRevealedTierConfig,
    getMeteredRevealPolicy,
    isInfoDepthAllowed,
    isTimeframeAllowed,
} from '@/domain/tier';
import type { TierConfig } from '@/domain/types';

const withFlag = (enabled: boolean | undefined): TierConfig => ({
    ...TIER_CONFIG,
    featureFlags: {
        ...TIER_CONFIG.featureFlags,
        enableMeteredReveal: enabled,
    },
});

describe('getMeteredRevealPolicy', () => {
    it('returns the free policy from the default config', () => {
        expect(getMeteredRevealPolicy('free')).toEqual({
            dailySymbols: 1,
            revealAs: 'member',
        });
    });

    it('returns null for tiers without a policy', () => {
        expect(getMeteredRevealPolicy('member')).toBeNull();
        expect(getMeteredRevealPolicy('pro')).toBeNull();
    });

    it('returns null when the flag is off or omitted', () => {
        expect(getMeteredRevealPolicy('free', withFlag(false))).toBeNull();
        expect(getMeteredRevealPolicy('free', withFlag(undefined))).toBeNull();
    });

    it('returns null when the config has no meteredReveal section', () => {
        const { meteredReveal: _omit, ...rest } = TIER_CONFIG;
        expect(getMeteredRevealPolicy('free', rest)).toBeNull();
    });

    it('returns null for a non-positive or NaN daily count', () => {
        for (const dailySymbols of [0, -1, Number.NaN]) {
            const config: TierConfig = {
                ...TIER_CONFIG,
                meteredReveal: { free: { dailySymbols, revealAs: 'member' } },
            };
            expect(getMeteredRevealPolicy('free', config)).toBeNull();
        }
    });
});

describe('buildRevealedTierConfig', () => {
    it('gives the free tier the member info depth', () => {
        const revealed = buildRevealedTierConfig('free');
        expect(revealed.infoDepth.free).toEqual(TIER_CONFIG.infoDepth.member);
        expect(isInfoDepthAllowed('free', 'entry', revealed)).toBe(true);
        expect(isInfoDepthAllowed('free', 'target', revealed)).toBe(true);
        expect(isInfoDepthAllowed('free', 'entry')).toBe(false);
    });

    it('leaves timeframes, models, limits and flags untouched', () => {
        const revealed = buildRevealedTierConfig('free');
        expect(revealed.timeframes).toBe(TIER_CONFIG.timeframes);
        expect(revealed.models).toBe(TIER_CONFIG.models);
        expect(revealed.limits).toBe(TIER_CONFIG.limits);
        expect(revealed.featureFlags).toBe(TIER_CONFIG.featureFlags);
        expect(isTimeframeAllowed('free', '1Hour', revealed)).toBe(
            isTimeframeAllowed('free', '1Hour')
        );
    });

    it('changes only the metered tier and follows revealAs', () => {
        const revealed = buildRevealedTierConfig('free');
        expect(revealed.infoDepth.member).toBe(TIER_CONFIG.infoDepth.member);
        expect(revealed.infoDepth.pro).toBe(TIER_CONFIG.infoDepth.pro);

        const asPro: TierConfig = {
            ...TIER_CONFIG,
            meteredReveal: { free: { dailySymbols: 2, revealAs: 'pro' } },
        };
        expect(buildRevealedTierConfig('free', asPro).infoDepth.free).toBe(
            TIER_CONFIG.infoDepth.pro
        );
    });

    it('does not mutate the source config', () => {
        const before = [...TIER_CONFIG.infoDepth.free];
        buildRevealedTierConfig('free');
        expect(TIER_CONFIG.infoDepth.free).toEqual(before);
    });

    it('returns the same config when the tier has no meter', () => {
        expect(buildRevealedTierConfig('member')).toBe(TIER_CONFIG);
        const off = withFlag(false);
        expect(buildRevealedTierConfig('free', off)).toBe(off);
    });
});
