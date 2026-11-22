import type {
    ActionRecommendation,
    PlanCheck,
    ReferenceLevels,
} from '@/domain/types';

/**
 * Deterministic arithmetic comparing a trade plan against the price that actually exists.
 *
 * The LLM authors `riskReward` as prose (`"손절 3% vs 목표 9% → 위험:보상 = 1:3"`), which
 * means the single most decision-relevant number in the analysis is neither computed nor
 * checkable. It is also computed against the plan's *own* entry, so a plan whose entry zone
 * the market has already left still reads as attractive.
 *
 * That gap was observed in practice. On live prices, the recommended
 * take-profit sometimes sat **below the current price** and the nearest resistance below it
 * more often still — the plan was unreachable the moment it was read. Worse, the effect
 * concentrated exactly where conviction was highest: bucketed by composite score, median
 * risk:reward fell toward **0** in the highest band. By the time the indicators agreed, price had already travelled to where
 * the analysis was aiming.
 *
 * Nothing here overrides the AI. It measures, names the gap, and leaves the verdict alone.
 */

/**
 * @internal
 *
 * Slack allowed above the entry zone before price counts as having left it (1%).
 *
 * The zone is an AI approximation and the reference price is a single close, so trimming on
 * a fractional overshoot reports noise rather than a fact. Too wide and a genuine chase
 * reads as "still in the zone".
 */
export const ENTRY_ZONE_TOLERANCE = 0.01;

/**
 * @internal Minimum distance, in ATR, between the entry zone and the stop below it, and
 * between the zone's top and the nearest target above it.
 *
 * One constant for both sides on purpose (CP-11): the stop floor (`ai-levels.ts`), the
 * `no_room_above` rule of `buildPlanState` and the `### Stop & Target Spacing` prompt block
 * all state the same one-ATR distance. A stop closer than this is hit by one ordinary bar:
 * in a two-year daily backtest of 10 U.S. large caps the stops a median 0.52 ATR below the
 * zone were hit within two sessions in 87% of the 278 trades whose first exit was the stop.
 */
export const PLAN_MIN_ATR_SPACING = 1;

/**
 * @internal
 *
 * The stop a plan is actually read with: the reconciled one where core wrote it, else the
 * model's. `reconciledLevels.stopLossRejected` means the model's stop was refused and no
 * replacement exists, so there is **no** stop — falling back to `rec.stopLoss` would put the
 * rejected value back.
 *
 * The one rule every reader of the plan's stop shares. Its callers: `buildPlanCheck`
 * (here), the risk:reward line in `postProcessAnalysisWithReconcile` (`ai-levels.ts`),
 * `buildChatPrompt` and `checkPlanInvariants`. The value is returned as stored: a
 * reconciled stop that is present but unusable (non-finite, `<= 0`) is not skipped in
 * favour of the model's, so a reader that must judge usability (the invariants' `finite`
 * rule) does so on exactly the value the plan check measured against.
 */
export function effectiveStopLoss(
    rec: ActionRecommendation
): number | undefined {
    const levels = rec.reconciledLevels;
    return levels?.stopLossRejected === true
        ? undefined
        : (levels?.stopLoss ?? rec.stopLoss);
}

