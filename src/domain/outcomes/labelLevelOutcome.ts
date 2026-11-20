import {
    LEVEL_BARRIER_ATR,
    LEVEL_FOLLOW_BARS,
    LEVEL_MIN_DISTANCE_ATR,
    LEVEL_TOUCH_BAND_ATR,
    PLACEBO_SHIFT_ATR,
} from '@/domain/outcomes/constants';
import type {
    LevelBarEvent,
    LevelCore,
    LevelOutcome,
    LevelOutcomeLabel,
    LevelPlaceboLabel,
    LevelSide,
    LevelSkipReason,
    OutcomeWindow,
} from '@/domain/outcomes/types';
import {
    forwardBar,
    forwardOffsets,
    scannedBars,
} from '@/domain/outcomes/windowSeries';

function skipped(
    skipReason: LevelSkipReason,
    distanceAtr: number | null
): LevelCore {
    return {
        outcome: 'skipped',
        skipReason,
        distanceAtr,
        touchOffset: null,
        resolveOffset: null,
        gap: false,
    };
}

/**
 * First event of a follow bar for a level, in order: an open beyond the barrier is a gap
 * break, a close beyond it is a break, a close the other way past the barrier is a hold.
 * `sign` is `+1` for a support and `−1` for a resistance, which turns every comparison
 * around so one rule serves both sides.
 */
function barEvent(
    sign: 1 | -1,
    price: number,
    barrier: number,
    bar: { open: number; close: number }
): LevelBarEvent | null {
    if (sign * (bar.open - (price - sign * barrier)) < 0) {
        return { outcome: 'broken', gap: true };
    }
    if (sign * (bar.close - (price - sign * barrier)) < 0) {
        return { outcome: 'broken', gap: false };
    }
    if (sign * (bar.close - (price + sign * barrier)) > 0) {
        return { outcome: 'respected' };
    }
    return null;
}

function evaluate(
    side: LevelSide,
    price: number,
    window: OutcomeWindow
): LevelCore {
    const { atr, referencePrice } = window;
    if (atr === null || !(atr > 0)) return skipped('no_atr', null);
    const distanceAtr = Math.abs(price - referencePrice) / atr;
    if (price === referencePrice) return skipped('at_price', distanceAtr);
    if (
        side === 'support' ? price >= referencePrice : price <= referencePrice
    ) {
        return skipped('wrong_side', distanceAtr);
    }
    if (distanceAtr < LEVEL_MIN_DISTANCE_ATR) {
        return skipped('at_price', distanceAtr);
    }

    const sign = side === 'support' ? 1 : -1;
    const touchBand = LEVEL_TOUCH_BAND_ATR * atr;
    const barrier = LEVEL_BARRIER_ATR * atr;
    const touchOffset =
        forwardOffsets(window).find(offset => {
            const bar = forwardBar(window, offset);
            // support: low ≤ price + band; resistance: high ≥ price − band
            return side === 'support'
                ? bar.low <= price + touchBand
                : bar.high >= price - touchBand;
        }) ?? null;
    const base = {
        skipReason: null,
        distanceAtr,
        touchOffset,
        resolveOffset: null,
        gap: false,
    };
    if (touchOffset === null) return { ...base, outcome: 'untouched' };

    const lastFollow = Math.min(
        touchOffset + LEVEL_FOLLOW_BARS - 1,
        scannedBars(window)
    );
    const resolved = Array.from(
        { length: lastFollow - touchOffset + 1 },
        (_, i) => touchOffset + i
    )
        .map(offset => ({
            offset,
            event: barEvent(sign, price, barrier, forwardBar(window, offset)),
        }))
        .find(({ event }) => event !== null);
    if (resolved?.event) {
        return {
            ...base,
            outcome: resolved.event.outcome,
            resolveOffset: resolved.offset,
            gap: resolved.event.outcome === 'broken' && resolved.event.gap,
        };
    }
    const allObserved =
        touchOffset + LEVEL_FOLLOW_BARS - 1 <= scannedBars(window);
    const outcome: LevelOutcome = allObserved ? 'inconclusive' : 'touched_late';
    return { ...base, outcome };
}

/** `+PLACEBO_SHIFT_ATR` moves the level farther from the reference price, `−` closer. */
function placeboLabel(
    side: LevelSide,
    price: number,
    window: OutcomeWindow,
    shiftAtr: number
): LevelPlaceboLabel {
    const atr = window.atr ?? 0;
    const shifted =
        side === 'support' ? price - shiftAtr * atr : price + shiftAtr * atr;
    const { outcome, skipReason, touchOffset } = evaluate(
        side,
        shifted,
        window
    );
    return { shiftAtr, outcome, skipReason, touchOffset };
}

/**
 * Labels one support or resistance level against the forward bars. `price` is in the
 * window's basis (apply `OutcomeWindow.adjFactor` to a stored subject price first;
 * `labelAnalysisOutcome` does).
 *
 * With `a = window.atr`:
 * - `skipped`: `no_atr` (missing or not positive), `at_price` (exactly at the reference
 *   price, or closer than `LEVEL_MIN_DISTANCE_ATR` × a on the right side), `wrong_side` (a
 *   support above the reference price, a resistance below it; checked before the distance).
 * - Touch: the first bar reaching within `LEVEL_TOUCH_BAND_ATR` × a of the level (support:
 *   `low ≤ price + band`). No such bar: `untouched`.
 * - From the touch bar through `LEVEL_FOLLOW_BARS` bars (cut by the window), the first
 *   event wins per bar in this order: an open beyond the level by `LEVEL_BARRIER_ATR` × a
 *   is `broken` with `gap: true`; a close beyond it is `broken`; a close the other way
 *   beyond the barrier is `respected`.
 * - No event: `inconclusive` when every follow bar was observed, `touched_late` when the
 *   window ended first.
 *
 * Barriers are symmetric on closes, so a driftless walk resolves about half of its touches
 * `respected`. `placebo` holds the same labelling of the level moved `PLACEBO_SHIFT_ATR`
 * ATRs farther from the reference price (`shiftAtr: 0.5`) and closer to it (`−0.5`): a set
 * of levels is informative only if its respected share beats the placebo's.
 *
 * Compare a real level with its placebo only on rows where both were evaluated (neither
 * `skipped`).
 *
 * @param level - Side and price of the level.
 * @param window - The window from `buildOutcomeWindow`.
 * @returns The level's label, with its two placebos.
 */
export function labelLevelOutcome(
    level: { side: LevelSide; price: number },
    window: OutcomeWindow
): LevelOutcomeLabel {
    return {
        ...evaluate(level.side, level.price, window),
        placebo: [PLACEBO_SHIFT_ATR, -PLACEBO_SHIFT_ATR].map(shiftAtr =>
            placeboLabel(level.side, level.price, window, shiftAtr)
        ),
    };
}
