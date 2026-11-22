import {
    effectiveStopLoss,
    entryZoneBottom,
    entryZoneTop,
    PLAN_MIN_ATR_SPACING,
} from '@/domain/analysis/planCheck';
import { SL_MAX_ATR_MULTIPLIER } from '@/domain/analysis/ai-levels';
import { ENTRY_RECOMMENDATION_BY_POSITION } from '@/domain/analysis/planState';
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
    | 'stop_floor'
    | 'stop_cap'
    | 'verdict_matches_state';

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
 * Every rule applies to every verdict when a zone exists (reconciliation no longer skips
 * `avoid`; the former `avoid_untouched` rule is retired with that skip):
 *
 * - `stop_floor`: with a usable `atr`, the effective stop is at least
 *   `PLAN_MIN_ATR_SPACING` ATR below the zone low. Without an ATR there is nothing to
 *   measure in and the rule is not evaluated.
 * - `stop_cap`: with a usable `atr`, the effective stop is at most `SL_MAX_ATR_MULTIPLIER` ATR
 *   below the zone's mid (the mean of the usable entry prices).
 * - `verdict_matches_state`: `entryRecommendation` is the one `planState.position` maps to
 *   (not evaluated for a result without a plan state).
 *
 * Pure measurement: a violation is reported, never repaired.
 *
 * @param rec - The post-processed recommendation, or `undefined` when the analysis has none.
 * @param lastClose - The close the analysis was anchored to (`planCheck.currentPrice`).
 * @param atr - ATR(14) of the last bar, or `null` / non-positive when unusable (`stop_floor`
 *   is then skipped). Required, like every parameter a rule's outcome depends on, so a
 *   caller cannot silently skip the floor.
 * @returns The violated rules, `[]` for a plan that holds every rule.
 */
export function checkPlanInvariants(
    rec: ActionRecommendation | undefined,
    lastClose: number,
    atr: number | null
): readonly PlanInvariantViolation[] {
    if (rec === undefined) return [];

    const zoneLow = entryZoneBottom(rec.entryPrices);
    const zoneHigh = entryZoneTop(rec.entryPrices);
    const verdict = verdictViolation(rec);
    if (zoneLow === null || zoneHigh === null) {
        return verdict === null ? [] : [verdict];
    }

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
        stopFloorViolation(stop, zoneLow, atr),
        stopCapViolation(stop, rec.entryPrices, atr),
        verdict,
    ];
    return findings.filter(
        (finding): finding is PlanInvariantViolation => finding !== null
    );
}

/** Slack on the one-ATR floor, so a stop exactly on it is not a float-noise violation. */
const STOP_FLOOR_EPSILON = 1e-9;

/** The stop sits closer than `PLAN_MIN_ATR_SPACING` ATR below the zone low, or `null`. */
function stopFloorViolation(
    stop: number | undefined,
    zoneLow: number,
    atr: number | null
): PlanInvariantViolation | null {
    if (stop === undefined || !finitePositive(stop)) return null;
    if (!finitePositive(atr)) return null;
    const ceiling = zoneLow - atr * PLAN_MIN_ATR_SPACING;
    return stop > ceiling + STOP_FLOOR_EPSILON
        ? {
              id: 'stop_floor',
              detail: `stop ${stop} is closer than ${PLAN_MIN_ATR_SPACING} ATR (${atr}) below zone low ${zoneLow}`,
          }
        : null;
}

/** The stop sits more than `SL_MAX_ATR_MULTIPLIER` ATR below the zone's mid, or `null`. */
function stopCapViolation(
    stop: number | undefined,
    entryPrices: readonly number[] | undefined,
    atr: number | null
): PlanInvariantViolation | null {
    if (stop === undefined || !finitePositive(stop)) return null;
    if (!finitePositive(atr)) return null;
    const usable = (entryPrices ?? []).filter(finitePositive);
    if (usable.length === 0) return null;
    const mid = usable.reduce((sum, p) => sum + p, 0) / usable.length;
    const floor = mid - atr * SL_MAX_ATR_MULTIPLIER;
    return stop < floor - STOP_FLOOR_EPSILON
        ? {
              id: 'stop_cap',
              detail: `stop ${stop} is more than ${SL_MAX_ATR_MULTIPLIER} ATR (${atr}) below zone mid ${mid}`,
          }
        : null;
}

/**
 * The verdict disagrees with the plan state it is computed from. A result without a plan
 * state (stored before the state existed, or analysed without a close) has nothing to
 * disagree with: the absence is `plan_check_consistent`'s business, not a verdict mismatch.
 */
function verdictViolation(
    rec: ActionRecommendation
): PlanInvariantViolation | null {
    const { planState } = rec;
    if (planState === undefined) return null;
    const expected = ENTRY_RECOMMENDATION_BY_POSITION[planState.position];
    return rec.entryRecommendation === expected
        ? null
        : {
              id: 'verdict_matches_state',
              detail: `entryRecommendation ${rec.entryRecommendation ?? 'missing'} !== ${expected} for ${planState.position}`,
          };
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
