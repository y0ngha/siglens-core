import { describe, expect, expectTypeOf, it } from 'vitest';
import { buildPlanCheck } from '@/domain/analysis/planCheck';
import { buildPlanState } from '@/domain/analysis/planState';
import {
    alertablePlanLevels,
    findPriceLevelTrigger,
    isPriceLevelMet,
    priceLevelStart,
    type PriceLevelCondition,
    type PriceLevelTrigger,
    type PriceLevelZoneTrigger,
} from '@/domain/analysis/priceLevelAlert';
import type {
    ActionRecommendation,
    Bar,
    ReconciledActionLevels,
} from '@/domain/types';

const rec = (
    over: Partial<ActionRecommendation> = {}
): ActionRecommendation => ({
    positionAnalysis: '',
    entry: '',
    exit: '',
    riskReward: '',
    entryPrices: [100, 110],
    stopLoss: 90,
    takeProfitPrices: [130],
    ...over,
});

const reconciled = (
    levels: Partial<ReconciledActionLevels>
): ReconciledActionLevels => ({
    exit: '',
    riskReward: '',
    reason: '',
    ...levels,
});

const bar = (time: number, close: number): Bar => ({
    time,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
});

type ZoneCondition = Extract<PriceLevelCondition, { kind: 'enter_zone' }>;

const zoneFromAbove: ZoneCondition = {
    kind: 'enter_zone',
    low: 100,
    high: 110,
    approach: 'from_above',
};
const zoneFromBelow: ZoneCondition = {
    ...zoneFromAbove,
    approach: 'from_below',
};

describe('alertablePlanLevels', () => {
    it('reads the zone edges and the model stop', () => {
        expect(alertablePlanLevels(rec())).toEqual({
            entryZone: { low: 100, high: 110 },
            invalidation: 90,
        });
    });

    it('reads the zone regardless of the order entryPrices came in', () => {
        expect(
            alertablePlanLevels(rec({ entryPrices: [110, 100] })).entryZone
        ).toEqual({ low: 100, high: 110 });
    });

    it('turns a single entry price into a zone with equal edges', () => {
        expect(
            alertablePlanLevels(rec({ entryPrices: [105] })).entryZone
        ).toEqual({ low: 105, high: 105 });
    });

    it('ignores non-finite and non-positive entry prices', () => {
        expect(
            alertablePlanLevels(
                rec({ entryPrices: [NaN, -5, 0, 100, Infinity] })
            ).entryZone
        ).toEqual({ low: 100, high: 100 });
    });

    it('returns a null zone without a usable entry price', () => {
        expect(
            alertablePlanLevels(rec({ entryPrices: [NaN, 0] })).entryZone
        ).toBeNull();
        expect(
            alertablePlanLevels(rec({ entryPrices: undefined })).entryZone
        ).toBeNull();
        expect(
            alertablePlanLevels(rec({ entryPrices: [] })).entryZone
        ).toBeNull();
    });

    it('prefers the reconciled stop over the model stop', () => {
        expect(
            alertablePlanLevels(
                rec({
                    stopLoss: 95,
                    reconciledLevels: reconciled({ stopLoss: 88 }),
                })
            ).invalidation
        ).toBe(88);
    });

    it('drops a stop the reconciliation rejected, even when the model gave one', () => {
        expect(
            alertablePlanLevels(
                rec({
                    stopLoss: 90,
                    reconciledLevels: reconciled({ stopLossRejected: true }),
                })
            ).invalidation
        ).toBeNull();
    });

    it('returns a null invalidation when there is no stop', () => {
        expect(
            alertablePlanLevels(rec({ stopLoss: undefined })).invalidation
        ).toBeNull();
    });

    it('keeps a stop just below the zone low and drops one at or above it', () => {
        expect(alertablePlanLevels(rec({ stopLoss: 99.99 })).invalidation).toBe(
            99.99
        );
        expect(
            alertablePlanLevels(rec({ stopLoss: 100 })).invalidation
        ).toBeNull();
        expect(
            alertablePlanLevels(rec({ stopLoss: 105 })).invalidation
        ).toBeNull();
        expect(
            alertablePlanLevels(rec({ stopLoss: 120 })).invalidation
        ).toBeNull();
    });

    it('judges a reconciled stop (not the model one) against the zone', () => {
        expect(
            alertablePlanLevels(
                rec({
                    stopLoss: 90,
                    reconciledLevels: reconciled({ stopLoss: 100 }),
                })
            ).invalidation
        ).toBeNull();
    });

    it('keeps any positive stop when there is no zone', () => {
        expect(
            alertablePlanLevels(rec({ entryPrices: undefined, stopLoss: 150 }))
        ).toEqual({ entryZone: null, invalidation: 150 });
    });

    it('rejects non-finite and non-positive stops', () => {
        for (const stopLoss of [NaN, Infinity, 0, -3]) {
            expect(
                alertablePlanLevels(rec({ stopLoss })).invalidation
            ).toBeNull();
            expect(
                alertablePlanLevels(rec({ entryPrices: undefined, stopLoss }))
                    .invalidation
            ).toBeNull();
        }
    });

    it('does not fall back to the model stop when the reconciled one is unusable', () => {
        expect(
            alertablePlanLevels(
                rec({
                    stopLoss: 90,
                    reconciledLevels: reconciled({ stopLoss: NaN }),
                })
            ).invalidation
        ).toBeNull();
    });
});

