import { describe, expect, it } from 'vitest';
import {
    comparePlanRuns,
    forwardOf,
    invariantCounts,
    expectedStopOf,
    measurePlan,
    outcomesByPosition,
    planGates,
    printedSupports,
    quotedPrice,
    runCallStats,
    stateOf,
    summarizePlanRun,
    NO_SETUP_REASONS,
    PLAN_POSITIONS,
    VERDICT_BY_POSITION,
    type PairedPlanComparison,
    type PlanCase,
    type PlanMeasure,
    type PlanPosition,
    type RunCallStats,
} from '../../../../scripts/replay/analysisFieldsEvalPlan';
import { share } from '../../../../scripts/replay/analysisFieldsEvalCompute';
import { FIELDS_EVAL_CONSTANTS as C } from '../../../../scripts/replay/analysisFieldsEvalTypes';
import type { CaseResultFile } from '../../../../scripts/replay/types';
import { makeLabels, makeRow } from './replayFixtures';

/** A zone 98 to 100, stop 95 (2.5 ATR under the zone low at ATR 1.2), targets 104 and 108. */
const baseState = {
    zone: [98, 100],
    stop: 95,
    targets: [104, 108],
    close: 99,
    atr: 1.2,
};

describe('stateOf: the table, first match wins', () => {
    it('row 1: no usable entry price is no_setup / no_zone, before anything else', () => {
        expect(stateOf({ ...baseState, zone: [], stop: null })).toEqual({
            position: 'no_setup',
            reason: 'no_zone',
        });
    });

    it('row 2: no effective stop is no_setup / no_stop', () => {
        expect(stateOf({ ...baseState, stop: null })).toEqual({
            position: 'no_setup',
            reason: 'no_stop',
        });
    });

    it('row 3: a close at or under the stop is stopped, and one tick above is not', () => {
        expect(stateOf({ ...baseState, close: 95 })).toEqual({
            position: 'no_setup',
            reason: 'stopped',
        });
        expect(
            stateOf({ ...baseState, close: 95.01, zone: [95.5, 96] }).reason
        ).toBeNull();
    });

    it('row 4: a target exactly 1 ATR above the zone top has room, just below has none', () => {
        const exactly = 100 + C.planMinAtrSpacing * 1.2;
        expect(stateOf({ ...baseState, targets: [exactly] }).position).toBe(
            'in_zone'
        );
        expect(stateOf({ ...baseState, targets: [exactly - 0.001] })).toEqual({
            position: 'no_setup',
            reason: 'no_room_above',
        });
    });

    it('row 4 without an ATR needs only a target above the zone top', () => {
        expect(
            stateOf({ ...baseState, atr: null, targets: [100.01] }).position
        ).toBe('in_zone');
        expect(
            stateOf({ ...baseState, atr: null, targets: [100] }).reason
        ).toBe('no_room_above');
    });

    it('row 5: above the zone beyond the top, with no tolerance band', () => {
        expect(stateOf({ ...baseState, close: 100 }).position).toBe('in_zone');
        expect(stateOf({ ...baseState, close: 100.01 }).position).toBe(
            'above_zone'
        );
        expect(stateOf({ ...baseState, close: 101 }).position).toBe(
            'above_zone'
        );
    });

    it('row 6: below the zone beyond the low, with no tolerance band', () => {
        expect(stateOf({ ...baseState, close: 98 }).position).toBe('in_zone');
        expect(stateOf({ ...baseState, close: 97.99 }).position).toBe(
            'below_zone'
        );
    });

    it('row 7: a close inside the zone is in_zone', () => {
        expect(stateOf(baseState)).toEqual({
            position: 'in_zone',
            reason: null,
        });
    });

    it('takes the zone from the lowest and highest price, in any order', () => {
        expect(stateOf({ ...baseState, zone: [100, 98] }).position).toBe(
            'in_zone'
        );
    });
});

describe('the verdict each position implies', () => {
    it('is defined for every position and only no_setup avoids', () => {
        expect(Object.keys(VERDICT_BY_POSITION).toSorted()).toEqual(
            [...PLAN_POSITIONS].toSorted()
        );
        expect(VERDICT_BY_POSITION).toEqual({
            in_zone: 'enter',
            above_zone: 'wait',
            below_zone: 'wait',
            no_setup: 'avoid',
        });
        expect(NO_SETUP_REASONS).toHaveLength(4);
    });
});

describe('printedSupports', () => {
    const prompt = [
        '## Market Reference',
        'Resistance (above):',
        '- 101.25 (Pivot R1; 3% away)',
        'Support (below):',
        '- 160,500 (Camarilla S3; 0.60% away; at price — inside bar noise, not a stop or target)',
        '- 98.50 (Pivot S1; 1.2% away)',
        '- 95 (Fib 61.8%; 4% away)',
        '',
        'MA200 94.50 and MA50 97',
        'Support (below):',
        '- 95 (Round 95; 4% away)',
        '- 93.25 (BB lower; 5% away)',
    ].join('\n');

    it('reads only the Support lists, once per price, without the at-price entries', () => {
        expect(printedSupports(prompt)).toEqual([93.25, 95, 98.5]);
    });

    it('does not take a resistance, a moving average or a number outside a list', () => {
        const supports = printedSupports(prompt);
        expect(supports).not.toContain(101.25);
        expect(supports).not.toContain(94.5);
        expect(supports).not.toContain(97);
        expect(supports).not.toContain(160500);
    });

    it('is empty for a prompt without a support list', () => {
        expect(printedSupports('no levels here')).toEqual([]);
    });
});

describe('quotedPrice', () => {
    it('rounds a US price to 2 places and a KRX price to the nearest tick, half up', () => {
        expect(quotedPrice(96.2449, 'us')).toBe(96.24);
        expect(quotedPrice(98_834.5, 'kr')).toBe(98_800);
        expect(quotedPrice(98_850, 'kr')).toBe(98_900);
        expect(quotedPrice(1_999.5, 'kr')).toBe(2_000);
        expect(quotedPrice(4_997, 'kr')).toBe(4_995);
        expect(quotedPrice(600_400, 'kr')).toBe(600_000);
    });
});

