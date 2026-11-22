import {
    effectiveStopLoss,
    entryZoneBottom,
    entryZoneTop,
    PLAN_MIN_ATR_SPACING,
    positionAgainstZone,
} from '@/domain/analysis/planCheck';
import type {
    ActionRecommendation,
    EntryRecommendation,
    NoSetupReason,
    PlanCheck,
    PlanPosition,
    PlanState,
    StopBasis,
} from '@/domain/types';

/**
 * @internal
 * The verdict each plan position stands for. Exhaustive over {@link PlanPosition} by
 * `satisfies`: adding a position without choosing its verdict does not compile.
 *
 * `entryRecommendation` is overwritten from this table whenever a plan state exists (the
 * `riskLevel` and `trend` precedent): the model's own verdict had no rubric, was `wait` on 95%
 * of analyses, and on half of those `wait` plans the close already sat inside the plan's own
 * entry zone (a two-year daily backtest of 10 U.S. large caps, 1,107 `wait` plans).
 */
export const ENTRY_RECOMMENDATION_BY_POSITION = {
    in_zone: 'enter',
    above_zone: 'wait',
    below_zone: 'wait',
    no_setup: 'avoid',
} as const satisfies Record<PlanPosition, EntryRecommendation>;

const DISTANCE_DECIMALS = 2;

const isFinitePositive = (value: number | null | undefined): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0;

/** ATR multiples are stored at 2 decimals, like `trendBasis.slopeAtr`. */
function roundAtrMultiple(value: number): number {
    const factor = 10 ** DISTANCE_DECIMALS;
    return Math.round(value * factor) / factor;
}

/** `distance / atr` rounded for storage; `null` without a usable ATR. */
function inAtr(distance: number, atr: number | null): number | null {
    return atr === null ? null : roundAtrMultiple(distance / atr);
}

/**
 * The stop's origin for a plan read back from storage or built live. Core stamps
 * `reconciledLevels.stopBasis` when it moved the stop; a stop the model chose carries no
 * stamp and no reconciled stop that differs from it. A reconciled stop with no stamp that
 * differs from the model's one was moved by a version that did not record why (an analysis
 * stored before the field existed), so its origin is `null`, not `model`.
 */
function stopBasisOf(
    rec: ActionRecommendation,
    stop: number | undefined
): StopBasis | null {
    if (stop === undefined) return null;
    const stamped = rec.reconciledLevels?.stopBasis;
    if (stamped !== undefined) return stamped;
    return stop === rec.stopLoss ? 'model' : null;
}

/** The plan's effective targets: the reconciled array where core wrote one, else the model's. */
function effectiveTargets(rec: ActionRecommendation): readonly number[] {
    return (
        rec.reconciledLevels?.takeProfitPrices ??
        rec.takeProfitPrices ??
        []
    ).filter(isFinitePositive);
}

/**
 * Whether some target lies at least one ATR above the zone top (`PLAN_MIN_ATR_SPACING`);
 * with no usable ATR, any target strictly above it counts.
 */
function hasTargetRoom(
    targets: readonly number[],
    zoneTop: number,
    atr: number | null
): boolean {
    return targets.some(target =>
        atr === null
            ? target > zoneTop
            : target >= zoneTop + PLAN_MIN_ATR_SPACING * atr
    );
}

/**
 * Build the state of one plan against the price its `planCheck` was measured with.
 *
 * Reads the **reconciled** plan (effective stop and targets, entry zone) and the plan check
 * (`currentPrice`, `belowStopLoss`, `exceedsEntryZone`) — it measures nothing itself, so the
 * agent's live-price state (a plan check built against a live quote) and the stored one use
 * one rule. First matching row wins:
 *
 * 1. no finite positive entry price: `no_setup` / `no_zone`
 * 2. no effective stop (none given and none derivable, the model's was rejected, or the zone
 *    is too wide for any stop to fit the band): `no_setup` / `no_stop`
 * 3. `planCheck.belowStopLoss` (close at or below the stop): `no_setup` / `stopped`
 * 4. no reconciled target at least one ATR above the zone top (any target above it when
 *    there is no usable ATR): `no_setup` / `no_room_above`
 * 5. `planCheck.exceedsEntryZone` (close above the zone top): `above_zone`
 * 6. close below the zone low: `below_zone`
 * 7. otherwise `in_zone` (`zoneLow <= close <= zoneTop`)
 *
 * Rows 5-7 are {@link positionAgainstZone}'s exact edges, with no tolerance: the same
 * comparison the outcome labeller's approach uses, so `in_zone` and a plan filled at the open
 * are the same fact (WP-18, N46).
 *
 * A risk:reward floor is deliberately **not** a row: after the stop floor the nearest
 * target gives a ratio below 1.0 on 88% of the plans of the 65-symbol daily replay set, so
 * any floor would turn most plans into `no_setup`, and the audit found the ratio not
 * predictive. `planCheck.riskRewardAtEntry` keeps showing the number.
 *
 * @param rec - The post-reconciliation recommendation.
 * @param planCheck - The plan check measured against the price to judge.
 * @param atr - ATR(14) of the last bar, `null` or non-positive when it is unusable.
 */
export function buildPlanState(
    rec: ActionRecommendation,
    planCheck: PlanCheck,
    atr: number | null
): PlanState {
    const usableAtr = isFinitePositive(atr) ? atr : null;
    const zoneLow = entryZoneBottom(rec.entryPrices);
    const zoneTop = entryZoneTop(rec.entryPrices);
    const rawStop = effectiveStopLoss(rec);
    const stop = isFinitePositive(rawStop) ? rawStop : undefined;
    const base = {
        atr: usableAtr,
        stopDistanceAtr:
            zoneLow === null || stop === undefined
                ? null
                : inAtr(zoneLow - stop, usableAtr),
        stopBasis: stopBasisOf(rec, stop),
    };
    const noSetup = (reason: NoSetupReason): PlanState => ({
        ...base,
        position: 'no_setup',
        reason,
    });

    if (zoneLow === null || zoneTop === null) return noSetup('no_zone');
    if (stop === undefined) return noSetup('no_stop');
    if (planCheck.belowStopLoss) return noSetup('stopped');
    if (!hasTargetRoom(effectiveTargets(rec), zoneTop, usableAtr)) {
        return noSetup('no_room_above');
    }

    const close = planCheck.currentPrice;
    if (planCheck.exceedsEntryZone) {
        return {
            ...base,
            position: 'above_zone',
            distanceAtr: inAtr(close - zoneTop, usableAtr),
        };
    }
    if (positionAgainstZone(close, zoneLow, zoneTop) === 'below') {
        return {
            ...base,
            position: 'below_zone',
            distanceAtr: inAtr(zoneLow - close, usableAtr),
        };
    }
    return {
        ...base,
        position: 'in_zone',
        distanceAtr: usableAtr === null ? null : 0,
    };
}
