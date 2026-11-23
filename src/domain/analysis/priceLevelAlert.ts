import {
    effectiveStopLoss,
    entryZoneBottom,
    entryZoneTop,
    positionAgainstZone,
} from '@/domain/analysis/planCheck';
import type { ActionRecommendation, Bar } from '@/domain/types';

/**
 * Price-level alerts: which level of a stored plan an alert can watch, and when a daily
 * close has met it.
 *
 * The alert and the analysis card must never disagree about the same close, so every
 * comparison here is the plan rule itself: the zone and the stop are read the way
 * `buildPlanState` / `buildPlanCheck` read them (`effectiveStopLoss`, the zone's min and
 * max usable entry price), and the edges are inclusive with no tolerance
 * (`zoneLow <= close <= zoneTop` is `in_zone`, `close <= stop` is a broken stop).
 *
 * Pure: bars and prices come from the caller; nothing is fetched or stored here.
 */

/** The levels of a plan an alert can watch, read with the same rules the plan card uses. */
export interface AlertablePlanLevels {
    /** Entry zone edges (`[price]` gives `low === high`). `null` without a finite positive entry price. */
    readonly entryZone: { readonly low: number; readonly high: number } | null;
    /**
     * `effectiveStopLoss(rec)` when finite, positive and below `entryZone.low` (any positive
     * stop when there is no zone); otherwise `null`.
     */
    readonly invalidation: number | null;
}

/** What an alert waits for. Zone alerts record the side the price starts on. */
export type PriceLevelCondition =
    | {
          readonly kind: 'enter_zone';
          readonly low: number;
          readonly high: number;
          readonly approach: 'from_above' | 'from_below';
      }
    | { readonly kind: 'close_below'; readonly level: number }
    | { readonly kind: 'close_above'; readonly level: number };

/** A would-be alert before it is anchored to a close: the zone or the single level to watch. */
export type PriceLevelTarget =
    | {
          readonly kind: 'zone';
          readonly low: number;
          readonly high: number;
      }
    | { readonly kind: 'below' | 'above'; readonly level: number };

/** Result of {@link priceLevelStart}. */
export type PriceLevelStart =
    | { readonly ok: true; readonly condition: PriceLevelCondition }
    | {
          readonly ok: false;
          /**
           * `inside`: the close is already in the zone; `met`: the level is already crossed
           * (nothing left to wait for); `invalid`: an unusable close or level.
           */
          readonly reason: 'inside' | 'met' | 'invalid';
      };

/** The first bar that met a `close_below` / `close_above` condition. */
export interface PriceLevelTrigger {
    /** Index into the `bars` array that was searched. */
    readonly index: number;
    /** `Bar.time` of the triggering bar, unchanged. */
    readonly time: number;
    /** Close of the triggering bar. */
    readonly close: number;
}

/**
 * The first bar that met an `enter_zone` condition. `position` is where that close sits against
 * the zone: `inside` is a close in the zone, `above` / `below` a close that jumped past it. The
 * same comparison the plan state makes, so the caller words the mail from core's rule instead
 * of re-deriving it.
 */
export interface PriceLevelZoneTrigger extends PriceLevelTrigger {
    readonly position: 'inside' | 'below' | 'above';
}

const isFinitePositive = (value: number): boolean =>
    Number.isFinite(value) && value > 0;

/**
 * Read the entry zone and the invalidation level an alert can watch from a plan.
 *
 * The zone is the min and max of the finite positive `entryPrices` (order-independent, like
 * the plan state). The invalidation is the plan's own effective stop: the reconciled one
 * unless core rejected it, else the model's. A stop that is not below the zone's low edge
 * is not a level the plan could act on, so it is `null` (the plan check drops it the same
 * way); with no zone any positive stop is kept.
 *
 * @param rec - The post-reconciliation recommendation of a stored analysis.
 * @returns The zone and the invalidation level, each `null` when the plan has no usable one.
 */
export function alertablePlanLevels(
    rec: ActionRecommendation
): AlertablePlanLevels {
    const low = entryZoneBottom(rec.entryPrices);
    const high = entryZoneTop(rec.entryPrices);
    const entryZone = low === null || high === null ? null : { low, high };

    const stop = effectiveStopLoss(rec);
    const usableStop =
        stop !== undefined &&
        isFinitePositive(stop) &&
        (entryZone === null || stop < entryZone.low);

    return { entryZone, invalidation: usableStop ? stop : null };
}

