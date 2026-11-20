import {
    effectiveStopLoss,
    entryZoneBottom,
    entryZoneTop,
} from '@/domain/analysis/planCheck';
import type { ActionRecommendation } from '@/domain/types';

/**
 * @internal
 * Stable ids of the rules {@link checkPlanInvariants} evaluates.
 */
export type PlanInvariantId =
    | 'finite'
    | 'stop_below_zone'
    | 'targets_above_zone'
    | 'targets_ascending'
    | 'reconciled_subset'
    | 'plan_check_consistent'
    | 'avoid_untouched';

/**
 * @internal
 * One broken rule; `detail` names the offending values for a human reading a report.
 */
export interface PlanInvariantViolation {
    readonly id: PlanInvariantId;
    readonly detail: string;
}

function finitePositive(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * The plan prices as a reader sees them: the stop is {@link effectiveStopLoss} (the rule the
 * plan check and the risk:reward line share, so the invariants judge the stop they measured
 * against), the targets are the reconciled array where core wrote one.
 */
function effectivePlan(rec: ActionRecommendation): {
    stop: number | undefined;
    targets: readonly number[];
} {
    return {
        stop: effectiveStopLoss(rec),
        targets:
            rec.reconciledLevels?.takeProfitPrices ??
            rec.takeProfitPrices ??
            [],
    };
}

function isStrictlyAscending(values: readonly number[]): boolean {
    return values.every((value, i) => i === 0 || value > values[i - 1]);
}

/**
 * @internal
 *
 * Structural rules every analysis plan must satisfy after post-processing, evaluated on
 * the **effective** plan: the stop is `effectiveStopLoss` (the reconciled stop where core wrote
 * one, else the model's; none when it was rejected), the targets are `reconciledLevels` ones
 * when that array exists (else the model's), and the zone is the min/max of the finite
 * positive `entryPrices`.
 *
 * Rules other than `avoid_untouched` apply when `entryRecommendation !== 'avoid'` and a
 * zone exists. `avoid_untouched` applies to an `avoid` verdict regardless of zone.
 * Pure measurement: a violation is reported, never repaired.
 *
 * @param rec - The post-processed recommendation, or `undefined` when the analysis has none.
 * @param lastClose - The close the analysis was anchored to (`planCheck.currentPrice`).
 * @returns The violated rules, `[]` for a plan that holds every rule.
 */
export function checkPlanInvariants(
    rec: ActionRecommendation | undefined,
    lastClose: number
): readonly PlanInvariantViolation[] {
    if (rec === undefined) return [];
    if (rec.entryRecommendation === 'avoid') {
        return rec.reconciledLevels === undefined
            ? []
            : [
                  {
                      id: 'avoid_untouched',
                      detail: 'an avoid verdict carries reconciledLevels',
                  },
              ];
    }

    const zoneLow = entryZoneBottom(rec.entryPrices);
    const zoneHigh = entryZoneTop(rec.entryPrices);
    if (zoneLow === null || zoneHigh === null) return [];

    const { stop, targets } = effectivePlan(rec);
    const modelTargets = rec.takeProfitPrices ?? [];
    const reconciledTargets = rec.reconciledLevels?.takeProfitPrices ?? [];

    const badPrices = [
        ...(rec.entryPrices ?? []),
        ...(stop === undefined ? [] : [stop]),
        ...targets,
    ].filter(price => !finitePositive(price));
    const notAbove = targets.filter(target => !(target > zoneHigh));
    const foreign = reconciledTargets.filter(
        target => !modelTargets.includes(target)
    );

    const findings: readonly (PlanInvariantViolation | null)[] = [
        badPrices.length > 0
            ? {
                  id: 'finite',
                  detail: `non-finite or non-positive: ${badPrices.join(', ')}`,
              }
            : null,
        stop !== undefined && finitePositive(stop) && stop >= zoneLow
            ? {
                  id: 'stop_below_zone',
                  detail: `stop ${stop} >= zone low ${zoneLow}`,
              }
            : null,
        notAbove.length > 0
            ? {
                  id: 'targets_above_zone',
                  detail: `targets ${notAbove.join(', ')} <= zone high ${zoneHigh}`,
              }
            : null,
        isStrictlyAscending(targets)
            ? null
            : {
                  id: 'targets_ascending',
                  detail: `targets ${targets.join(', ')}`,
              },
        foreign.length > 0
            ? {
                  id: 'reconciled_subset',
                  detail: `reconciled targets ${foreign.join(', ')} not in the model's ${modelTargets.join(', ')}`,
              }
            : null,
        planCheckViolation(rec, lastClose, zoneHigh),
    ];
    return findings.filter(
        (finding): finding is PlanInvariantViolation => finding !== null
    );
}

function isNullOrNonNegative(value: number | null): boolean {
    return value === null || (Number.isFinite(value) && value >= 0);
}

/** The first way `rec.planCheck` disagrees with the plan it was computed for, or `null`. */
function planCheckViolation(
    rec: ActionRecommendation,
    lastClose: number,
    zoneHigh: number
): PlanInvariantViolation | null {
    const { planCheck } = rec;
    const detail = ((): string | null => {
        if (planCheck === undefined) return 'planCheck is missing';
        if (planCheck.currentPrice !== lastClose) {
            return `currentPrice ${planCheck.currentPrice} !== last close ${lastClose}`;
        }
        if (planCheck.entryZoneTop !== zoneHigh) {
            return `entryZoneTop ${planCheck.entryZoneTop} !== zone high ${zoneHigh}`;
        }
        if (
            !isNullOrNonNegative(planCheck.riskRewardAtEntry) ||
            !isNullOrNonNegative(planCheck.riskRewardAtCurrent)
        ) {
            return `risk:reward ${planCheck.riskRewardAtEntry} / ${planCheck.riskRewardAtCurrent} is neither null nor finite >= 0`;
        }
        return null;
    })();
    return detail === null ? null : { id: 'plan_check_consistent', detail };
}