function finitePositive(n: number | undefined): n is number {
    return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * @internal
 *
 * The nearest finite target strictly above `price`, or `undefined` when none is.
 *
 * The single rule both risk:reward paths use — {@link riskRewardFrom}'s ratio and
 * `buildBullishRiskRewardText`'s deterministic line (`ai-levels.ts`) both call this
 * instead of each re-implementing the selection, which is how the two drifted apart
 * before. Reward is measured to the nearest target, not the furthest: that is the first
 * one an exit rule fires on, so counting a further target credits profit the plan will
 * not actually realise.
 *
 * The filter is "finite and > price", not `finitePositive`, because both callers only
 * reach here with `price > 0`: `riskRewardFrom` checks `finitePositive(price)` first,
 * and `buildBullishRiskRewardText` returns early unless `0 < stopLoss < entryPrice`,
 * which implies a positive `entryPrice`. Anything strictly above such a price is
 * positive too.
 */
export function nearestTargetAbove(
    price: number,
    targets: readonly number[] | undefined
): number | undefined {
    const above = (targets ?? []).filter(
        (candidate): candidate is number =>
            Number.isFinite(candidate) && candidate > price
    );
    return above.length === 0 ? undefined : Math.min(...above);
}

/**
 * @internal
 *
 * Risk:reward for a long from `price`, given a stop below and take-profit targets above.
 *
 * Reward is measured to the nearest target above `price` — see {@link nearestTargetAbove}
 * for that selection rule.
 *
 * Returns `0` when targets were supplied but all sit at or below `price`, and `null` when
 * the ratio is undefined (no usable stop, stop at or above `price`, or no targets at all).
 */
export function riskRewardFrom(
    price: number,
    stopLoss: number | undefined,
    takeProfitPrices: readonly number[] | undefined
): number | null {
    if (!finitePositive(price)) return null;
    if (!finitePositive(stopLoss) || stopLoss >= price) return null;

    const targets = (takeProfitPrices ?? []).filter(finitePositive);
    if (targets.length === 0) return null;

    const nearest = nearestTargetAbove(price, targets);
    if (nearest === undefined) return 0;

    return (nearest - price) / (price - stopLoss);
}

/**
 * @internal
 *
 * Risk:reward from `price` to the nearest structural levels on either side.
 *
 * Unlike {@link riskRewardFrom} this needs no plan — it runs on the deterministic
 * support/resistance the domain already derives, so it is available **before** the model
 * writes anything. That ordering is the point: the model can be told "the nearest thing
 * above you is 0.4% away and the nearest thing below is 2.7% away" while it still has the
 * chance to answer "wait".
 *
 * Both sides carry a signed `distancePercent` relative to the same current price, so the
 * ratio needs no price argument.
 */
export function structuralRiskReward(levels: ReferenceLevels): number | null {
    const up = levels.resistance[0];
    const down = levels.support[0];
    if (!up || !down) return null;

    const reward = up.distancePercent;
    const risk = Math.abs(down.distancePercent);
    if (!Number.isFinite(reward) || !Number.isFinite(risk) || risk === 0) {
        return null;
    }
    // `resistance` is defined as the levels above current price and `support` as the ones
    // below, so a sign that contradicts either definition means the collector produced
    // something inconsistent. That is "unmeasurable", not "no upside" — and on the support
    // side `Math.abs` above would otherwise launder a positive distance into a
    // plausible-looking ratio.
    if (reward <= 0 || down.distancePercent > 0) return null;

    return reward / risk;
}

/**
 * @internal
 *
 * Whether the current price has risen past the top of the recommended entry zone.
 *
 * Only the upper side is checked. Price *below* the zone is cheaper than the plan asked
 * for, which is not the failure mode this describes.
 */
export function exceedsEntryZone(
    price: number,
    entryPrices: readonly number[] | undefined,
    tolerance: number = ENTRY_ZONE_TOLERANCE
): boolean {
    if (!finitePositive(price)) return false;
    const top = entryZoneTop(entryPrices);
    if (top === null) return false;
    const safeTolerance =
        Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : 0;
    return price > top * (1 + safeTolerance);
}

/**
 * @internal
 *
 * Highest usable entry price in the plan, or `null` when none is usable.
 */
export function entryZoneTop(
    entryPrices: readonly number[] | undefined
): number | null {
    const usable = (entryPrices ?? []).filter(finitePositive);
    return usable.length === 0 ? null : Math.max(...usable);
}

/**
 * @internal
 *
 * Lowest usable entry price in the plan, or `null` when none is usable — the low
 * edge of the zone, whatever order `entryPrices` came in.
 */
export function entryZoneBottom(
    entryPrices: readonly number[] | undefined
): number | null {
    const usable = (entryPrices ?? []).filter(finitePositive);
    return usable.length === 0 ? null : Math.min(...usable);
}

/**
 * Build the deterministic plan check for one recommendation.
 *
 * `entryPrice` is the plan's own reference (the mid of its entry zone), `currentPrice` the
 * last close. They are usually different, and the whole point of this record is to report
 * by how much.
 *
 * Returns `null` only when `currentPrice` is unusable — with no price to compare against,
 * every field would be a guess.
 *
 * @param rec - The recommendation to check; its reconciled levels win over the AI's own.
 * @param currentPrice - The price to measure against (a live quote or the last close).
 * @param entryPrice - The plan's entry reference — use {@link planEntryPrice} for the same
 *   reference the analysis pipeline uses.
 * @returns The plan check, or `null` when `currentPrice` is not a finite positive number.
 */
export function buildPlanCheck(
    rec: ActionRecommendation,
    currentPrice: number | undefined,
    entryPrice: number | undefined
): PlanCheck | null {
    if (!finitePositive(currentPrice)) return null;

    // Reconciled levels win where they exist. `reconcileBullishActionRecommendation`
    // leaves the AI's own fields untouched by design, so reading `rec.stopLoss` directly
    // would measure against a level the domain already rejected: an AI stop of 200 under
    // a 100 entry would report `belowStopLoss` for a chart trading at 100, and suppress
    // the ratio entirely — in exactly the case a computed ratio is most needed.
    const proposedStop = effectiveStopLoss(rec);
    const targets =
        rec.reconciledLevels?.takeProfitPrices ?? rec.takeProfitPrices;

    // A long's stop sits below its entry. One that does not is not a stop the plan could
    // ever act on, so it is dropped rather than measured against. The reconciled value
    // above covers most of these, but not all: a model stop with no usable ATR to replace it
    // is rejected, and a caller can hand in an analysis that never went through
    // reconciliation; the raw AI level would otherwise report a plan as "already stopped
    // out" simply because its stop was nonsense.
    //
    // "Below its entry" is measured against the zone's low edge, not only the mid: a
    // stop inside the zone is hit by a fill at the zone's low.
    const entryLow = entryZoneBottom(rec.entryPrices);
    const stopLoss =
        finitePositive(entryPrice) &&
        finitePositive(proposedStop) &&
        (proposedStop >= entryPrice ||
            (entryLow !== null && proposedStop >= entryLow))
            ? undefined
            : proposedStop;

    return {
        currentPrice,
        entryZoneTop: entryZoneTop(rec.entryPrices),
        exceedsEntryZone: exceedsEntryZone(currentPrice, rec.entryPrices),
        belowStopLoss: finitePositive(stopLoss) && currentPrice <= stopLoss,
        riskRewardAtEntry: finitePositive(entryPrice)
            ? riskRewardFrom(entryPrice, stopLoss, targets)
            : null,
        riskRewardAtCurrent: riskRewardFrom(currentPrice, stopLoss, targets),
    };
}
