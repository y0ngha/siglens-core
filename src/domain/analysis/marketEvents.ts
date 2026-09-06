import { MS_PER_SECOND } from '@/domain/constants/time';
import type { Bar, MarketEvent, NewsImpact } from '@/domain/types';

/**
 * @internal
 * Maximum events rendered into one prompt.
 *
 * Earnings season clusters events on a single day; without a cap the section
 * could outgrow the bar data it is meant to annotate. Five covers a busy
 * session while staying a rounding error against a 12k–25k token prompt.
 */
export const MARKET_EVENT_LIMIT = 5;

/**
 * @internal
 * Impact levels worth telling the model about, ranked most significant first.
 *
 * `low` and `negligible` are dropped: on production data they are 13.5% and
 * 60.8% of all articles, so keeping them would bury the handful of events that
 * actually moved price. Articles with no impact rating (not yet analysed) never
 * reach here — an unrated article presented as an event would invent a fact.
 *
 * Exported because the cache-key stage filters on the same set before bars are
 * available; the two must not drift (see `narrowMarketEventsForCacheKey`).
 */
export const RANKED_IMPACTS: readonly NewsImpact[] = ['high', 'medium'];

function impactRank(impact: NewsImpact): number {
    const index = RANKED_IMPACTS.indexOf(impact);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
}

/**
 * @internal
 *
 * Narrows events to the ones worth rendering for this bar window.
 *
 * The window is the bars themselves — first bar's time through last bar's time
 * — rather than a wall-clock duration. That is deliberate: the section
 * annotates the bars the model is already looking at, so the two must share one
 * axis, and bar-anchored bounds skip overnight and weekend gaps for free.
 *
 * Sorting is impact-first, then newest-first. When the cap bites, a `high`
 * event outranks a fresher `medium` one — the section exists to say what moved
 * price, not what happened most recently. The result is then re-sorted to
 * newest-first so the rendered list reads chronologically.
 *
 * @param events - Candidate events, any order.
 * @param bars - OHLCV history for this symbol + timeframe, oldest-first.
 * @returns Selected events, newest-first, at most {@link MARKET_EVENT_LIMIT}.
 */
export function selectMarketEvents(
    events: readonly MarketEvent[],
    bars: readonly Bar[]
): MarketEvent[] {
    if (bars.length === 0) return [];

    const fromMs = bars[0].time * MS_PER_SECOND;
    const toMs = bars[bars.length - 1].time * MS_PER_SECOND;

    return events
        .filter(entry => {
            if (!RANKED_IMPACTS.includes(entry.impact)) return false;
            const at = entry.publishedAt.getTime();
            return at >= fromMs && at <= toMs;
        })
        .toSorted((a, b) => {
            const byImpact = impactRank(a.impact) - impactRank(b.impact);
            if (byImpact !== 0) return byImpact;
            return b.publishedAt.getTime() - a.publishedAt.getTime();
        })
        .slice(0, MARKET_EVENT_LIMIT)
        .toSorted((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}