describe('expectedStopOf: the stop WP-15 section 3.2 prescribes', () => {
    // zone 98 to 100 (mean 99), ATR 1.2: the band is [93, 96.8]
    const noSupports: readonly number[] | null = [];
    const base = {
        zoneLow: 98,
        zoneMid: 99,
        atr: 1.2,
        supports: noSupports,
        market: 'us' as const,
    };

    it('keeps the model stop inside the band, edges included', () => {
        [93, 95, 96.8].forEach(modelStop => {
            expect(expectedStopOf({ ...base, modelStop })).toEqual({
                stop: modelStop,
                basis: 'model',
                verifiable: true,
            });
        });
    });

    it('moves a stop closer than 1 ATR to the highest printed support in the band', () => {
        const moved = expectedStopOf({
            ...base,
            modelStop: 97,
            supports: [92, 94, 95.5, 96.9],
        });
        expect(moved).toEqual({ stop: 95.5, basis: 'level', verifiable: true });
    });

    it('replaces a stop farther than 5 ATR from the mid the same way', () => {
        expect(
            expectedStopOf({ ...base, modelStop: 92.9, supports: [94] })
        ).toMatchObject({ stop: 94, basis: 'level' });
    });

    it('falls back to 1.5 ATR under the zone low, quoted, when no support is in the band', () => {
        expect(expectedStopOf({ ...base, modelStop: 97 })).toEqual({
            stop: 96.2,
            basis: 'atr',
            verifiable: true,
        });
        expect(
            expectedStopOf({
                modelStop: null,
                zoneLow: 100_000,
                zoneMid: 100_250,
                atr: 777,
                supports: [],
                market: 'kr',
            })
        ).toMatchObject({ stop: 98_800, basis: 'atr' });
    });

    it('applies the legacy rule without a usable ATR', () => {
        const legacy = { ...base, atr: null };
        expect(expectedStopOf({ ...legacy, modelStop: 97.9 })).toMatchObject({
            stop: 97.9,
            basis: 'model',
        });
        expect(expectedStopOf({ ...legacy, modelStop: 98 })).toEqual({
            stop: null,
            basis: null,
            verifiable: true,
        });
        expect(expectedStopOf({ ...legacy, modelStop: null }).stop).toBeNull();
    });

    it('cannot tell when the answer needs supports the prompt did not give', () => {
        expect(
            expectedStopOf({ ...base, modelStop: 97, supports: null })
        ).toEqual({ stop: null, basis: null, verifiable: false });
        expect(
            expectedStopOf({ ...base, modelStop: 95, supports: null })
                .verifiable
        ).toBe(true);
    });
});

/** A plan case with a stop 2.5 ATR under the zone low; override what a test is about. */
function planCase(overrides: Partial<PlanCase> = {}): PlanCase {
    return {
        caseId: 'AAA|2026-01-02',
        symbol: 'AAA',
        market: 'us',
        regime: 'range',
        repeat: 1,
        verdict: 'wait',
        riskLevel: 'medium',
        close: 99,
        atr: 1.2,
        entryPrices: [98, 100],
        stop: 95,
        modelStop: 95,
        targets: [104, 108],
        storedState: null,
        promptDynamic: null,
        rrAtEntry: 1.5,
        forward: null,
        ...overrides,
    };
}

const SUPPORTS = (...prices: number[]): string =>
    ['Support (below):', ...prices.map(p => `- ${p} (Level; 1% away)`)].join(
        '\n'
    );

