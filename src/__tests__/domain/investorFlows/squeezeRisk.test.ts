import { describe, expect, it } from 'vitest';
import {
    SQUEEZE_COMPONENTS,
    SQUEEZE_LEVEL_CUTOFFS,
    SQUEEZE_MAX_BAR_AGE_DAYS,
} from '@/domain/investorFlows/constants';
import { evaluateSqueezeRisk } from '@/domain/investorFlows/squeezeRisk';
import type {
    InvestorFlowsSnapshot,
    SqueezeRiskComponentId,
    SqueezeRiskScore,
} from '@/domain/types';
import {
    AS_OF,
    dailyBars,
    daysBeforeAsOf,
    emptySnapshot,
    ftdPoint,
    shortInterestPoint,
    shortInterestSeries,
} from '../../fixtures/investorFlows';

/**
 * A crowded small cap: 9M of a 30M float short (30%), 10 days to cover and
 * short interest up 50% over three settlements.
 */
function crowded(overrides: Partial<InvestorFlowsSnapshot> = {}) {
    return emptySnapshot({
        sharesOutstanding: 40_000_000,
        floatShares: 30_000_000,
        shortInterest: shortInterestSeries(6_000_000, 9_000_000, 10),
        ...overrides,
    });
}

/** 25 bars: close up 60% over the last 20 sessions, volume 3x in the last 5. */
const RALLY = dailyBars({
    count: 25,
    firstClose: 10,
    lastClose: 16,
    baseVolume: 1_000_000,
    recentVolume: 3_000_000,
});

function component(score: SqueezeRiskScore, id: SqueezeRiskComponentId) {
    return score.components.find(c => c.id === id);
}

describe('evaluateSqueezeRisk — full crowding plus a rally', () => {
    const score = evaluateSqueezeRisk(
        crowded({
            failsToDeliver: [ftdPoint({ failsQty: 300_000 })],
            thresholdList: {
                listed: true,
                consecutiveDays: 14,
                firstListedDate: daysBeforeAsOf(20),
                markets: ['Nasdaq'],
            },
        }),
        { dailyBars: RALLY }
    );

    it('reaches extreme', () => {
        expect(score.level).toBe('extreme');
        expect(score.score).toBeGreaterThanOrEqual(
            SQUEEZE_LEVEL_CUTOFFS.extreme
        );
    });

    it('lists the largest contributions first and sums them to the score', () => {
        const contributions = score.components.map(c => c.contribution);
        expect(contributions).toEqual(contributions.toSorted((a, b) => b - a));
        const sum = contributions.reduce((a, b) => a + b, 0);
        expect(score.score).toBeCloseTo(sum, 6);
    });

    it('computes the price inputs from the bars', () => {
        // close[-21] of a 25-bar 10→16 ramp is 11; 16 / 11 - 1 = 45.45%.
        expect(component(score, 'price_change_20d')?.value).toBe(45.45);
        // last 5 at 3M against the 20 before at 1M.
        expect(component(score, 'volume_ratio')?.value).toBe(3);
    });

    it('flags FINRA and exchange-list use and is partial (no short-volume z)', () => {
        expect(score.includesFinra).toBe(true);
        expect(score.includesExchangeLists).toBe(true);
        expect(score.sufficiency).toBe('partial');
        expect(score.missing).toEqual(['off_exchange_short_ratio_z']);
    });

    it('renormalizes the weights over the present inputs', () => {
        const total = score.components.reduce((a, c) => a + c.weight, 0);
        // Weights are rounded to 4 places for display.
        expect(total).toBeCloseTo(1, 3);
        expect(
            component(score, 'short_interest_pct_float')?.weight
        ).toBeCloseTo(
            SQUEEZE_COMPONENTS.short_interest_pct_float.weight /
                (1 - SQUEEZE_COMPONENTS.off_exchange_short_ratio_z.weight),
            4
        );
    });

    it('reports the reference day and the last bar used', () => {
        expect(score.asOf).toBe(AS_OF);
        expect(score.lastBarDate).toBe(daysBeforeAsOf(1));
    });
});

