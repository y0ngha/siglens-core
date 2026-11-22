import { describe, it, expect } from 'vitest';
import {
    buildPlanCheck,
    effectiveStopLoss,
    entryZoneTop,
    exceedsEntryZone,
    nearestTargetAbove,
    positionAgainstZone,
    riskRewardFrom,
} from '@/domain/analysis/planCheck';
import type { ActionRecommendation } from '@/domain/types';

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

describe('positionAgainstZone', () => {
    it('reads both edges as inside (zoneLow <= close <= zoneTop)', () => {
        expect(positionAgainstZone(100, 98, 100)).toBe('inside');
        expect(positionAgainstZone(98, 98, 100)).toBe('inside');
        expect(positionAgainstZone(99, 98, 100)).toBe('inside');
    });

    it('reads one tick beyond an edge as outside, with no tolerance band', () => {
        expect(positionAgainstZone(100.01, 98, 100)).toBe('above');
        expect(positionAgainstZone(97.99, 98, 100)).toBe('below');
        // Inside the old 1% band above the top: still above.
        expect(positionAgainstZone(100.5, 98, 100)).toBe('above');
    });
});

describe('exceedsEntryZone', () => {
    it('flags a price above the zone top', () => {
        expect(exceedsEntryZone(102, [98, 100])).toBe(true);
    });

    it('flags a price just above the top, where the old 1% band said no', () => {
        expect(exceedsEntryZone(100.01, [100])).toBe(true);
        expect(exceedsEntryZone(100.5, [98, 100])).toBe(true);
    });

    it('does not flag a price at the zone top or inside the zone', () => {
        expect(exceedsEntryZone(100, [98, 100])).toBe(false);
        expect(exceedsEntryZone(99, [98, 100])).toBe(false);
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

    it('discards a stop inside the entry zone (below the mid, above the low edge)', () => {
        const insideZone = rec({
            entryRecommendation: 'avoid',
            entryPrices: [96, 104],
            stopLoss: 98,
            takeProfitPrices: [110],
        });

        const check = buildPlanCheck(insideZone, 100, 100);

        expect(check?.belowStopLoss).toBe(false);
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

describe('effectiveStopLoss', () => {
    const levels = { exit: '', riskReward: '', reason: '' };

    it('is the model stop when nothing was reconciled', () => {
        expect(effectiveStopLoss(rec({ stopLoss: 95 }))).toBe(95);
    });

    it('prefers the reconciled stop', () => {
        expect(
            effectiveStopLoss(
                rec({
                    stopLoss: 120,
                    reconciledLevels: { ...levels, stopLoss: 94 },
                })
            )
        ).toBe(94);
    });

    it('is the model stop when the reconciled levels carry none', () => {
        expect(
            effectiveStopLoss(
                rec({ stopLoss: 95, reconciledLevels: { ...levels } })
            )
        ).toBe(95);
    });

    it('is no stop at all when the model stop was rejected', () => {
        expect(
            effectiveStopLoss(
                rec({
                    stopLoss: 112,
                    reconciledLevels: { ...levels, stopLossRejected: true },
                })
            )
        ).toBeUndefined();
    });

    it('lets buildPlanCheck report no stop and no ratio for a rejected stop', () => {
        const check = buildPlanCheck(
            rec({
                entryPrices: [98, 102],
                stopLoss: 112,
                takeProfitPrices: [107],
                reconciledLevels: { ...levels, stopLossRejected: true },
            }),
            100,
            100
        );

        expect(check?.belowStopLoss).toBe(false);
        expect(check?.riskRewardAtEntry).toBeNull();
        expect(check?.riskRewardAtCurrent).toBeNull();
    });
});
