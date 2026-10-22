import { describe, it, expect } from 'vitest';
import {
    buildPlanCheck,
    entryZoneTop,
    exceedsEntryZone,
    ENTRY_ZONE_TOLERANCE,
    nearestTargetAbove,
    riskRewardFrom,
    structuralRiskReward,
} from '@/domain/analysis/planCheck';
import type {
    ActionRecommendation,
    ReferenceLevel,
    ReferenceLevels,
} from '@/domain/types';

function level(price: number, distancePercent: number): ReferenceLevel {
    return { price, label: 'MA50', kind: 'ma', distancePercent };
}

function levels(
    resistance: ReferenceLevel[],
    support: ReferenceLevel[]
): ReferenceLevels {
    return { resistance, support };
}

function rec(over: Partial<ActionRecommendation> = {}): ActionRecommendation {
    return {
        positionAnalysis: '',
        entry: '',
        exit: '',
        riskReward: '',
        ...over,
    };
}

describe('nearestTargetAbove', () => {
    it('picks the nearest target above price out of an unsorted list', () => {
        expect(nearestTargetAbove(100, [150, 105, 120])).toBe(105);
    });

    it('excludes values at or below price', () => {
        expect(nearestTargetAbove(100, [100, 90, 105])).toBe(105);
    });

    it('excludes NaN and Infinity', () => {
        expect(
            nearestTargetAbove(100, [Number.NaN, Number.POSITIVE_INFINITY, 110])
        ).toBe(110);
    });

    it('returns undefined for an empty or missing list', () => {
        expect(nearestTargetAbove(100, [])).toBeUndefined();
        expect(nearestTargetAbove(100, undefined)).toBeUndefined();
    });

    it('returns undefined when nothing is above price', () => {
        expect(nearestTargetAbove(100, [90, 100])).toBeUndefined();
    });
});

describe('riskRewardFrom', () => {
    it('measures reward to the NEAREST target above, not the furthest', () => {
        // The furthest target would give 4.0. Exit rules fire on the first one reached, so
        // crediting the further target counts profit the plan will not realise.
        expect(riskRewardFrom(100, 95, [110, 120])).toBe(2);
    });

    it('returns 0 — not null — when targets exist but none is above the price', () => {
        // This is the measured failure: a plan whose take-profit the market already passed.
        // "No upside" is a finding; "unknown" is not. They must not collapse together.
        expect(riskRewardFrom(100, 95, [98, 99])).toBe(0);
    });

    it('returns null when the ratio is undefined rather than guessing', () => {
        expect(riskRewardFrom(100, undefined, [110])).toBeNull();
        expect(riskRewardFrom(100, 95, [])).toBeNull();
        expect(riskRewardFrom(100, 95, undefined)).toBeNull();
        // Stop at or above the price: there is no downside leg to divide by.
        expect(riskRewardFrom(100, 100, [110])).toBeNull();
        expect(riskRewardFrom(100, 105, [110])).toBeNull();
    });

    it('rejects non-finite and non-positive inputs instead of producing NaN', () => {
        expect(riskRewardFrom(Number.NaN, 95, [110])).toBeNull();
        expect(riskRewardFrom(0, 95, [110])).toBeNull();
        expect(riskRewardFrom(100, Number.NaN, [110])).toBeNull();
        expect(riskRewardFrom(100, 95, [Number.NaN])).toBeNull();
        expect(riskRewardFrom(100, 95, [Number.POSITIVE_INFINITY])).toBeNull();
    });

    it('produces the sub-1.0 ratio that the measured failure looks like', () => {
        // Measured failure shape: the first obstacle sits well under 1% above the price.
        const rr = riskRewardFrom(100, 97.3, [100.74]);
        expect(rr).not.toBeNull();
        expect(rr as number).toBeLessThan(1);
    });
});

describe('structuralRiskReward', () => {
    it('divides the nearest upside distance by the nearest downside distance', () => {
        expect(
            structuralRiskReward(levels([level(105, 5)], [level(95, -5)]))
        ).toBe(1);
        expect(
            structuralRiskReward(levels([level(101, 1)], [level(96, -4)]))
        ).toBeCloseTo(0.25);
    });

    it('returns null when either side is missing', () => {
        expect(structuralRiskReward(levels([], [level(95, -5)]))).toBeNull();
        expect(structuralRiskReward(levels([level(105, 5)], []))).toBeNull();
    });

    it('returns null rather than dividing by a zero-distance support', () => {
        expect(
            structuralRiskReward(levels([level(105, 5)], [level(100, 0)]))
        ).toBeNull();
    });

    it('returns null when a "support" is not actually below the price', () => {
        // Math.abs() would otherwise launder an inconsistent positive distance into a
        // plausible-looking ratio. Symmetric with the resistance guard below.
        expect(
            structuralRiskReward(levels([level(105, 5)], [level(102, 2)]))
        ).toBeNull();
    });

    it('returns null when a "resistance" is not actually above the price', () => {
        // The collector defines resistance as levels above current price; a non-positive
        // distance means its output is inconsistent, which is not the same claim as
        // "there is no upside" and must not be reported as a ratio of 0.
        expect(
            structuralRiskReward(levels([level(99, -1)], [level(95, -5)]))
        ).toBeNull();
    });
});