describe('measurePlan', () => {
    it('recomputes the state, the implied verdict and the distances in ATR', () => {
        const m = measurePlan(planCase());
        expect(m.position).toBe('in_zone');
        expect(m.expectedVerdict).toBe('enter');
        expect(m.verdictEqual).toBe(false);
        expect(m.zoneLow).toBe(98);
        expect(m.zoneTop).toBe(100);
        expect(m.stopDistanceAtr).toBeCloseTo(3 / 1.2, 12);
        expect(m.stopFromMidAtr).toBeCloseTo(4 / 1.2, 12);
        expect(m.firstTargetRoomAtr).toBeCloseTo(4 / 1.2, 12);
        expect(m.zoneWidthAtr).toBeCloseTo(2 / 1.2, 12);
        expect(m.closeVsZone).toBe('in');
        expect(m.distanceAtr).toBe(0);
    });

    it('takes the zone mid as the mean of the valid entry prices, as production does', () => {
        // mean (98 + 99 + 106) / 3 = 101, not (98 + 106) / 2 = 102
        const m = measurePlan(
            planCase({ entryPrices: [98, 99, 106, -5], close: 100 })
        );
        expect(m.stopFromMidAtr).toBeCloseTo((101 - 95) / 1.2, 12);
    });

    it('measures the distance beyond the nearer zone edge', () => {
        const above = measurePlan(planCase({ close: 103 }));
        expect(above.position).toBe('above_zone');
        expect(above.distanceAtr).toBeCloseTo(3 / 1.2, 12);
        const below = measurePlan(planCase({ close: 96, stop: 90 }));
        expect(below.position).toBe('below_zone');
        expect(below.distanceAtr).toBeCloseTo(2 / 1.2, 12);
    });

    it('has no distance for a no_setup plan', () => {
        const m = measurePlan(planCase({ targets: [100.5] }));
        expect(m.position).toBe('no_setup');
        expect(m.distanceAtr).toBeNull();
    });

    it('flags a stop closer than 1 ATR under the zone low, and one farther than 5 ATR from the mid', () => {
        expect(measurePlan(planCase({ stop: 97 })).stopTooClose).toBe(true);
        expect(measurePlan(planCase({ stop: 96.8 })).stopTooClose).toBe(false);
        expect(
            measurePlan(planCase({ stop: 99 - 5 * 1.2 - 0.1 })).stopTooFar
        ).toBe(true);
        expect(measurePlan(planCase({ stop: 95 })).stopTooFar).toBe(false);
    });

    it('cannot judge the stop band without a usable ATR', () => {
        const m = measurePlan(planCase({ atr: null }));
        expect(m.stopTooClose).toBeNull();
        expect(m.stopTooFar).toBeNull();
        expect(m.stopMissing).toBeNull();
        expect(m.stopMismatch).toBeNull();
        expect(m.stopDistanceAtr).toBeNull();
        expect(measurePlan(planCase({ atr: 0 })).atr).toBeNull();
    });

    it('treats a plan with a zone and a usable ATR but no stop as a violation, though the state says no_stop', () => {
        const m = measurePlan(
            planCase({
                stop: null,
                modelStop: null,
                promptDynamic: SUPPORTS(),
            })
        );
        expect(m.position).toBe('no_setup');
        expect(m.reason).toBe('no_stop');
        expect(m.stopMissing).toBe(true);
        expect(m.stopMismatch).toBe(true);
        expect(measurePlan(planCase()).stopMissing).toBe(false);
    });

    it('accepts the model stop in the band and the level stop that is the highest printed support', () => {
        expect(measurePlan(planCase()).stopMismatch).toBe(false);
        const level = measurePlan(
            planCase({
                modelStop: 97,
                stop: 96,
                promptDynamic: SUPPORTS(95, 96),
                storedState: {
                    position: 'in_zone',
                    reason: null,
                    atr: 1.2,
                    distanceAtr: 0,
                    stopDistanceAtr: 2 / 1.2,
                    stopBasis: 'level',
                },
            })
        );
        expect(level.stopMismatch).toBe(false);
        expect(level.levelStop).toBe('printed');
        expect(level.expectedStopBasis).toBe('level');
        expect(level.stateDiffs).toEqual([]);
    });

    it('rejects a level stop that is a printed support but not the highest in the band', () => {
        const m = measurePlan(
            planCase({
                modelStop: 97,
                stop: 95,
                promptDynamic: SUPPORTS(95, 96),
                storedState: {
                    position: 'in_zone',
                    reason: null,
                    atr: 1.2,
                    distanceAtr: 0,
                    stopDistanceAtr: 3 / 1.2,
                    stopBasis: 'level',
                },
            })
        );
        expect(m.levelStop).toBe('not_printed');
        expect(m.stopMismatch).toBe(true);
    });

    it('does not accept a stop that equals an unrelated number of the prompt', () => {
        const stored = {
            position: 'in_zone',
            reason: null,
            atr: 1.2,
            distanceAtr: 0,
            stopDistanceAtr: 3 / 1.2,
            stopBasis: 'level',
        };
        // 95.2 is a moving average in the prompt (within 0.5 of the integer 95), 99 a resistance
        const prompt = `${SUPPORTS(93.5)}\nResistance (above):\n- 99 (EMA9)\nMA200 95.2`;
        const m = measurePlan(
            planCase({
                modelStop: 97,
                stop: 95.2,
                promptDynamic: prompt,
                storedState: { ...stored },
            })
        );
        expect(m.levelStop).toBe('not_printed');
        expect(m.stopMismatch).toBe(true);
    });

    it('says a level stop is unverifiable without the prompt, and counts the stop as unchecked', () => {
        const m = measurePlan(
            planCase({
                modelStop: 97,
                stop: 95,
                promptDynamic: null,
                storedState: {
                    position: 'in_zone',
                    reason: null,
                    atr: 1.2,
                    distanceAtr: 0,
                    stopDistanceAtr: 2.5,
                    stopBasis: 'level',
                },
            })
        );
        expect(m.levelStop).toBe('unverifiable');
        expect(m.stopUnverifiable).toBe(true);
        expect(m.stopMismatch).toBeNull();
        expect(m.expectedStopBasis).toBeNull();
        expect(measurePlan(planCase()).stopUnverifiable).toBe(false);
    });

    it('accepts the ATR fallback quoted to the KRX tick, and not the unrounded one', () => {
        const kr = {
            market: 'kr' as const,
            entryPrices: [100_000, 100_500],
            close: 100_200,
            atr: 777,
            modelStop: 99_500,
            targets: [102_000],
            promptDynamic: SUPPORTS(),
        };
        expect(
            measurePlan(planCase({ ...kr, stop: 98_800 })).stopMismatch
        ).toBe(false);
        expect(
            measurePlan(planCase({ ...kr, stop: 98_834.5 })).stopMismatch
        ).toBe(true);
        expect(
            measurePlan(planCase({ ...kr, stop: 98_800 })).expectedStopBasis
        ).toBe('atr');
    });

    it('lists the fields where the stored state differs, none when it agrees', () => {
        const stored = {
            position: 'in_zone',
            reason: null,
            atr: 1.2,
            distanceAtr: 0,
            stopDistanceAtr: 2.5,
            stopBasis: 'model',
        };
        expect(
            measurePlan(planCase({ storedState: stored })).stateDiffs
        ).toEqual([]);
        expect(
            measurePlan(
                planCase({
                    storedState: {
                        ...stored,
                        position: 'above_zone',
                        reason: 'stopped',
                        atr: 2,
                        stopDistanceAtr: 9,
                        distanceAtr: 3,
                        stopBasis: 'atr',
                    },
                })
            ).stateDiffs
        ).toEqual([
            'position',
            'reason',
            'atr',
            'stopDistanceAtr',
            'distanceAtr',
            'stopBasis',
        ]);
        expect(measurePlan(planCase()).stateDiffs).toBeNull();
    });

    it('pins the distance in ATR for an above_zone plan and ignores it for no_setup', () => {
        const above = {
            position: 'above_zone',
            reason: null,
            atr: 1.2,
            stopDistanceAtr: 2.5,
            stopBasis: 'model',
        };
        expect(
            measurePlan(
                planCase({
                    close: 103,
                    storedState: { ...above, distanceAtr: 3 / 1.2 },
                })
            ).stateDiffs
        ).toEqual([]);
        expect(
            measurePlan(
                planCase({
                    close: 103,
                    storedState: { ...above, distanceAtr: 2 },
                })
            ).stateDiffs
        ).toEqual(['distanceAtr']);
        expect(
            measurePlan(
                planCase({
                    targets: [100.5],
                    storedState: {
                        ...above,
                        position: 'no_setup',
                        reason: 'no_room_above',
                        distanceAtr: null,
                    },
                })
            ).stateDiffs
        ).toEqual([]);
    });

    it('does not compare the stop basis when the prompt cannot tell it', () => {
        const m = measurePlan(
            planCase({
                modelStop: 97,
                stop: 95,
                promptDynamic: null,
                storedState: {
                    position: 'in_zone',
                    reason: null,
                    atr: 1.2,
                    distanceAtr: 0,
                    stopDistanceAtr: 2.5,
                    stopBasis: 'whatever',
                },
            })
        );
        expect(m.stateDiffs).toEqual([]);
    });

    it('treats a stored value rounded to 2 places as equal', () => {
        const m = measurePlan(
            planCase({
                storedState: {
                    position: 'in_zone',
                    reason: null,
                    atr: 1.2,
                    distanceAtr: 0,
                    stopDistanceAtr: 2.5,
                    stopBasis: 'model',
                },
                stop: 95.0001,
                modelStop: 95.0001,
            })
        );
        expect(m.stateDiffs).toEqual([]);
    });

    it('puts the close against the zone by exact edges on both sides', () => {
        const where = (close: number) =>
            measurePlan(planCase({ close })).closeVsZone;
        expect(where(100)).toBe('in');
        expect(where(100.01)).toBe('above');
        expect(where(98)).toBe('in');
        expect(where(97.99)).toBe('below');
        expect(
            measurePlan(planCase({ entryPrices: [] })).closeVsZone
        ).toBeNull();
    });

    it("reads a run that predates the exact-edge rule with WP-15's 1% band when asked to", () => {
        const where = (close: number) =>
            measurePlan(planCase({ close }), 0.01).closeVsZone;
        expect(where(100.9)).toBe('in');
        expect(where(101.1)).toBe('above');
        expect(where(97.1)).toBe('in');
        expect(where(96.9)).toBe('below');
        expect(measurePlan(planCase({ close: 100.9 }), 0.01).position).toBe(
            'in_zone'
        );
        expect(measurePlan(planCase({ close: 100.9 })).position).toBe(
            'above_zone'
        );
    });

    it('uses the lowest target above the zone as the first target', () => {
        const m = measurePlan(planCase({ targets: [99, 108, 106] }));
        expect(m.firstTargetRoomAtr).toBeCloseTo(6 / 1.2, 12);
        expect(
            measurePlan(planCase({ targets: [90] })).firstTargetRoomAtr
        ).toBeNull();
    });
});