describe('priceLevelStart', () => {
    it('anchors a zone from above when the close is above it', () => {
        expect(
            priceLevelStart(120, { kind: 'zone', low: 100, high: 110 })
        ).toEqual({ ok: true, condition: zoneFromAbove });
    });

    it('anchors a zone from below when the close is below it', () => {
        expect(
            priceLevelStart(95, { kind: 'zone', low: 100, high: 110 })
        ).toEqual({ ok: true, condition: zoneFromBelow });
    });

    it('reports inside for a close in the zone, edges included', () => {
        for (const close of [100, 105, 110]) {
            expect(
                priceLevelStart(close, { kind: 'zone', low: 100, high: 110 })
            ).toEqual({ ok: false, reason: 'inside' });
        }
    });

    it('treats a one-price zone as inside only at that price', () => {
        const target = { kind: 'zone', low: 105, high: 105 } as const;
        expect(priceLevelStart(105, target)).toEqual({
            ok: false,
            reason: 'inside',
        });
        expect(priceLevelStart(105.01, target).ok).toBe(true);
    });

    it('is invalid for a zone whose low is above its high', () => {
        expect(
            priceLevelStart(120, { kind: 'zone', low: 110, high: 100 })
        ).toEqual({ ok: false, reason: 'invalid' });
    });

    it('is invalid for non-finite or non-positive zone edges', () => {
        for (const [low, high] of [
            [NaN, 110],
            [100, NaN],
            [0, 110],
            [-1, 110],
            [100, Infinity],
        ] as const) {
            expect(priceLevelStart(120, { kind: 'zone', low, high })).toEqual({
                ok: false,
                reason: 'invalid',
            });
        }
    });

    it('makes close_below only when the close is strictly above the level', () => {
        expect(priceLevelStart(100.01, { kind: 'below', level: 100 })).toEqual({
            ok: true,
            condition: { kind: 'close_below', level: 100 },
        });
        expect(priceLevelStart(100, { kind: 'below', level: 100 })).toEqual({
            ok: false,
            reason: 'met',
        });
        expect(priceLevelStart(90, { kind: 'below', level: 100 })).toEqual({
            ok: false,
            reason: 'met',
        });
    });

    it('makes close_above only when the close is strictly below the level', () => {
        expect(priceLevelStart(99.99, { kind: 'above', level: 100 })).toEqual({
            ok: true,
            condition: { kind: 'close_above', level: 100 },
        });
        expect(priceLevelStart(100, { kind: 'above', level: 100 })).toEqual({
            ok: false,
            reason: 'met',
        });
        expect(priceLevelStart(110, { kind: 'above', level: 100 })).toEqual({
            ok: false,
            reason: 'met',
        });
    });

    it('is invalid for an unusable close', () => {
        for (const close of [NaN, Infinity, 0, -1]) {
            expect(
                priceLevelStart(close, { kind: 'below', level: 100 })
            ).toEqual({ ok: false, reason: 'invalid' });
            expect(
                priceLevelStart(close, { kind: 'zone', low: 100, high: 110 })
            ).toEqual({ ok: false, reason: 'invalid' });
        }
    });

    it('is invalid for an unusable level', () => {
        for (const level of [NaN, Infinity, 0, -5]) {
            expect(priceLevelStart(100, { kind: 'above', level })).toEqual({
                ok: false,
                reason: 'invalid',
            });
            expect(priceLevelStart(100, { kind: 'below', level })).toEqual({
                ok: false,
                reason: 'invalid',
            });
        }
    });
});

