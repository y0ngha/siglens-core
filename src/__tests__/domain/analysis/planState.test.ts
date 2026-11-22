import { describe, expect, it } from 'vitest';
import {
    buildPlanCheck,
    ENTRY_ZONE_TOLERANCE,
    PLAN_MIN_ATR_SPACING,
} from '@/domain/analysis/planCheck';
import {
    buildPlanState,
    ENTRY_RECOMMENDATION_BY_POSITION,
} from '@/domain/analysis/planState';
import type {
    ActionRecommendation,
    PlanPosition,
    PlanState,
} from '@/domain/types';

const ATR = 2;
const ZONE_LOW = 98;
const ZONE_TOP = 102;
const STOP = 94;
const CLOSE = 100;

function rec(overrides: Partial<ActionRecommendation> = {}) {
    return {
        positionAnalysis: '',
        entry: '',
        exit: '',
        riskReward: '',
        entryPrices: [ZONE_LOW, ZONE_TOP],
        stopLoss: STOP,
        takeProfitPrices: [108, 112],
        ...overrides,
    } satisfies ActionRecommendation;
}

/** The state the way production builds it: the plan check of the same recommendation first. */
function stateOf(
    recommendation: ActionRecommendation,
    close: number = CLOSE,
    atr: number | null = ATR
): PlanState {
    const check = buildPlanCheck(recommendation, close, 100);
    if (check === null) throw new Error('fixture close must be usable');
    return buildPlanState(recommendation, check, atr);
}

describe('buildPlanState — one case per row of the state table', () => {
    it('row 1: no usable entry price is no_setup / no_zone', () => {
        expect(stateOf(rec({ entryPrices: [] }))).toMatchObject({
            position: 'no_setup',
            reason: 'no_zone',
            stopDistanceAtr: null,
        });
        expect(
            stateOf(rec({ entryPrices: [Number.NaN, 0, -3] }))
        ).toMatchObject({ position: 'no_setup', reason: 'no_zone' });
    });

    it('row 2: no effective stop is no_setup / no_stop, also when the model stop was rejected', () => {
        expect(stateOf(rec({ stopLoss: undefined }))).toMatchObject({
            position: 'no_setup',
            reason: 'no_stop',
            stopDistanceAtr: null,
            stopBasis: null,
        });
        expect(
            stateOf(
                rec({
                    reconciledLevels: {
                        stopLossRejected: true,
                        exit: '',
                        riskReward: '',
                        reason: '',
                    },
                })
            )
        ).toMatchObject({ position: 'no_setup', reason: 'no_stop' });
    });

    it('row 3: a close at or below the stop is no_setup / stopped (the boundary is inclusive)', () => {
        expect(stateOf(rec(), STOP)).toMatchObject({
            position: 'no_setup',
            reason: 'stopped',
        });
        expect(stateOf(rec(), STOP - 1)).toMatchObject({ reason: 'stopped' });
        expect(stateOf(rec(), STOP + 0.01).position).not.toBe('no_setup');
    });

    it('row 3 comes before row 4: a stopped plan with no room is stopped', () => {
        expect(stateOf(rec({ takeProfitPrices: [103] }), STOP)).toMatchObject({
            reason: 'stopped',
        });
    });

    it('row 4: no target one ATR above the zone top is no_setup / no_room_above, at the exact boundary', () => {
        const top = ZONE_TOP + PLAN_MIN_ATR_SPACING * ATR;
        expect(stateOf(rec({ takeProfitPrices: [top] })).position).not.toBe(
            'no_setup'
        );
        expect(
            stateOf(rec({ takeProfitPrices: [top - 0.01, 103] }))
        ).toMatchObject({ position: 'no_setup', reason: 'no_room_above' });
        expect(stateOf(rec({ takeProfitPrices: [] }))).toMatchObject({
            reason: 'no_room_above',
        });
    });

    it('row 4 reads the reconciled targets over the model ones', () => {
        const reconciledLevels = {
            takeProfitPrices: [103],
            exit: '',
            riskReward: '',
            reason: '',
        };
        expect(
            stateOf(rec({ takeProfitPrices: [120], reconciledLevels }))
        ).toMatchObject({ reason: 'no_room_above' });
    });

    it('row 4 without an ATR: any target above the zone top is room', () => {
        expect(
            stateOf(rec({ takeProfitPrices: [ZONE_TOP + 0.01] }), CLOSE, null)
                .position
        ).toBe('in_zone');
        expect(
            stateOf(rec({ takeProfitPrices: [ZONE_TOP] }), CLOSE, null)
        ).toMatchObject({ position: 'no_setup', reason: 'no_room_above' });
    });

    it('row 5: a close above the zone top by more than the tolerance is above_zone (the edge is inside)', () => {
        const edge = ZONE_TOP * (1 + ENTRY_ZONE_TOLERANCE);
        expect(stateOf(rec(), edge).position).toBe('in_zone');
        const above = stateOf(rec(), edge + 0.01);
        expect(above).toMatchObject({ position: 'above_zone' });
        expect(above).toHaveProperty('distanceAtr');
    });

    it('row 6: a close below the zone low by more than the tolerance is below_zone (the edge is inside)', () => {
        const edge = ZONE_LOW * (1 - ENTRY_ZONE_TOLERANCE);
        expect(stateOf(rec(), edge).position).toBe('in_zone');
        expect(stateOf(rec(), edge - 0.01).position).toBe('below_zone');
    });

    it('row 7: otherwise in_zone, with a zero distance', () => {
        expect(stateOf(rec())).toEqual({
            position: 'in_zone',
            atr: ATR,
            stopDistanceAtr: 2,
            stopBasis: 'model',
            distanceAtr: 0,
        });
    });
});