describe('forwardOf', () => {
    const bars = Array.from({ length: 15 }, (_, i) => ({
        high: 110 + i,
        low: 90 - i,
        close: 100 + i,
    }));

    it('measures the 10 sessions after the bar in percent of its close', () => {
        const f = forwardOf(bars, 2, 2);
        // close 102; window bars 3..12: lowest low 90-12=78, highest high 110+12=122, bar 12 close 112
        expect(f?.lowPct).toBeCloseTo((78 / 102 - 1) * 100, 12);
        expect(f?.highPct).toBeCloseTo((122 / 102 - 1) * 100, 12);
        expect(f?.changePct).toBeCloseTo((112 / 102 - 1) * 100, 12);
        expect(f?.atrPct).toBeCloseTo((2 / 102) * 100, 12);
    });

    it('is null when the bars end before 10 sessions', () => {
        expect(forwardOf(bars, 5, 2)).toBeNull();
        expect(forwardOf(bars, 4, null)?.atrPct).toBeNull();
    });
});

/** A measure with the given position; everything else defaults. */
function measure(
    position: PlanPosition,
    overrides: Partial<PlanMeasure> = {}
): PlanMeasure {
    return {
        caseId: 'A|1',
        repeat: 1,
        verdict: 'wait',
        riskLevel: 'medium',
        position,
        reason: position === 'no_setup' ? 'no_room_above' : null,
        expectedVerdict: VERDICT_BY_POSITION[position],
        atr: 1,
        zoneLow: 98,
        zoneTop: 100,
        stopDistanceAtr: 2,
        stopFromMidAtr: 3,
        distanceAtr: 0,
        firstTargetRoomAtr: 1.5,
        zoneWidthAtr: 2,
        stopBasis: null,
        expectedStopBasis: null,
        stopTooClose: false,
        stopTooFar: false,
        stopMissing: false,
        stopMismatch: false,
        stopUnverifiable: false,
        levelStop: null,
        stateDiffs: null,
        verdictEqual: true,
        closeVsZone: 'in',
        forward: null,
        rrAtEntry: null,
        ...overrides,
    };
}

const many = (
    position: PlanPosition,
    count: number,
    overrides: Partial<PlanMeasure> = {}
): PlanMeasure[] =>
    Array.from({ length: count }, (_, i) =>
        measure(position, { caseId: `${position}|${i}`, ...overrides })
    );