describe('evaluateSqueezeRisk — completed bars only', () => {
    it('ignores a bar dated on the reference day (still forming)', () => {
        const forming = [
            ...RALLY,
            { date: AS_OF, close: 40, volume: 50_000_000 },
        ];
        const withForming = evaluateSqueezeRisk(crowded(), {
            dailyBars: forming,
        });
        const without = evaluateSqueezeRisk(crowded(), { dailyBars: RALLY });
        expect(withForming).toEqual(without);
    });

    it('ignores bars after the reference day', () => {
        const future = [...RALLY, { date: '2026-10-20', close: 2, volume: 1 }];
        expect(evaluateSqueezeRisk(crowded(), { dailyBars: future })).toEqual(
            evaluateSqueezeRisk(crowded(), { dailyBars: RALLY })
        );
    });

    it('accepts bars in any order and datetime dates', () => {
        const shuffled = RALLY.toReversed().map(b => ({
            ...b,
            date: `${b.date}T00:00:00.000Z`,
        }));
        expect(
            evaluateSqueezeRisk(crowded(), { dailyBars: shuffled }).score
        ).toBe(evaluateSqueezeRisk(crowded(), { dailyBars: RALLY }).score);
    });

    it('drops invalid bars', () => {
        const bad = [
            ...RALLY,
            { date: 'garbage', close: 5, volume: 1 },
            { date: daysBeforeAsOf(1), close: Number.NaN, volume: 1 },
            { date: daysBeforeAsOf(2), close: -1, volume: 1 },
        ];
        expect(evaluateSqueezeRisk(crowded(), { dailyBars: bad }).score).toBe(
            evaluateSqueezeRisk(crowded(), { dailyBars: RALLY }).score
        );
    });

    it('treats fewer than 21 bars as no price change and fewer than 25 as no volume ratio', () => {
        const short = dailyBars({ count: 21, firstClose: 10, lastClose: 15 });
        const score = evaluateSqueezeRisk(crowded(), { dailyBars: short });
        expect(component(score, 'price_change_20d')?.value).toBe(50);
        expect(score.missing).toContain('volume_ratio');
        const tooShort = evaluateSqueezeRisk(crowded(), {
            dailyBars: short.slice(1),
        });
        expect(tooShort.missing).toContain('price_change_20d');
    });
});

describe('evaluateSqueezeRisk — stale bars', () => {
    /** The RALLY bars shifted so the newest completed bar is `age` days before the reference day. */
    function barsAged(age: number) {
        return RALLY.map((b, i) => ({
            ...b,
            date: daysBeforeAsOf(age + RALLY.length - 1 - i),
        }));
    }

    it('uses bars whose newest session is exactly the max age old', () => {
        const score = evaluateSqueezeRisk(crowded(), {
            dailyBars: barsAged(SQUEEZE_MAX_BAR_AGE_DAYS),
        });
        expect(score.missing).not.toContain('price_change_20d');
        expect(score.lastBarDate).toBe(
            daysBeforeAsOf(SQUEEZE_MAX_BAR_AGE_DAYS)
        );
    });

    it('drops both price inputs when the newest bar is one day older', () => {
        const score = evaluateSqueezeRisk(crowded(), {
            dailyBars: barsAged(SQUEEZE_MAX_BAR_AGE_DAYS + 1),
        });
        expect(score.missing).toEqual(
            expect.arrayContaining(['price_change_20d', 'volume_ratio'])
        );
        expect(component(score, 'price_change_20d')).toBeUndefined();
        expect(score.lastBarDate).toBeNull();
        // Short-side inputs still score.
        expect(score.sufficiency).toBe('partial');
        expect(score.score).not.toBeNull();
    });
});