describe('isPriceLevelMet', () => {
    it('zone from_above: met at or below the top, edges included', () => {
        expect(isPriceLevelMet(110.01, zoneFromAbove)).toBe(false);
        expect(isPriceLevelMet(110, zoneFromAbove)).toBe(true);
        expect(isPriceLevelMet(105, zoneFromAbove)).toBe(true);
        expect(isPriceLevelMet(100, zoneFromAbove)).toBe(true);
    });

    it('zone from_above: a gap down through the whole zone still counts', () => {
        expect(isPriceLevelMet(80, zoneFromAbove)).toBe(true);
    });

    it('zone from_below: met at or above the low, edges included', () => {
        expect(isPriceLevelMet(99.99, zoneFromBelow)).toBe(false);
        expect(isPriceLevelMet(100, zoneFromBelow)).toBe(true);
        expect(isPriceLevelMet(110, zoneFromBelow)).toBe(true);
    });

    it('zone from_below: a gap up through the whole zone still counts', () => {
        expect(isPriceLevelMet(140, zoneFromBelow)).toBe(true);
    });

    it('close_below: met at or below the level', () => {
        const c: PriceLevelCondition = { kind: 'close_below', level: 100 };
        expect(isPriceLevelMet(100.01, c)).toBe(false);
        expect(isPriceLevelMet(100, c)).toBe(true);
        expect(isPriceLevelMet(60, c)).toBe(true);
    });

    it('close_above: met at or above the level', () => {
        const c: PriceLevelCondition = { kind: 'close_above', level: 100 };
        expect(isPriceLevelMet(99.99, c)).toBe(false);
        expect(isPriceLevelMet(100, c)).toBe(true);
        expect(isPriceLevelMet(160, c)).toBe(true);
    });

    it('never meets any condition on a zero or negative close (bad data, not a price)', () => {
        for (const c of [
            zoneFromAbove,
            zoneFromBelow,
            { kind: 'close_below', level: 100 } as const,
            { kind: 'close_above', level: 100 } as const,
        ]) {
            expect(isPriceLevelMet(0, c)).toBe(false);
            expect(isPriceLevelMet(-5, c)).toBe(false);
        }
    });

    it('never meets any condition on a non-finite close', () => {
        for (const c of [
            zoneFromAbove,
            zoneFromBelow,
            { kind: 'close_below', level: 100 } as const,
            { kind: 'close_above', level: 100 } as const,
        ]) {
            expect(isPriceLevelMet(NaN, c)).toBe(false);
            expect(isPriceLevelMet(-Infinity, c)).toBe(false);
            expect(isPriceLevelMet(Infinity, c)).toBe(false);
        }
    });
});