/**
 * Anchor a target to the close it is proposed against.
 *
 * A zone becomes `enter_zone` with the side the close is on (`from_above` when the close is
 * above the zone, `from_below` when below). A close already inside the zone, or already at
 * or beyond a level (`close <= level` for `below`, `close >= level` for `above`), has
 * nothing left to wait for and is reported instead of producing an alert that would fire on
 * the first evaluation.
 *
 * `invalid` covers a non-finite or non-positive close, level or zone edge, and a zone whose
 * `low` is above its `high`.
 *
 * @param close - The close the alert is proposed against (the last session's close).
 * @param target - The zone or single level to watch.
 * @returns The anchored condition, or why there is nothing to wait for.
 */
export function priceLevelStart(
    close: number,
    target: PriceLevelTarget
): PriceLevelStart {
    if (!isFinitePositive(close)) return { ok: false, reason: 'invalid' };

    if (target.kind === 'zone') {
        const { low, high } = target;
        if (!isFinitePositive(low) || !isFinitePositive(high) || low > high) {
            return { ok: false, reason: 'invalid' };
        }
        const position = positionAgainstZone(close, low, high);
        if (position === 'inside') return { ok: false, reason: 'inside' };
        return {
            ok: true,
            condition: {
                kind: 'enter_zone',
                low,
                high,
                approach: position === 'above' ? 'from_above' : 'from_below',
            },
        };
    }

    const { level } = target;
    if (!isFinitePositive(level)) return { ok: false, reason: 'invalid' };
    if (target.kind === 'below') {
        return close <= level
            ? { ok: false, reason: 'met' }
            : { ok: true, condition: { kind: 'close_below', level } };
    }
    return close >= level
        ? { ok: false, reason: 'met' }
        : { ok: true, condition: { kind: 'close_above', level } };
}

/**
 * Whether one close meets the condition. Edges are inclusive, matching the plan state:
 *
 * - `enter_zone` `from_above`: `close <= high`; `from_below`: `close >= low`. The far side is
 *   deliberately open: a close that reached the zone's near edge or went past it counts, even
 *   when it lies beyond the zone's far edge.
 * - `close_below`: `close <= level`; `close_above`: `close >= level`.
 *
 * A non-finite or non-positive close never meets anything (DOM-1): it is bad data, not a
 * price (`close <= level` would otherwise fire on a `0`).
 *
 * @param close - One session's close.
 * @param condition - The condition to test.
 * @returns Whether the close meets it.
 */
export function isPriceLevelMet(
    close: number,
    condition: PriceLevelCondition
): boolean {
    if (!isFinitePositive(close)) return false;
    switch (condition.kind) {
        case 'enter_zone':
            return condition.approach === 'from_above'
                ? close <= condition.high
                : close >= condition.low;
        case 'close_below':
            return close <= condition.level;
        case 'close_above':
            return close >= condition.level;
    }
}

/**
 * The first bar, oldest first, whose close meets the condition; `null` when none does.
 *
 * `bars` must already be restricted to the sessions the alert may fire on (after its
 * creation, up to the evaluation date); this reads closes only. "After creation" means the
 * sessions after the last session that was closed when the alert was proposed, so the
 * proposal-day close never fires it. Bars with a non-finite or non-positive close are skipped
 * (DOM-1), so a corrupt bar neither fires an alert nor hides a later one.
 *
 * The closes and the condition's levels must be on one price basis: bars are split-adjusted
 * while a level stored at creation time is not, so a split between the two makes the comparison
 * meaningless. Detecting that is the caller's job (siglens voids the alert on a price-scale
 * jump); nothing here can see it.
 *
 * @param bars - Daily bars, oldest first.
 * @param condition - The condition to look for.
 * @returns The first meeting bar, or `null`. An `enter_zone` condition gives a
 *   {@link PriceLevelZoneTrigger} (with `position`); a level condition gives a {@link PriceLevelTrigger}.
 */
export function findPriceLevelTrigger(
    bars: readonly Bar[],
    condition: Extract<PriceLevelCondition, { kind: 'enter_zone' }>
): PriceLevelZoneTrigger | null;
export function findPriceLevelTrigger(
    bars: readonly Bar[],
    condition: Exclude<PriceLevelCondition, { kind: 'enter_zone' }>
): PriceLevelTrigger | null;
export function findPriceLevelTrigger(
    bars: readonly Bar[],
    condition: PriceLevelCondition
): PriceLevelTrigger | PriceLevelZoneTrigger | null;
export function findPriceLevelTrigger(
    bars: readonly Bar[],
    condition: PriceLevelCondition
): PriceLevelTrigger | PriceLevelZoneTrigger | null {
    const index = bars.findIndex(bar => isPriceLevelMet(bar.close, condition));
    if (index === -1) return null;
    const { time, close } = bars[index];
    const trigger = { index, time, close };
    return condition.kind === 'enter_zone'
        ? {
              ...trigger,
              position: positionAgainstZone(
                  close,
                  condition.low,
                  condition.high
              ),
          }
        : trigger;
}