describe('summarizePlanRun', () => {
    it('throws on an empty run instead of reporting zeros', () => {
        expect(() => summarizePlanRun([], null)).toThrow(
            'no result with a plan'
        );
        expect(() =>
            summarizePlanRun([measure('in_zone')], new Set<string>())
        ).toThrow('no result with a plan');
    });

    it('distributes positions, reasons, verdicts and the verdict by position', () => {
        const summary = summarizePlanRun(
            [
                ...many('in_zone', 5, { verdict: 'enter' }),
                ...many('above_zone', 3),
                ...many('no_setup', 2, { verdict: 'wait' }),
            ],
            null
        );
        expect(summary.basis).toBe('all');
        expect(summary.positions.in_zone).toEqual(share(5, 10));
        expect(summary.positions.below_zone).toEqual(share(0, 10));
        expect(summary.reasons).toEqual({ no_room_above: 2 });
        expect(summary.verdicts).toEqual({ enter: 5, wait: 5 });
        expect(summary.verdictByPosition).toEqual({
            'enter>in_zone': 5,
            'wait>above_zone': 3,
            'wait>no_setup': 2,
        });
    });

    it('restricts to the headline keys when given', () => {
        const rows = many('in_zone', 3);
        const summary = summarizePlanRun(rows, new Set(['in_zone|0#1']));
        expect(summary.basis).toBe('headline');
        expect(summary.n).toBe(1);
    });

    it('reports the stop distances, the share under 1 and 0.5 ATR, and the band violations', () => {
        const rows = [
            measure('in_zone', {
                caseId: 'a',
                stopDistanceAtr: 0.4,
                stopTooClose: true,
            }),
            measure('in_zone', {
                caseId: 'b',
                stopDistanceAtr: 0.9,
                stopTooClose: true,
            }),
            measure('in_zone', {
                caseId: 'c',
                stopDistanceAtr: 2,
                stopTooFar: true,
            }),
            measure('in_zone', {
                caseId: 'd',
                stopDistanceAtr: null,
                stopFromMidAtr: null,
            }),
        ];
        const { stop } = summarizePlanRun(rows, null);
        expect(stop.n).toBe(3);
        expect(stop.underOneAtr).toEqual(share(2, 3));
        expect(stop.underHalfAtr).toEqual(share(1, 3));
        expect(stop.tooClose).toBe(2);
        expect(stop.tooFar).toBe(1);
        expect(stop.fromZoneLowAtr.p50).toBe(0.9);
    });

    it('counts level stops by what the prompt shows', () => {
        const rows = [
            measure('in_zone', { caseId: 'a', levelStop: 'printed' }),
            measure('in_zone', { caseId: 'b', levelStop: 'not_printed' }),
            measure('in_zone', { caseId: 'c', levelStop: 'unverifiable' }),
        ];
        expect(summarizePlanRun(rows, null).stop.levelStops).toEqual({
            printed: 1,
            notPrinted: 1,
            unverifiable: 1,
        });
    });

    it('compares the recomputed state with the stored one', () => {
        const rows = [
            measure('in_zone', { caseId: 'a', stateDiffs: [] }),
            measure('in_zone', {
                caseId: 'b',
                stateDiffs: ['position', 'atr'],
            }),
            measure('in_zone', { caseId: 'c', stateDiffs: null }),
        ];
        const { recompute } = summarizePlanRun(rows, null);
        expect(recompute.withStoredState).toBe(2);
        expect(recompute.equal).toBe(1);
        expect(recompute.diffsByField).toEqual({ position: 1, atr: 1 });
    });

    it('reports the share of plans with a zone whose first target is at least 1 ATR above it, a plan with no target above counting as none', () => {
        const rows = [
            measure('in_zone', { caseId: 'a', firstTargetRoomAtr: 1 }),
            measure('in_zone', { caseId: 'b', firstTargetRoomAtr: 0.99 }),
            measure('in_zone', { caseId: 'c', firstTargetRoomAtr: null }),
        ];
        expect(summarizePlanRun(rows, null).target.atLeastOneAtr).toEqual(
            share(1, 3)
        );
    });

    it('counts where the close sits per stored verdict', () => {
        const rows = [
            measure('in_zone', {
                caseId: 'a',
                verdict: 'wait',
                closeVsZone: 'above',
            }),
            measure('in_zone', {
                caseId: 'b',
                verdict: 'wait',
                closeVsZone: 'above',
            }),
            measure('in_zone', {
                caseId: 'c',
                verdict: 'enter',
                closeVsZone: 'in',
            }),
            measure('no_setup', { caseId: 'd', closeVsZone: null }),
        ];
        expect(summarizePlanRun(rows, null).closeVsZoneByVerdict).toEqual({
            wait: { above: 2 },
            enter: { in: 1 },
        });
    });

    it('checks the volatility grade orders the forward range', () => {
        const fwd = (range: number) => ({
            changePct: 1,
            lowPct: -range / 2,
            highPct: range / 2,
            atrPct: 2,
        });
        const graded = (level: string, range: number, id: string) =>
            measure('in_zone', {
                caseId: id,
                riskLevel: level,
                forward: fwd(range),
            });
        const ordered = summarizePlanRun(
            [
                graded('low', 8, 'a'),
                graded('medium', 15, 'b'),
                graded('high', 22, 'c'),
            ],
            null
        ).volatility;
        expect(ordered.monotonic).toBe(true);
        expect(ordered.byLevel.high.rangePct).toBe(22);
        const unordered = summarizePlanRun(
            [
                graded('low', 8, 'a'),
                graded('medium', 30, 'b'),
                graded('high', 22, 'c'),
            ],
            null
        ).volatility;
        expect(unordered.monotonic).toBe(false);
        const missing = summarizePlanRun(
            [graded('low', 8, 'a')],
            null
        ).volatility;
        expect(missing.monotonic).toBeNull();
    });
});