describe('buildPlanState — measurements', () => {
    it('reports the distance to the nearer zone edge in ATR at 2 decimals', () => {
        // 106.3 is 4.3 above the top 102 = 2.15 ATR.
        expect(stateOf(rec(), 106.3)).toMatchObject({
            position: 'above_zone',
            distanceAtr: 2.15,
        });
        // 95.7 is 2.3 below the low 98 = 1.15 ATR.
        expect(stateOf(rec(), 95.7)).toMatchObject({
            position: 'below_zone',
            distanceAtr: 1.15,
        });
    });

    it('reports the stop distance from the zone low, not the mid', () => {
        expect(stateOf(rec({ stopLoss: 93.3 }))).toMatchObject({
            stopDistanceAtr: 2.35,
        });
    });

    it.each([null, 0, -1, Number.NaN])(
        'has null distances and a null ATR when the ATR is %s',
        atr => {
            expect(stateOf(rec(), CLOSE, atr)).toMatchObject({
                position: 'in_zone',
                atr: null,
                stopDistanceAtr: null,
                distanceAtr: null,
            });
        }
    );

    it('differs for a live price: the state follows the plan check it is given', () => {
        const recommendation = rec();
        const stored = stateOf(recommendation, CLOSE);
        const live = stateOf(recommendation, 108);
        expect(stored.position).toBe('in_zone');
        expect(live.position).toBe('above_zone');
    });
});

describe('buildPlanState — where the stop came from', () => {
    const levels = (stopLoss: number, stopBasis?: 'level' | 'atr') => ({
        stopLoss,
        exit: '',
        riskReward: '',
        reason: '',
        ...(stopBasis === undefined ? {} : { stopBasis }),
    });

    it('is model when the model stop stands', () => {
        expect(stateOf(rec()).stopBasis).toBe('model');
    });

    it.each(['level', 'atr'] as const)(
        'is the stamped %s basis of a moved stop',
        basis => {
            expect(
                stateOf(rec({ reconciledLevels: levels(93, basis) })).stopBasis
            ).toBe(basis);
        }
    );

    it('is model when reconciled levels carry the model stop itself', () => {
        expect(stateOf(rec({ reconciledLevels: levels(STOP) })).stopBasis).toBe(
            'model'
        );
    });

    it('is null, not model, for a moved stop that carries no stamp (stored before the field existed)', () => {
        expect(
            stateOf(rec({ reconciledLevels: levels(93) })).stopBasis
        ).toBeNull();
    });
});

describe('ENTRY_RECOMMENDATION_BY_POSITION', () => {
    it('maps every position to the verdict the design names', () => {
        const positions: readonly PlanPosition[] = [
            'in_zone',
            'above_zone',
            'below_zone',
            'no_setup',
        ];
        expect(
            Object.keys(ENTRY_RECOMMENDATION_BY_POSITION).toSorted()
        ).toEqual([...positions].toSorted());
        expect(positions.map(p => ENTRY_RECOMMENDATION_BY_POSITION[p])).toEqual(
            ['enter', 'wait', 'wait', 'avoid']
        );
    });
});
