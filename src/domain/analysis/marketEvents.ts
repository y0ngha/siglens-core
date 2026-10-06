import { barTimeMs } from '@/domain/analysis/priorAnalysis';
import { MS_PER_DAY } from '@/domain/constants/time';
import { latestTradingDayStartUtcMs } from '@/domain/session';
import type {
    Bar,
    MarketEvent,
    MarketSessionSpec,
    NewsImpact,
    Timeframe,
} from '@/domain/types';

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

/**
 * @internal
 * Exclusive upper bound on the `publishedAt` any prompt consumer can render,
 * derived without bars so the cache-key stage can apply it.
 *
 * Both consumers of the stage-1 candidates read bars that already exist at
 * `now`: {@link selectMarketEvents} stops at the last bar's time, and
 * `newsDrivenWashoutEvent` stops one day past it (exclusive). A daily bar is
 * stamped at UTC midnight of its exchange date, so the latest bar that can
 * exist is the latest trading day's — and anything published at or after that
 * day's stamp + 1 day cannot reach either consumer. Events past it (weekend
 * and holiday news while the bars are frozen, or news after the next UTC-day
 * boundary) would otherwise change the cache key, miss the cache and rerun the
 * model on a byte-identical prompt.
 *
 * **Invariant: the horizon never undershoots.** A too-high horizon only keeps a
 * redundant event in the key (an extra miss); a too-low one would leave a
 * stale cache entry for an event the prompt renders. So the lookup counts today
 * as a trading day even before the open and ignores nothing but weekends and
 * calendar holidays, which can only lower the answer to the true last bar.
 *
 * **Known limit, deliberately kept: weekday pre-open news still churns the
 * key.** On a trading day before the open the horizon already reaches the end
 * of today, so news published that morning changes the key even though the
 * bars may still end yesterday. Tightening it with the session's `openMinute`
 * would undershoot: the consumer appends a today bar built from realtime quotes,
 * so a pre-open last bar can be today's, and a horizon cut at yesterday would
 * leave a stale cache entry for an event the prompt renders. Only weekend and
 * holiday news (and news past the next-day UTC boundary) is cut.
 *
 * Bounded only for `1Day` on a `scheduled` session. Intraday bars carry
 * no calendar-derivable stamp (a provider may or may not include extended-hours
 * bars), and an `always-open` session's daily bar closes at the next UTC
 * midnight, which every past event already precedes — so both stay unbounded
 * (`null`) rather than guess.
 *
 * @param timeframe - Bar resolution of the analysis.
 * @param session - Market session of the instrument, or `undefined` when the
 *   caller supplies none (unbounded, so the key matches the pre-horizon one).
 * @param now - The request's reference time.
 * @returns Exclusive upper bound in epoch ms, or `null` for no bound.
 */
export function marketEventHorizonMs(
    timeframe: Timeframe,
    session: MarketSessionSpec | undefined,
    now: Date
): number | null {
    if (timeframe !== '1Day') return null;
    if (session === undefined) return null;
    const lastBarMs = latestTradingDayStartUtcMs(session, now);
    return lastBarMs === null ? null : lastBarMs + MS_PER_DAY;
}