describe('runCallStats', () => {
    const result = (
        over: Partial<CaseResultFile> & { id: string }
    ): CaseResultFile => ({
        caseId: over.id,
        symbol: 'AAA',
        asOf: '2026-01-02',
        repeat: 1,
        unfilteredResult: {},
        promptVersion: 'p34',
        promptHashes: null,
        promptDynamic: 'x',
        usage: { inputTokens: 1000, outputTokens: 200, cachedTokens: 400 },
        exchangeCount: 1,
        latencyMs: 100,
        error: null,
        ...over,
    });

    it('reports failures, token and latency medians over repeat 1 only', () => {
        const stats = runCallStats(
            [
                result({ id: 'a' }),
                result({ id: 'b', error: 'boom', usage: null }),
                result({
                    id: 'c',
                    usage: {
                        inputTokens: 3000,
                        outputTokens: 600,
                        cachedTokens: 1000,
                    },
                    latencyMs: 300,
                }),
                result({ id: 'a', repeat: 2, latencyMs: 9999 }),
            ],
            null
        );
        expect(stats.n).toBe(3);
        expect(stats.failed).toEqual(share(1, 3));
        expect(stats.medianOutputTokens).toBe(400);
        expect(stats.medianInputTokens).toBe(2000);
        expect(stats.medianUncachedInputTokens).toBe(1300);
        expect(stats.medianLatencyMs).toBe(100);
        expect(stats.missingPlan).toEqual(share(0, 0));
    });

    it('counts missing plans, unlabelled rows and ungrounded plan prices from the label rows', () => {
        const labelled = makeRow({ caseId: 'a' });
        const missing = makeRow({
            caseId: 'b',
            labels: makeLabels({ plan: { reason: 'none' } }),
            provenance: {
                checked: { plan: 4, other: 0, keyPrices: 0 },
                ungrounded: { plan: 1, other: 0, keyPrices: 0 },
            },
        });
        const unlabelled = makeRow({
            caseId: 'c',
            status: 'insufficient_forward',
            labels: null,
        });
        const stats = runCallStats(
            [result({ id: 'a' })],
            [labelled, missing, unlabelled, makeRow({ caseId: 'd', repeat: 2 })]
        );
        expect(stats.missingPlan).toEqual(share(1, 2));
        expect(stats.unlabelled).toEqual(share(1, 3));
        expect(stats.ungroundedPlan).toEqual(share(1, 4));
    });
});

describe('outcomesByPosition and invariantCounts', () => {
    it('summarises the label rows of each position that has any', () => {
        const summary = outcomesByPosition([
            { position: 'in_zone', row: makeRow() },
            { position: 'in_zone', row: makeRow() },
            { position: 'no_setup', row: makeRow() },
        ]);
        expect(Object.keys(summary).toSorted()).toEqual([
            'in_zone',
            'no_setup',
        ]);
        expect(summary.in_zone.n).toBe(2);
    });

    it('counts invariant ids over repeat 1 rows', () => {
        expect(
            invariantCounts([
                makeRow({ invariants: ['stop_floor'] }),
                makeRow({ invariants: ['stop_floor', 'x'] }),
                makeRow({ invariants: ['x'], repeat: 2 }),
            ])
        ).toEqual({ stop_floor: 2, x: 1 });
    });
});

describe('comparePlanRuns (P4 and P5)', () => {
    const room = (id: string, value: number | null) =>
        measure('in_zone', { caseId: id, firstTargetRoomAtr: value });
    const row = (
        id: string,
        outcome: 'target_first' | 'stop_first',
        rw: number,
        holdBars = 1
    ) =>
        makeRow({
            caseId: id,
            labels: makeLabels({
                plan: { outcome, rwNullTargetFirst: rw, holdBars },
            }),
        });

    it('pairs by case and reports the gain in plans with room', () => {
        const paired = comparePlanRuns({
            before: [
                room('a', 0.5),
                room('b', 0.5),
                room('c', 1.5),
                room('only-before', 2),
            ],
            after: [
                room('a', 1.2),
                room('b', 1.1),
                room('c', 1.5),
                room('only-after', 2),
            ],
            beforeLabels: [],
            afterLabels: [],
        });
        expect(paired.targetRoom.before).toEqual(share(1, 3));
        expect(paired.targetRoom.after).toEqual(share(3, 3));
        expect(paired.targetRoom.diff.n).toBe(3);
        expect(paired.targetRoom.diff.mean).toBeCloseTo(2 / 3, 12);
    });

    it('counts a plan with no target above the zone as no room and drops a case present in one run only', () => {
        const paired = comparePlanRuns({
            before: [room('a', null), room('b', 0.5), room('only-before', 2)],
            after: [room('a', 1.5), room('b', 1.5), room('only-after', 2)],
            beforeLabels: [],
            afterLabels: [],
        });
        expect(paired.targetRoom.diff.n).toBe(2);
        expect(paired.targetRoom.diff.mean).toBe(1);
    });

    it('measures the target-first margin over plans triggered in both runs', () => {
        const paired = comparePlanRuns({
            before: [],
            after: [],
            beforeLabels: [
                row('a', 'target_first', 0.4),
                row('b', 'stop_first', 0.5),
                makeRow({ caseId: 'c', labels: makeLabels() }),
            ],
            afterLabels: [
                row('a', 'stop_first', 0.4),
                row('b', 'stop_first', 0.5),
                row('c', 'target_first', 0.4),
            ],
        });
        // a: (0 - 0.4) - (1 - 0.4) = -1; b: 0; c is not triggered before (not_triggered)
        expect(paired.noRegression.diff.n).toBe(2);
        expect(paired.noRegression.diff.mean).toBeCloseTo(-0.5, 12);
        expect(paired.noRegression.stopFirstEarly.after).toEqual(share(2, 3));
        expect(paired.noRegression.stopFirstEarly.before).toEqual(share(1, 3));
        expect(paired.noRegression.notTriggered.before).toEqual(share(1, 3));
    });

    it('reports a stop hit after more than 2 sessions as not early', () => {
        const paired = comparePlanRuns({
            before: [],
            after: [],
            beforeLabels: [
                row('a', 'stop_first', 0.4, C.earlyStopSessions + 1),
            ],
            afterLabels: [row('a', 'stop_first', 0.4, C.earlyStopSessions)],
        });
        expect(paired.noRegression.stopFirstEarly.before).toEqual(share(0, 1));
        expect(paired.noRegression.stopFirstEarly.after).toEqual(share(1, 1));
    });

    it('averages the risk:reward at entry of each run', () => {
        const paired = comparePlanRuns({
            before: [measure('in_zone', { rrAtEntry: 1 })],
            after: [measure('in_zone', { rrAtEntry: 0.5 })],
            beforeLabels: [],
            afterLabels: [],
        });
        expect(paired.noRegression.riskReward).toEqual({
            before: 1,
            after: 0.5,
        });
    });
});