describe('evaluateSqueezeRisk — missing data', () => {
    it('is insufficient without any short-side input, whatever the price did', () => {
        const score = evaluateSqueezeRisk(emptySnapshot(), {
            dailyBars: RALLY,
        });
        expect(score.sufficiency).toBe('insufficient');
        expect(score.score).toBeNull();
        expect(score.level).toBeNull();
        expect(score.components).toEqual([]);
    });

    it('caps the level at elevated when only fails and price remain', () => {
        // FINRA off: 0.75% of shares outstanding failing into a 60% rally.
        const score = evaluateSqueezeRisk(
            crowded({ failsToDeliver: [ftdPoint({ failsQty: 300_000 })] }),
            { dailyBars: RALLY },
            { includeFinraData: false }
        );
        expect(score.levelCapped).toBe(true);
        expect(score.level).toBe('elevated');
        expect(score.score).toBeGreaterThanOrEqual(SQUEEZE_LEVEL_CUTOFFS.high);
        expect(score.includesFinra).toBe(false);
    });

    it('does not mark a low score as capped', () => {
        const score = evaluateSqueezeRisk(
            crowded({ failsToDeliver: [] }),
            { dailyBars: dailyBars({ count: 25 }) },
            { includeFinraData: false }
        );
        expect(score.level).toBe('low');
        expect(score.levelCapped).toBe(false);
    });

    it('counts a present FTD feed with no recent fail day as zero fails', () => {
        const score = evaluateSqueezeRisk(crowded({ failsToDeliver: [] }), {
            dailyBars: [],
        });
        expect(component(score, 'fails_to_deliver_pct')?.value).toBe(0);
    });

    it('drops the threshold-list input when the lists are excluded', () => {
        const listed = crowded({
            thresholdList: {
                listed: true,
                consecutiveDays: 5,
                firstListedDate: daysBeforeAsOf(7),
                markets: ['NYSE'],
            },
        });
        const score = evaluateSqueezeRisk(
            listed,
            { dailyBars: [] },
            { includeExchangeLists: false }
        );
        expect(score.includesExchangeLists).toBe(false);
        expect(score.missing).toContain('threshold_list_days');
    });

    it('reads a not-listed status as zero days', () => {
        const score = evaluateSqueezeRisk(
            crowded({
                thresholdList: {
                    listed: false,
                    consecutiveDays: 0,
                    firstListedDate: null,
                    markets: [],
                },
            }),
            { dailyBars: [] }
        );
        expect(component(score, 'threshold_list_days')?.value).toBe(0);
    });

    it('skips stale FINRA settlements like the short axis does', () => {
        const stale = crowded({
            shortInterest: [
                shortInterestPoint({
                    settlementDate: daysBeforeAsOf(90),
                    shortQty: 9_000_000,
                    daysToCover: 10,
                }),
            ],
        });
        const score = evaluateSqueezeRisk(stale, { dailyBars: RALLY });
        expect(score.includesFinra).toBe(false);
        expect(score.sufficiency).toBe('insufficient');
    });
});

describe('evaluateSqueezeRisk — levels and reference date', () => {
    it('reads a crowded book without a rally as high, not extreme', () => {
        const flat = dailyBars({ count: 25 });
        const score = evaluateSqueezeRisk(crowded(), { dailyBars: flat });
        expect(score.level).toBe('high');
    });

    it('takes options.asOf over snapshot.asOf', () => {
        const score = evaluateSqueezeRisk(
            crowded(),
            { dailyBars: RALLY },
            { asOf: daysBeforeAsOf(3) }
        );
        expect(score.asOf).toBe(daysBeforeAsOf(3));
        expect(score.lastBarDate).toBe(daysBeforeAsOf(4));
    });

    it('is deterministic and does not mutate its inputs', () => {
        const snapshot = crowded();
        const bars = RALLY.map(b => ({ ...b }));
        const before = JSON.stringify([snapshot, bars]);
        const a = evaluateSqueezeRisk(snapshot, { dailyBars: bars });
        const b = evaluateSqueezeRisk(snapshot, { dailyBars: bars });
        expect(a).toEqual(b);
        expect(JSON.stringify([snapshot, bars])).toBe(before);
    });

    it('uses no bars with an unusable reference day', () => {
        const score = evaluateSqueezeRisk(crowded({ asOf: 'nope' }), {
            dailyBars: RALLY,
        });
        expect(score.asOf).toBeNull();
        expect(score.lastBarDate).toBeNull();
    });
});
