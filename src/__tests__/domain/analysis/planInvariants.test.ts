import { describe, expect, it } from 'vitest';
import { checkPlanInvariants } from '@/domain/analysis/planInvariants';
import type { ActionRecommendation, PlanCheck } from '@/domain/types';

const LAST_CLOSE = 100;

function planCheck(overrides: Partial<PlanCheck> = {}): PlanCheck {
    return {
        currentPrice: LAST_CLOSE,
        entryZoneTop: 101,
        exceedsEntryZone: false,
        belowStopLoss: false,
        riskRewardAtEntry: 2,
        riskRewardAtCurrent: 1.5,
        ...overrides,
    };
}

/** A plan that satisfies every rule; each test breaks exactly one thing. */
function plan(
    overrides: Partial<ActionRecommendation> = {}
): ActionRecommendation {
    return {
        positionAnalysis: '',
        entry: '',
        exit: '',
        riskReward: '',
        entryRecommendation: 'enter',
        entryPrices: [99, 101],
        stopLoss: 95,
        takeProfitPrices: [105, 110],
        planCheck: planCheck(),
        ...overrides,
    };
}

const ids = (rec: ActionRecommendation | undefined) =>
    checkPlanInvariants(rec, LAST_CLOSE).map(violation => violation.id);

describe('checkPlanInvariants', () => {
    it('returns nothing for a plan that holds every rule', () => {
        expect(ids(plan())).toEqual([]);
    });

    it('returns nothing without a recommendation', () => {
        expect(ids(undefined)).toEqual([]);
    });

    it('applies no zone rule when the plan has no usable entry price', () => {
        expect(
            ids(plan({ entryPrices: [], stopLoss: 500, takeProfitPrices: [1] }))
        ).toEqual([]);
        expect(
            ids(
                plan({
                    entryPrices: [0, Number.NaN],
                    stopLoss: 500,
                    takeProfitPrices: [1],
                })
            )
        ).toEqual([]);
    });

    describe('finite', () => {
        it('flags a non-finite or non-positive entry price', () => {
            expect(ids(plan({ entryPrices: [99, 0, 101] }))).toEqual([
                'finite',
            ]);
        });

        it('flags a non-positive effective target', () => {
            expect(ids(plan({ takeProfitPrices: [-2, 105] }))).toContain(
                'finite'
            );
        });

        it('flags a stop whose every candidate is unusable', () => {
            expect(ids(plan({ stopLoss: Number.NaN }))).toEqual(['finite']);
        });

        it('judges the reconciled stop the plan check measured against, even when it is unusable', () => {
            const reconciledLevels = {
                exit: '',
                riskReward: '',
                reason: '',
            };
            expect(
                ids(
                    plan({
                        stopLoss: 95,
                        reconciledLevels: { ...reconciledLevels, stopLoss: 0 },
                    })
                )
            ).toEqual(['finite']);
            expect(
                ids(
                    plan({
                        stopLoss: 95,
                        reconciledLevels: {
                            ...reconciledLevels,
                            stopLoss: Number.NaN,
                        },
                    })
                )
            ).toEqual(['finite']);
        });

        it('treats a rejected stop as no stop at all', () => {
            expect(
                ids(
                    plan({
                        stopLoss: 120,
                        reconciledLevels: {
                            exit: '',
                            riskReward: '',
                            reason: '',
                            stopLossRejected: true,
                        },
                    })
                )
            ).toEqual([]);
        });
    });

    describe('stop_below_zone', () => {
        it('flags a stop inside the zone', () => {
            expect(ids(plan({ stopLoss: 100 }))).toEqual(['stop_below_zone']);
        });

        it('flags a stop at the zone low (inclusive boundary)', () => {
            expect(ids(plan({ stopLoss: 99 }))).toEqual(['stop_below_zone']);
        });

        it('accepts a stop just below the zone low', () => {
            expect(ids(plan({ stopLoss: 98.99 }))).toEqual([]);
        });

        it('flags a stop above the zone', () => {
            expect(ids(plan({ stopLoss: 120 }))).toEqual(['stop_below_zone']);
        });

        it('judges a reversed entry array by its min', () => {
            expect(ids(plan({ entryPrices: [101, 99], stopLoss: 98 }))).toEqual(
                []
            );
        });

        it('reads the reconciled stop before the model stop', () => {
            expect(
                ids(
                    plan({
                        stopLoss: 120,
                        reconciledLevels: {
                            stopLoss: 95,
                            exit: '',
                            riskReward: '',
                            reason: '',
                        },
                    })
                )
            ).toEqual([]);
        });

        it('is silent when the plan has no stop', () => {
            expect(ids(plan({ stopLoss: undefined }))).toEqual([]);
        });
    });

    describe('targets_above_zone', () => {
        it('flags a target at the zone high (inclusive boundary)', () => {
            expect(ids(plan({ takeProfitPrices: [101, 105] }))).toEqual([
                'targets_above_zone',
            ]);
        });

        it('flags a target inside the zone', () => {
            expect(ids(plan({ takeProfitPrices: [100, 105] }))).toEqual([
                'targets_above_zone',
            ]);
        });

        it('accepts a target just above the zone high', () => {
            expect(ids(plan({ takeProfitPrices: [101.01, 105] }))).toEqual([]);
        });

        it('judges the reconciled targets when that array exists', () => {
            expect(
                ids(
                    plan({
                        takeProfitPrices: [50, 105],
                        reconciledLevels: {
                            takeProfitPrices: [105],
                            exit: '',
                            riskReward: '',
                            reason: '',
                        },
                    })
                )
            ).toEqual([]);
        });
    });

    describe('targets_ascending', () => {
        it('flags descending targets', () => {
            expect(ids(plan({ takeProfitPrices: [110, 105] }))).toEqual([
                'targets_ascending',
            ]);
        });

        it('flags a duplicated target (strictly ascending)', () => {
            expect(ids(plan({ takeProfitPrices: [105, 105] }))).toEqual([
                'targets_ascending',
            ]);
        });

        it('accepts no target and a single target', () => {
            expect(ids(plan({ takeProfitPrices: [] }))).toEqual([]);
            expect(ids(plan({ takeProfitPrices: undefined }))).toEqual([]);
            expect(ids(plan({ takeProfitPrices: [105] }))).toEqual([]);
        });
    });

    describe('reconciled_subset', () => {
        it('flags a reconciled target the model never wrote', () => {
            expect(
                ids(
                    plan({
                        takeProfitPrices: [105, 110],
                        reconciledLevels: {
                            takeProfitPrices: [105, 111],
                            exit: '',
                            riskReward: '',
                            reason: '',
                        },
                    })
                )
            ).toEqual(['reconciled_subset']);
        });

        it('accepts a reconciled array that drops model targets', () => {
            expect(
                ids(
                    plan({
                        takeProfitPrices: [90, 105, 110],
                        reconciledLevels: {
                            takeProfitPrices: [105, 110],
                            exit: '',
                            riskReward: '',
                            reason: '',
                        },
                    })
                )
            ).toEqual([]);
        });

        it('flags reconciled targets when the model wrote none', () => {
            expect(
                ids(
                    plan({
                        takeProfitPrices: undefined,
                        reconciledLevels: {
                            takeProfitPrices: [105],
                            exit: '',
                            riskReward: '',
                            reason: '',
                        },
                    })
                )
            ).toEqual(['reconciled_subset']);
        });
    });

    describe('plan_check_consistent', () => {
        it('flags a missing planCheck', () => {
            expect(ids(plan({ planCheck: undefined }))).toEqual([
                'plan_check_consistent',
            ]);
        });

        it('flags a currentPrice that is not the last close', () => {
            expect(
                ids(plan({ planCheck: planCheck({ currentPrice: 99.5 }) }))
            ).toEqual(['plan_check_consistent']);
        });

        it('flags an entryZoneTop that is not the zone high', () => {
            expect(
                ids(plan({ planCheck: planCheck({ entryZoneTop: 99 }) }))
            ).toEqual(['plan_check_consistent']);
            expect(
                ids(plan({ planCheck: planCheck({ entryZoneTop: null }) }))
            ).toEqual(['plan_check_consistent']);
        });

        it('flags a negative or non-finite risk:reward', () => {
            expect(
                ids(plan({ planCheck: planCheck({ riskRewardAtEntry: -0.1 }) }))
            ).toEqual(['plan_check_consistent']);
            expect(
                ids(
                    plan({
                        planCheck: planCheck({
                            riskRewardAtCurrent: Number.POSITIVE_INFINITY,
                        }),
                    })
                )
            ).toEqual(['plan_check_consistent']);
        });

        it('accepts null and zero risk:reward', () => {
            expect(
                ids(
                    plan({
                        planCheck: planCheck({
                            riskRewardAtEntry: null,
                            riskRewardAtCurrent: 0,
                        }),
                    })
                )
            ).toEqual([]);
        });
    });

    describe('avoid_untouched', () => {
        const reconciledLevels = {
            stopLoss: 95,
            exit: '',
            riskReward: '',
            reason: '',
        };

        it('flags reconciledLevels on an avoid verdict', () => {
            expect(
                ids(plan({ entryRecommendation: 'avoid', reconciledLevels }))
            ).toEqual(['avoid_untouched']);
        });

        it('applies no other rule to an avoid verdict', () => {
            expect(
                ids(
                    plan({
                        entryRecommendation: 'avoid',
                        stopLoss: 500,
                        takeProfitPrices: [1],
                        planCheck: undefined,
                    })
                )
            ).toEqual([]);
        });
    });

    it('reports every rule a plan breaks, each with a detail', () => {
        const violations = checkPlanInvariants(
            plan({
                stopLoss: 100,
                takeProfitPrices: [110, 100],
                planCheck: undefined,
            }),
            LAST_CLOSE
        );
        expect(violations.map(violation => violation.id)).toEqual([
            'stop_below_zone',
            'targets_above_zone',
            'targets_ascending',
            'plan_check_consistent',
        ]);
        expect(violations.every(violation => violation.detail !== '')).toBe(
            true
        );
    });
});