describe('planGates', () => {
    const calls = (over: Partial<RunCallStats> = {}): RunCallStats => ({
        n: 100,
        failed: share(1, 100),
        missingPlan: share(1, 100),
        unlabelled: share(1, 100),
        ungroundedPlan: share(1, 100),
        medianOutputTokens: 1000,
        medianInputTokens: 30000,
        medianUncachedInputTokens: 15000,
        medianLatencyMs: 30000,
        ...over,
    });

    /** A run of 100 plans: 50 in_zone, 30 above, 5 below, 15 no_setup, all stops fine. */
    const goodRows = (): PlanMeasure[] =>
        [
            ...many('in_zone', 50, {
                stateDiffs: [],
                expectedStopBasis: 'model',
            }),
            ...many('above_zone', 30, {
                stateDiffs: [],
                expectedStopBasis: 'model',
            }),
            ...many('below_zone', 5, {
                stateDiffs: [],
                expectedStopBasis: 'level',
                levelStop: 'printed',
            }),
            ...many('no_setup', 15, {
                stateDiffs: [],
                expectedStopBasis: 'atr',
            }),
        ].map(m => ({ ...m, verdict: VERDICT_BY_POSITION[m.position] }));

    const paired = (
        over: Partial<PairedPlanComparison> = {}
    ): PairedPlanComparison => ({
        targetRoom: {
            before: share(26, 100),
            after: share(60, 100),
            diff: { n: 100, mean: 0.3, low: 0.1, high: 0.5 },
        },
        noRegression: {
            diff: { n: 80, mean: 0, low: -0.03, high: 0.03 },
            beforeMean: 0,
            afterMean: 0,
            stopFirstEarly: { before: share(1, 2), after: share(1, 2) },
            notTriggered: { before: share(1, 2), after: share(1, 2) },
            riskReward: { before: 1, after: 1 },
        },
        ...over,
    });

    const evaluate = (over: Partial<Parameters<typeof planGates>[0]> = {}) => {
        const summary = summarizePlanRun(goodRows(), null);
        const gates = planGates({
            summary,
            summaryAll: summary,
            paired: paired(),
            after: calls(),
            before: calls(),
            invariantsAfter: { stop_floor: 0 },
            invariantsBefore: { stop_floor: 0 },
            noiseFloor: 0,
            ...over,
        });
        return Object.fromEntries(gates.map(g => [g.id, g.pass]));
    };

    it('passes every gate on a run that satisfies them all', () => {
        expect(evaluate()).toEqual({
            P1: true,
            P2: true,
            P3: true,
            P4: true,
            P5: true,
            P6: true,
        });
    });

    /** The gates for a run of `rows` with no paired data; `extra` overrides the inputs. */
    const gatesOf = (
        rows: PlanMeasure[],
        extra: Partial<Parameters<typeof planGates>[0]> = {}
    ) => {
        const summary = summarizePlanRun(rows, null);
        return Object.fromEntries(
            planGates({
                summary,
                summaryAll: summary,
                paired: null,
                after: calls(),
                before: null,
                invariantsAfter: { stop_floor: 0 },
                invariantsBefore: { stop_floor: 0 },
                noiseFloor: 0,
                ...extra,
            }).map(g => [g.id, g.pass])
        );
    };
    const p1 = (rows: PlanMeasure[], extra = {}) => gatesOf(rows, extra).P1;
    const bad = (overrides: Partial<PlanMeasure>) => [
        ...goodRows(),
        measure('in_zone', { stateDiffs: [], ...overrides }),
    ];

    it('P1 fails on each of its checks', () => {
        expect(p1(goodRows())).toBe(true);
        expect(p1(bad({ stopTooClose: true }))).toBe(false);
        expect(p1(bad({ stopTooFar: true }))).toBe(false);
        expect(p1(bad({ stopMissing: true }))).toBe(false);
        expect(p1(bad({ stopMismatch: true }))).toBe(false);
        expect(p1(bad({ stopUnverifiable: true }))).toBe(false);
        expect(p1(bad({ levelStop: 'not_printed' }))).toBe(false);
        expect(p1(bad({ stateDiffs: ['position'] }))).toBe(false);
        expect(p1(bad({ stateDiffs: null }))).toBe(false);
        expect(p1(bad({ verdictEqual: false }))).toBe(false);
        expect(
            p1(goodRows(), {
                invariantsAfter: { stop_floor: 1 },
                invariantsBefore: { stop_floor: 0 },
            })
        ).toBe(false);
        expect(
            p1(goodRows(), {
                invariantsAfter: { stop_floor: 1 },
                invariantsBefore: { stop_floor: 1 },
            })
        ).toBe(true);
    });

    it('P1 cannot pass without a baseline for the plan invariants, but still fails on a violation', () => {
        const noBaseline = { invariantsAfter: null, invariantsBefore: null };
        expect(p1(goodRows(), noBaseline)).toBeNull();
        expect(
            p1(goodRows(), { ...noBaseline, invariantsAfter: { x: 0 } })
        ).toBeNull();
        expect(
            p1(goodRows(), {
                invariantsAfter: { x: 0 },
                invariantsBefore: null,
            })
        ).toBeNull();
        expect(p1(bad({ stopMismatch: true }), noBaseline)).toBe(false);
    });

    /**
     * Gates for a headline run of `goodRows()` and an all-results run with `extra` rows that
     * the headline summary does not contain: whatever fails here was read from `summaryAll`.
     */
    const withNonHeadline = (extra: PlanMeasure[]) => {
        const all = summarizePlanRun(
            [
                ...goodRows(),
                ...extra.map((m, i) => ({ ...m, caseId: `extra|${i}` })),
            ],
            null
        );
        return Object.fromEntries(
            planGates({
                summary: summarizePlanRun(goodRows(), null),
                summaryAll: all,
                paired: null,
                after: calls(),
                before: null,
                invariantsAfter: { x: 0 },
                invariantsBefore: { x: 0 },
                noiseFloor: 0,
            }).map(g => [g.id, g.pass])
        );
    };
    /** One non-headline row that is clean except for what `overrides` sets. */
    const extraRow = (overrides: Partial<PlanMeasure>) =>
        measure('in_zone', { stateDiffs: [], ...overrides });

    it('P1 reads each of its checks from every result, not from the headline rows', () => {
        expect(withNonHeadline([extraRow({})]).P1).toBe(true);
        const violations: Record<string, Partial<PlanMeasure>> = {
            'stop too close': { stopTooClose: true },
            'stop too far': { stopTooFar: true },
            'stop missing': { stopMissing: true },
            'stop differs from the prescribed one': { stopMismatch: true },
            'stop unverifiable': { stopUnverifiable: true },
            'level stop not the highest printed support': {
                levelStop: 'not_printed',
            },
            'recomputed state differs from the stored one': {
                stateDiffs: ['position'],
            },
            'no stored state to equal the recomputed one': { stateDiffs: null },
            'verdict differs from the implied one': { verdictEqual: false },
        };
        Object.entries(violations).forEach(([name, overrides]) => {
            expect(withNonHeadline([extraRow(overrides)]).P1, name).toBe(false);
        });
    });

    it('P2 stays on the headline rows: a lopsided non-headline set does not fail it', () => {
        const lopsided = Array.from({ length: 300 }, () => extraRow({}));
        const gates = withNonHeadline(lopsided);
        expect(gates.P2).toBe(true);
        expect(gates.P1).toBe(true);
    });

    it('P3 reads the recomputed basis of every result: non-headline plans on the atr basis fail it', () => {
        const atrRows = Array.from({ length: 100 }, () =>
            extraRow({ expectedStopBasis: 'atr' })
        );
        // headline alone is 15% atr; with 100 more atr plans it is 115/200
        expect(withNonHeadline([]).P3).toBe(true);
        expect(withNonHeadline(atrRows).P3).toBe(false);
    });

    it('P2 bounds each position at 70% and no_setup between 2% and 35%', () => {
        const run = (counts: Record<PlanPosition, number>) =>
            gatesOf(
                PLAN_POSITIONS.flatMap(p =>
                    many(p, counts[p], { stateDiffs: [] })
                )
            ).P2;
        expect(
            run({ in_zone: 70, above_zone: 13, below_zone: 15, no_setup: 2 })
        ).toBe(true);
        expect(
            run({ in_zone: 71, above_zone: 12, below_zone: 15, no_setup: 2 })
        ).toBe(false);
        expect(
            run({ in_zone: 50, above_zone: 48, below_zone: 0, no_setup: 2 })
        ).toBe(true);
        expect(
            run({ in_zone: 50, above_zone: 49, below_zone: 0, no_setup: 1 })
        ).toBe(false);
        expect(
            run({ in_zone: 30, above_zone: 35, below_zone: 0, no_setup: 35 })
        ).toBe(true);
        expect(
            run({ in_zone: 30, above_zone: 34, below_zone: 0, no_setup: 36 })
        ).toBe(false);
    });

    it('P3 allows the recomputed atr basis up to 40% of plans with a basis and is undecided without any', () => {
        const run = (atr: number, other: number) =>
            gatesOf([
                ...many('in_zone', atr, { expectedStopBasis: 'atr' }),
                ...many('above_zone', other, { expectedStopBasis: 'model' }),
            ]).P3;
        expect(run(40, 60)).toBe(true);
        expect(run(41, 59)).toBe(false);
        expect(gatesOf(many('in_zone', 3)).P3).toBeNull();
    });

    it('P4 needs a gain of 15 pp with the 95% low above 0', () => {
        const gain = (mean: number, low: number) =>
            paired({
                targetRoom: {
                    before: share(0, 1),
                    after: share(1, 1),
                    diff: { n: 100, mean, low, high: 1 },
                },
            });
        expect(evaluate({ paired: gain(0.15, 0.01) }).P4).toBe(true);
        expect(evaluate({ paired: gain(0.149, 0.01) }).P4).toBe(false);
        expect(evaluate({ paired: gain(0.3, 0) }).P4).toBe(false);
        expect(evaluate({ paired: gain(0.3, -0.01) }).P4).toBe(false);
        expect(evaluate({ paired: null }).P4).toBeNull();
    });

    it('P5 needs the 95% low at or above -5 pp', () => {
        const margin = (low: number | null) =>
            paired({
                noRegression: {
                    ...paired().noRegression,
                    diff: { n: 80, mean: 0, low, high: 0.1 },
                },
            });
        expect(evaluate({ paired: margin(-0.05) }).P5).toBe(true);
        expect(evaluate({ paired: margin(-0.051) }).P5).toBe(false);
        expect(evaluate({ paired: margin(null) }).P5).toBe(false);
    });

    it('P6 allows 1 pp (or the noise floor) per rate and 10% more output tokens', () => {
        const after = (over: Partial<RunCallStats>) =>
            evaluate({ after: calls(over) });
        expect(after({ failed: share(2, 100) }).P6).toBe(true);
        expect(after({ failed: share(3, 100) }).P6).toBe(false);
        expect(after({ unlabelled: share(3, 100) }).P6).toBe(false);
        expect(after({ missingPlan: share(3, 100) }).P6).toBe(false);
        expect(after({ ungroundedPlan: share(3, 100) }).P6).toBe(false);
        expect(after({ medianOutputTokens: 1100 }).P6).toBe(true);
        expect(after({ medianOutputTokens: 1101 }).P6).toBe(false);
        expect(
            evaluate({
                after: calls({ failed: share(5, 100) }),
                noiseFloor: 0.05,
            }).P6
        ).toBe(true);
        expect(evaluate({ before: null }).P6).toBeNull();
        expect(
            evaluate({ after: calls({ failed: share(0, 0) }) }).P6
        ).toBeNull();
    });
});
