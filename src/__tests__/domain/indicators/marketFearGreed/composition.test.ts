import { describe, expect, it } from 'vitest';

import { FEAR_GREED_CONFIDENCE_THRESHOLDS } from '@/domain/indicators/fearGreed/composition';
import { composeMarketSnapshot } from '@/domain/indicators/marketFearGreed/composition';
import {
    MARKET_FEAR_GREED_FACTOR_KEYS,
    type MarketFactorValues,
} from '@/domain/indicators/marketFearGreed/types';

const { LIMITED, NORMAL } = FEAR_GREED_CONFIDENCE_THRESHOLDS;

function values(overrides: Partial<MarketFactorValues> = {}) {
    return {
        momentum: 0,
        volatility: 0,
        safeHaven: 0,
        junkBond: 0,
        breadth: 0,
        ...overrides,
    } satisfies MarketFactorValues;
}

function sampleOf(count: number, v: MarketFactorValues): MarketFactorValues[] {
    return new Array(count).fill(null).map(() => ({ ...v }));
}

describe('composeMarketSnapshot', () => {
    it('returns null when the walk-forward sample is below the LIMITED threshold', () => {
        const result = composeMarketSnapshot(
            values({ momentum: 1 }),
            sampleOf(LIMITED - 1, values())
        );

        expect(result).toBeNull();
    });

    it('returns a limited-confidence composition at the LIMITED threshold', () => {
        const result = composeMarketSnapshot(
            values({ momentum: 1 }),
            sampleOf(LIMITED, values())
        );

        expect(result?.confidence).toBe('limited');
        expect(result?.sampleSize).toBe(LIMITED);
    });

    it('returns normal confidence once the sample reaches the NORMAL threshold', () => {
        const result = composeMarketSnapshot(
            values(),
            sampleOf(NORMAL, values({ momentum: -1 }))
        );

        expect(result?.confidence).toBe('normal');
        expect(result?.sampleSize).toBe(NORMAL);
    });

    it('scores 100 / EXTREME_GREED when every factor exceeds its whole history', () => {
        const result = composeMarketSnapshot(
            values({
                momentum: 1,
                volatility: 1,
                safeHaven: 1,
                junkBond: 1,
                breadth: 1,
            }),
            sampleOf(NORMAL, values())
        );

        expect(result?.score).toBe(100);
        expect(result?.label).toBe('EXTREME_GREED');
    });

    it('scores 0 / EXTREME_FEAR when every factor sits below its whole history', () => {
        const result = composeMarketSnapshot(
            values(),
            sampleOf(
                NORMAL,
                values({
                    momentum: 1,
                    volatility: 1,
                    safeHaven: 1,
                    junkBond: 1,
                    breadth: 1,
                })
            )
        );

        expect(result?.score).toBe(0);
        expect(result?.label).toBe('EXTREME_FEAR');
    });

    it('weights the five factors equally', () => {
        // Two factors rank at the top of their history; the other three tie
        // their whole (all-zero) history and land at the mid-rank neutral
        // point (50), not at the bottom (0).
        const sample = sampleOf(NORMAL, values({ momentum: 0, volatility: 0 }));
        const result = composeMarketSnapshot(
            values({ momentum: 1, volatility: 1 }),
            sample
        );

        expect(result?.score).toBeCloseTo((100 + 100 + 50 + 50 + 50) / 5, 12);
    });

    it('emits factors in display order with their raw values attached', () => {
        const current = values({
            momentum: 0.11,
            volatility: 0.22,
            safeHaven: 0.33,
            junkBond: 0.44,
            breadth: 0.55,
        });

        const result = composeMarketSnapshot(
            current,
            sampleOf(NORMAL, values())
        );

        expect(result?.factors.map(f => f.key)).toEqual([
            ...MARKET_FEAR_GREED_FACTOR_KEYS,
        ]);
        expect(result?.factors.map(f => f.rawValue)).toEqual([
            0.11, 0.22, 0.33, 0.44, 0.55,
        ]);
    });

    it('ranks a factor by the share of history strictly below it', () => {
        const sample = [
            ...sampleOf(20, values({ momentum: -1 })),
            ...sampleOf(60, values({ momentum: 1 })),
        ];

        const result = composeMarketSnapshot(values({ momentum: 0 }), sample);
        const momentum = result?.factors.find(f => f.key === 'momentum');

        expect(momentum?.percentile).toBeCloseTo(25, 12);
    });
});