describe('findPriceLevelTrigger', () => {
    const below: PriceLevelCondition = { kind: 'close_below', level: 100 };

    it('returns null for no bars', () => {
        expect(findPriceLevelTrigger([], below)).toBeNull();
    });

    it('returns null when no close meets the condition', () => {
        expect(
            findPriceLevelTrigger([bar(1, 105), bar(2, 101)], below)
        ).toBeNull();
    });

    it('returns the first of several meeting bars with its index, time and close', () => {
        expect(
            findPriceLevelTrigger(
                [bar(10, 105), bar(20, 99), bar(30, 90), bar(40, 80)],
                below
            )
        ).toEqual({ index: 1, time: 20, close: 99 });
    });

    it('fires on a tie at the level', () => {
        expect(
            findPriceLevelTrigger([bar(1, 101), bar(2, 100)], below)
        ).toEqual({
            index: 1,
            time: 2,
            close: 100,
        });
    });

    it('skips a non-finite close and keeps searching', () => {
        expect(
            findPriceLevelTrigger(
                [bar(1, NaN), bar(2, -Infinity), bar(3, 105), bar(4, 95)],
                below
            )
        ).toEqual({ index: 3, time: 4, close: 95 });
        expect(findPriceLevelTrigger([bar(1, NaN)], below)).toBeNull();
    });

    it('skips a zero or negative close bar and fires on a later real one', () => {
        expect(
            findPriceLevelTrigger([bar(1, 0), bar(2, -3), bar(3, 95)], below)
        ).toEqual({ index: 2, time: 3, close: 95 });
        expect(findPriceLevelTrigger([bar(1, 0)], below)).toBeNull();
    });

    it('reports the zone position of the triggering close, edges included', () => {
        const at = (close: number, c: ZoneCondition) =>
            findPriceLevelTrigger([bar(1, close)], c)?.position;
        expect(at(110, zoneFromAbove)).toBe('inside');
        expect(at(100, zoneFromAbove)).toBe('inside');
        expect(at(99.99, zoneFromAbove)).toBe('below');
        expect(at(100, zoneFromBelow)).toBe('inside');
        expect(at(110, zoneFromBelow)).toBe('inside');
        expect(at(110.01, zoneFromBelow)).toBe('above');
    });

    it('carries no position for level conditions', () => {
        const hit = findPriceLevelTrigger([bar(1, 95)], below);
        expect(hit).not.toBeNull();
        expect(hit).not.toHaveProperty('position');
    });

    it('types an enter_zone result with a required position and a level result without one', () => {
        const zone = findPriceLevelTrigger([bar(1, 105)], zoneFromAbove);
        expectTypeOf(zone).toEqualTypeOf<PriceLevelZoneTrigger | null>();
        if (zone !== null) {
            expectTypeOf(zone.position).toEqualTypeOf<
                'inside' | 'below' | 'above'
            >();
        }
        const level = findPriceLevelTrigger([bar(1, 95)], below);
        expectTypeOf(level).toEqualTypeOf<PriceLevelTrigger | null>();
        if (level !== null) {
            // @ts-expect-error a level trigger carries no zone position
            void level.position;
        }
    });

    it('does not read highs or lows: a wick through the level is not a close', () => {
        const wick: Bar = { ...bar(1, 105), low: 80 };
        expect(findPriceLevelTrigger([wick], below)).toBeNull();
    });

    it('counts a zone entered by a gap through it', () => {
        expect(
            findPriceLevelTrigger(
                [bar(1, 120), bar(2, 115), bar(3, 90)],
                zoneFromAbove
            )
        ).toEqual({ index: 2, time: 3, close: 90, position: 'below' });
        expect(
            findPriceLevelTrigger([bar(1, 90), bar(2, 130)], zoneFromBelow)
        ).toEqual({ index: 1, time: 2, close: 130, position: 'above' });
    });

    it('does not mutate the bars it is given', () => {
        const bars = [bar(1, 105), bar(2, 99)];
        const snapshot = structuredClone(bars);
        findPriceLevelTrigger(bars, below);
        expect(bars).toEqual(snapshot);
    });
});

