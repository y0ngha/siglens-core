import { barTimeMs } from '@/domain/analysis/priorAnalysis';
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
 * Cap applied at the cache-key stage, before bars exist.
 *
 * Stage 1 cannot use the bar window, so without a cap a consumer handing over
 * years of qualifying events would grow the fingerprint input without bound —
 * and every add or removal among those ancient events would invalidate the
 * cache even though {@link selectMarketEvents} would never render them.
 *
 * Deliberately wider than {@link MARKET_EVENT_LIMIT}, and cut with the same
 * {@link compareMarketEventPriority} ordering: stage 1 must stay a superset of
 * what stage 2 can pick — in priority, not merely in count. Cutting by recency
 * here would let a lone `high` event fall off the end behind twenty fresher
 * `medium` ones, and stage 2 could never recover it.
 * `narrowPriorAnalysesForCacheKey` caps its own stage 1 the same way, with
 * `PRIOR_ANALYSIS_WINDOW_BARS`.
 */
export const MARKET_EVENT_CACHE_KEY_CAP = 20;

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

/**
 * Rank within {@link RANKED_IMPACTS}, most significant first.
 *
 * Only ever called on entries that already passed the `RANKED_IMPACTS` filter
 * below, so `indexOf` cannot return `-1` here. Handling that case would add a
 * branch no test could reach (MISTAKES.md Tests #5.5).
 */
function impactRank(impact: NewsImpact): number {
    return RANKED_IMPACTS.indexOf(impact);
}

/**
 * @internal
 * Ordering used whenever events must be cut to a cap: impact first, then
 * newest.
 *
 * **Both narrowing stages must sort by this.** Stage 1 (`narrowMarketEventsForCacheKey`)
 * caps by count before bars exist, and stage 2 ({@link selectMarketEvents})
 * caps again after the bar-window cut — but stage 2 can only choose from what
 * stage 1 handed it. If stage 1 cut by recency alone, the single `high` event
 * in a busy window could be dropped for being older than twenty `medium` ones,
 * and stage 2 would never see it. That is the exact outcome this feature
 * exists to prevent: the section is meant to say what moved price, not what
 * happened most recently.
 */
export function compareMarketEventPriority(
    a: MarketEvent,
    b: MarketEvent
): number {
    const byImpact = impactRank(a.impact) - impactRank(b.impact);
    if (byImpact !== 0) return byImpact;
    return b.publishedAt.getTime() - a.publishedAt.getTime();
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

    const fromMs = barTimeMs(bars[0]);
    const toMs = barTimeMs(bars[bars.length - 1]);

    return events
        .filter(entry => {
            if (!RANKED_IMPACTS.includes(entry.impact)) return false;
            const at = entry.publishedAt.getTime();
            return at >= fromMs && at <= toMs;
        })
        .toSorted(compareMarketEventPriority)
        .slice(0, MARKET_EVENT_LIMIT)
        .toSorted((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}
