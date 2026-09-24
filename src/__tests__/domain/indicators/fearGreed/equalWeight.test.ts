import { describe, expect, it } from 'vitest';

import { FEAR_GREED_CONFIDENCE_THRESHOLDS } from '@/domain/indicators/fearGreed/composition';
import {
    composeEqualWeightSnapshot,
    walkForwardHistory,
    walkForwardSnapshot,
} from '@/domain/indicators/fearGreed/equalWeight';
import {
    MARKET_FEAR_GREED_FACTOR_KEYS,
    type MarketFactorValues,
} from '@/domain/indicators/marketFearGreed/types';

const { LIMITED, NORMAL } = FEAR_GREED_CONFIDENCE_THRESHOLDS;

function values(overrides: Partial<MarketFactorValues> = {}) {
    return {
        momentum: 0,
        volatility: 0,
        safe_haven: 0,
        junk_bond: 0,
        breadth: 0,
        ...overrides,
    } satisfies MarketFactorValues;
}

function sampleOf(count: number, v: MarketFactorValues): MarketFactorValues[] {
    return new Array(count).fill(null).map(() => ({ ...v }));
}

/** The market-index key set exercises the composer with five real factors. */
function composeMarketSnapshot(
    current: MarketFactorValues,
    sample: MarketFactorValues[]
) {
    return composeEqualWeightSnapshot(
        MARKET_FEAR_GREED_FACTOR_KEYS,
        current,
        sample
    );
}

describe('composeEqualWeightSnapshot', () => {
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
                safe_haven: 1,
                junk_bond: 1,
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
                    safe_haven: 1,
                    junk_bond: 1,
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
            safe_haven: 0.33,
            junk_bond: 0.44,
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

describe('walkForwardSnapshot', () => {
    const keys = ['a'] as const;
    const dates = Array.from({ length: LIMITED + 2 }, (_, i) => `d${i}`);

    it('returns null for an empty series', () => {
        expect(walkForwardSnapshot(keys, [], [])).toBeNull();
    });

    it('returns null when the latest bundle is null', () => {
        const ts = dates.map((_, i) =>
            i === dates.length - 1 ? null : { a: i }
        );
        expect(walkForwardSnapshot(keys, dates, ts)).toBeNull();
    });

    it('ranks the latest bundle against the valid bundles before it', () => {
        // One null gap inside the prior sample: it must be skipped, not counted.
        const ts = dates.map((_, i) => (i === 0 ? null : { a: i }));
        const snapshot = walkForwardSnapshot(keys, dates, ts);

        expect(snapshot?.asOf).toBe(dates[dates.length - 1]);
        expect(snapshot?.sampleSize).toBe(dates.length - 2);
        expect(snapshot?.score).toBe(100);
    });

    it('returns null while the prior sample is below LIMITED', () => {
        const short = dates.slice(0, LIMITED);
        expect(
            walkForwardSnapshot(
                keys,
                short,
                short.map((_, i) => ({ a: i }))
            )
        ).toBeNull();
    });
});

describe('walkForwardHistory', () => {
    const keys = ['a'] as const;
    const dates = Array.from({ length: LIMITED + 3 }, (_, i) => `d${i}`);
    const ts = dates.map((_, i) => (i === 1 ? null : { a: i }));

    it('emits one point per session with null scores until LIMITED samples exist', () => {
        const history = walkForwardHistory(keys, dates, ts);

        expect(history.map(p => p.date)).toEqual(dates);
        // Index 1 is a null bundle; valid samples before index t are t-1 for
        // t ≥ 2, so the first scored index is LIMITED + 1.
        expect(history.findIndex(p => p.score !== null)).toBe(LIMITED + 1);
        expect(history[1]).toEqual({ date: 'd1', score: null, label: null });
    });

    it('agrees with the snapshot at every prefix', () => {
        const history = walkForwardHistory(keys, dates, ts);
        dates.forEach((_, t) => {
            const snapshot = walkForwardSnapshot(
                keys,
                dates.slice(0, t + 1),
                ts.slice(0, t + 1)
            );
            expect(history[t].score).toBe(snapshot?.score ?? null);
        });
    });
});