describe('exceedsEntryZone', () => {
    it('flags a price above the zone top beyond tolerance', () => {
        expect(exceedsEntryZone(102, [98, 100])).toBe(true);
    });

    it('tolerates a price sitting just on the zone top', () => {
        expect(exceedsEntryZone(100 * (1 + ENTRY_ZONE_TOLERANCE), [100])).toBe(
            false
        );
    });

    it('never flags a price BELOW the zone — cheaper is not the failure mode', () => {
        expect(exceedsEntryZone(90, [98, 100])).toBe(false);
    });

    it('fails open when there is nothing to compare against', () => {
        expect(exceedsEntryZone(102, undefined)).toBe(false);
        expect(exceedsEntryZone(102, [])).toBe(false);
        expect(exceedsEntryZone(102, [Number.NaN, -5])).toBe(false);
        expect(exceedsEntryZone(Number.NaN, [100])).toBe(false);
    });

    it('treats a negative or non-finite tolerance as zero rather than inverting the test', () => {
        expect(exceedsEntryZone(100.5, [100], -1)).toBe(true);
        expect(exceedsEntryZone(100.5, [100], Number.NaN)).toBe(true);
    });
});

describe('entryZoneTop', () => {
    it('takes the highest usable entry price', () => {
        expect(entryZoneTop([98, 100, 99])).toBe(100);
    });

    it('returns null when no entry price is usable', () => {
        expect(entryZoneTop([])).toBeNull();
        expect(entryZoneTop([0, -1, Number.NaN])).toBeNull();
        expect(entryZoneTop(undefined)).toBeNull();
    });
});

describe('buildPlanCheck', () => {
    const plan = rec({
        entryPrices: [98, 100],
        stopLoss: 95,
        takeProfitPrices: [110],
    });

    it('reports both ratios so the gap between plan and market is visible', () => {
        const check = buildPlanCheck(plan, 105, 99);
        expect(check).not.toBeNull();
        // From the plan's own entry the trade looks like 2.75:1 …
        expect(check?.riskRewardAtEntry).toBeCloseTo((110 - 99) / (99 - 95));
        // … and from the price a reader is actually looking at, 0.5:1.
        expect(check?.riskRewardAtCurrent).toBeCloseTo(
            (110 - 105) / (105 - 95)
        );
        expect(check?.exceedsEntryZone).toBe(true);
        expect(check?.entryZoneTop).toBe(100);
    });

    it('reports zero upside when the market has passed every target', () => {
        const check = buildPlanCheck(plan, 115, 99);
        expect(check?.riskRewardAtCurrent).toBe(0);
        // The plan's own arithmetic is untouched — this is a statement about the market,
        // not a claim that the analysis was wrong when written.
        expect(check?.riskRewardAtEntry).toBeGreaterThan(0);
    });

    it('distinguishes a void plan from an unknown one', () => {
        const check = buildPlanCheck(plan, 94, 99);
        expect(check?.belowStopLoss).toBe(true);
        // Ratio is null here (price is below the stop), so without the flag the caller
        // could not tell "plan already stopped out" from "inputs missing".
        expect(check?.riskRewardAtCurrent).toBeNull();
    });

    it('measures against reconciled levels, not the AI levels the domain rejected', () => {
        // reconcileBullishActionRecommendation leaves the AI's own fields untouched by
        // design, so reading rec.stopLoss directly measures against a level already
        // judged invalid. Here the AI's stop (200) sits above its own entry; the domain
        // corrected it to 97. Without the fix this reports belowStopLoss for a chart
        // trading at 100 and suppresses the ratio entirely.
        const rejected = rec({
            entryPrices: [100],
            stopLoss: 200,
            takeProfitPrices: [105],
            reconciledLevels: {
                stopLoss: 97,
                takeProfitPrices: [105],
                exit: '',
                riskReward: '',
                reason: '',
            },
        });

        const check = buildPlanCheck(rejected, 100, 100);

        expect(check?.belowStopLoss).toBe(false);
        expect(check?.riskRewardAtCurrent).toBeCloseTo(
            (105 - 100) / (100 - 97)
        );
    });

    it('discards a stop that sits at or above the entry instead of measuring against it', () => {
        // Reconciliation is skipped for an `avoid` verdict, so nothing corrects the level
        // here. A "stop" above the entry is not a stop a long could act on; reporting the
        // plan as already stopped out because of it would be a fabricated finding.
        const nonsense = rec({
            entryRecommendation: 'avoid',
            entryPrices: [100],
            stopLoss: 200,
            takeProfitPrices: [105],
        });

        const check = buildPlanCheck(nonsense, 100, 100);

        expect(check?.belowStopLoss).toBe(false);
        expect(check?.riskRewardAtCurrent).toBeNull();
        expect(check?.riskRewardAtEntry).toBeNull();
    });

    it('falls back to the AI levels when nothing was reconciled', () => {
        const check = buildPlanCheck(plan, 105, 99);
        expect(check?.riskRewardAtCurrent).toBeCloseTo(
            (110 - 105) / (105 - 95)
        );
    });

    it('returns null without a usable current price instead of substituting the entry', () => {
        // Substituting would report "price is exactly where the plan wants it" — a claim
        // the inputs do not support.
        expect(buildPlanCheck(plan, undefined, 99)).toBeNull();
        expect(buildPlanCheck(plan, Number.NaN, 99)).toBeNull();
        expect(buildPlanCheck(plan, 0, 99)).toBeNull();
    });

    it('still produces a check for a plan with no levels at all', () => {
        const check = buildPlanCheck(rec(), 105, undefined);
        expect(check).toEqual({
            currentPrice: 105,
            entryZoneTop: null,
            exceedsEntryZone: false,
            belowStopLoss: false,
            riskRewardAtEntry: null,
            riskRewardAtCurrent: null,
        });
    });
});
