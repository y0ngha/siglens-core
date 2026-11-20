import type {
    OutcomeWindow,
    ScenarioTargetLabel,
} from '@/domain/outcomes/types';
import { forwardBar, forwardOffsets } from '@/domain/outcomes/windowSeries';

/**
 * Whether a scenario target (`priceTargets.bullish|bearish`) was reached. `price` is in
 * the window's basis.
 *
 * A bullish target above the reference price is touched at the first bar whose high
 * reaches it, a bearish one below it at the first low that does. A target on the wrong
 * side of the reference price is not a target of that scenario: `touched: false` with no
 * distance, never a trivial hit. `distanceAtr` is `null` without a usable ATR as well.
 *
 * @internal
 */
export function labelScenarioTarget(
    target: { side: 'bullish' | 'bearish'; price: number },
    window: OutcomeWindow
): ScenarioTargetLabel {
    const { atr, referencePrice } = window;
    const bullish = target.side === 'bullish';
    const rightSide = bullish
        ? target.price > referencePrice
        : target.price < referencePrice;
    const touchOffset = rightSide
        ? (forwardOffsets(window).find(offset => {
              const bar = forwardBar(window, offset);
              return bullish
                  ? bar.high >= target.price
                  : bar.low <= target.price;
          }) ?? null)
        : null;
    return {
        side: target.side,
        price: target.price,
        distanceAtr:
            rightSide && atr !== null && atr > 0
                ? Math.abs(target.price - referencePrice) / atr
                : null,
        touched: touchOffset !== null,
        touchOffset,
    };
}