describe('agreement with the plan state (same tie rules)', () => {
    const CLOSES = [
        150, 130, 120, 110.01, 110, 109.99, 105.01, 105, 104.99, 100.01, 100,
        99.99, 95, 90.01, 90, 89.99, 70,
    ];
    const stateOf = (plan: ActionRecommendation, close: number) => {
        const check = buildPlanCheck(plan, close, 105);
        if (check === null) throw new Error('plan check expected');
        return buildPlanState(plan, check, null);
    };
    const fromAboveOf = (plan: ActionRecommendation): PriceLevelCondition => {
        const { entryZone } = alertablePlanLevels(plan);
        if (entryZone === null) throw new Error('zone expected');
        return { kind: 'enter_zone', ...entryZone, approach: 'from_above' };
    };
    const fromBelowOf = (plan: ActionRecommendation): PriceLevelCondition => {
        const { entryZone } = alertablePlanLevels(plan);
        if (entryZone === null) throw new Error('zone expected');
        return { kind: 'enter_zone', ...entryZone, approach: 'from_below' };
    };

    const PLANS: ReadonlyArray<readonly [string, ActionRecommendation]> = [
        ['a range zone', rec()],
        ['a single-price zone', rec({ entryPrices: [105] })],
        [
            'a reconciled-stop plan',
            rec({
                stopLoss: 70,
                reconciledLevels: reconciled({ stopLoss: 90 }),
            }),
        ],
        [
            'a plan whose entry prices came in reversed',
            rec({ entryPrices: [110, 100] }),
        ],
    ];

    describe.each(PLANS)('%s', (_name, plan) => {
        const zone = alertablePlanLevels(plan).entryZone;
        const low = zone?.low ?? 0;
        const stop = alertablePlanLevels(plan).invalidation ?? 0;

        it('is read by the state machine as a real setup', () => {
            expect(stateOf(plan, (low + (zone?.high ?? 0)) / 2).position).toBe(
                'in_zone'
            );
        });

        it('from_above is met exactly when the plan is in_zone, for closes at or above the zone low', () => {
            for (const close of CLOSES.filter(c => c >= low)) {
                expect(isPriceLevelMet(close, fromAboveOf(plan))).toBe(
                    stateOf(plan, close).position === 'in_zone'
                );
            }
        });

        it('from_below is met exactly when the plan is in_zone or above_zone, for closes at or above the zone low', () => {
            for (const close of CLOSES.filter(c => c >= low)) {
                const { position } = stateOf(plan, close);
                expect(isPriceLevelMet(close, fromBelowOf(plan))).toBe(
                    position === 'in_zone' || position === 'above_zone'
                );
            }
        });

        it('a close past the zone low meets from_above although the plan reads below_zone (documented difference)', () => {
            const close = (low + stop) / 2 + (low - stop) / 4;
            expect(close).toBeGreaterThan(stop);
            expect(close).toBeLessThan(low);
            expect(stateOf(plan, close).position).toBe('below_zone');
            expect(isPriceLevelMet(close, fromAboveOf(plan))).toBe(true);
        });

        it('the invalidation alert fires exactly when the plan is stopped', () => {
            const condition: PriceLevelCondition = {
                kind: 'close_below',
                level: stop,
            };
            for (const close of CLOSES) {
                const state = stateOf(plan, close);
                expect(isPriceLevelMet(close, condition)).toBe(
                    state.position === 'no_setup' && state.reason === 'stopped'
                );
            }
        });
    });

    it('a plan with no zone has no alertable zone although the state machine still reads it (documented difference)', () => {
        const plan = rec({ entryPrices: undefined });
        expect(alertablePlanLevels(plan).entryZone).toBeNull();
        // The stop is still a level an alert can watch, though the plan state
        // stops at `no_zone` before it reads the stop.
        expect(alertablePlanLevels(plan).invalidation).toBe(90);
        expect(isPriceLevelMet(90, { kind: 'close_below', level: 90 })).toBe(
            true
        );
        for (const close of [105, 90, 80]) {
            expect(stateOf(plan, close)).toMatchObject({
                position: 'no_setup',
                reason: 'no_zone',
            });
        }
    });
});
