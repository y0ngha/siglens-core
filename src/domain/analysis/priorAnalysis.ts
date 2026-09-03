import { MS_PER_SECOND } from '@/domain/constants/time';
import type { Bar, PriorAnalysis } from '@/domain/types';

/** @internal How many past analyses are rendered into a prompt at most. */
export const PRIOR_ANALYSIS_LIMIT = 7;

/**
 * @internal
 *
 * Buffer multiplier on the lookback window. Analyses do not exist for every
 * bar, so the window reaches back `PRIOR_ANALYSIS_LIMIT * PRIOR_ANALYSIS_SLACK`
 * bars to have a chance of filling the limit on sparsely-analysed symbols.
 *
 * The window is counted in **bars**, not wall-clock time, and that is
 * deliberate. Bars already have session gaps removed, so counting them back
 * is automatically correct across nights, weekends, and holidays — bar N and
 * bar N-21 are 21 *trading* bars apart regardless of how many calendar hours
 * separate them. A wall-clock cutoff does not have that property: on an
 * intraday timeframe it leaves the window permanently empty right after the
 * open, because the previous session's last analysis is already "too old" by
 * clock time. On a 5-minute chart, the prior day's final analysis (16:00 ET)
 * is ~17.5 hours old at 09:35 ET the next morning — several bars into the new
 * session, but a wall-clock window sized for intraday use would have expired
 * hours before the market even reopened.
 */
export const PRIOR_ANALYSIS_SLACK = 3;

/**
 * @internal
 *
 * `Bar.time` is a Unix timestamp in **seconds**; `PriorAnalysis.generatedAt`
 * is a `Date`, whose `getTime()` is **milliseconds**. Every comparison
 * between the two must go through this conversion — mixing the raw units is
 * the single most likely defect in this module (a bar-second value used
 * directly as a millisecond cutoff silently shifts every boundary ~1000x
 * earlier than intended).
 */
export function barTimeMs(bar: Bar): number {
    return bar.time * MS_PER_SECOND;
}

/**
 * @internal
 *
 * Index of the bar a millisecond timestamp belongs to: the bar with the
 * greatest `time` still `<= targetMs`. This is the single definition of
 * "which bar does this analysis belong to" — `selectPriorAnalyses`
 * uses it to bucket candidates for dedup, and the prompt renderer uses it to
 * find the reference bar an outcome is measured from. The two MUST agree, so
 * they share one implementation rather than two loops kept aligned by comment.
 *
 * `bars` is sorted oldest-first; this does a binary search for the greatest
 * index whose `barTimeMs` is `<= targetMs` rather than scanning backwards,
 * since it runs once per candidate in `selectPriorAnalyses` plus once per
 * rendered entry in `priorAnalysisSection.ts`.
 *
 * Returns `null` only when `targetMs` predates every bar.
 */
export function findAnchorBarIndex(
    bars: readonly Bar[],
    targetMs: number
): number | null {
    let low = 0;
    let high = bars.length - 1;
    let result = -1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (barTimeMs(bars[mid]) <= targetMs) {
            // bars[mid] qualifies; a later bar might qualify too, so keep
            // searching the upper half for a greater index.
            result = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return result === -1 ? null : result;
}

/**
 * @internal
 *
 * Narrows a caller-supplied history of past analyses down to the set worth
 * rendering into a prompt: at most `PRIOR_ANALYSIS_LIMIT` entries,
 * newest first, at most one per bar.
 *
 * `candidates` must already be filtered to exclude analyses generated inside
 * the *current* cache window — this function does not re-check that. That
 * filtering is intentionally not done here: it depends on
 * `ANALYSIS_CACHE_TTL`, which is cache policy and lives in the infrastructure
 * layer, and `domain/` cannot import it (`domain` may not import
 * `infrastructure` — see `src/domain/CLAUDE.md`). The caller computes the
 * analysis cache-key fingerprint from that same pre-filtered list, so the
 * filtering has to happen once, at the caller, before both this function and
 * the fingerprint see the data — duplicating it here would risk the two
 * falling out of sync. Concretely: this function trusts its input on the
 * "is this too recent to use" axis and takes no position on entries newer
 * than the caller's cutoff.
 *
 * @param candidates - Past analyses, already TTL-window-filtered by the caller.
 * @param bars - OHLCV history for the same symbol + timeframe, oldest-first.
 */
export function selectPriorAnalyses(
    candidates: readonly PriorAnalysis[],
    bars: readonly Bar[]
): PriorAnalysis[] {
    if (bars.length === 0) {
        return [];
    }

    const windowBars = PRIOR_ANALYSIS_LIMIT * PRIOR_ANALYSIS_SLACK;
    const anchorBar =
        bars.length < windowBars ? bars[0] : bars[bars.length - windowBars];
    const anchorMs = barTimeMs(anchorBar);

    const withinWindow = candidates.filter(
        c => c.generatedAt.getTime() >= anchorMs
    );

    // Bar dedup: group survivors by the bar they belong to (the bar with the
    // greatest `time` <= generatedAt) and keep exactly one per group. Iterating
    // in input order and replacing only on a STRICTLY newer generatedAt makes the
    // pick deterministic without a secondary key: the first candidate seen for a
    // group is the initial winner, an exact tie never replaces it (so input order
    // decides ties), and only a genuinely newer generatedAt takes over.
    const winnerByBar = new Map<number, PriorAnalysis>();
    for (const candidate of withinWindow) {
        const candidateMs = candidate.generatedAt.getTime();
        // `withinWindow` guarantees `candidateMs >= anchorMs`, and `anchorBar`
        // — whose `barTimeMs` IS `anchorMs` — is itself an element of `bars`.
        // So `findAnchorBarIndex` always has at least `anchorBar` to return
        // for any candidate reaching this loop; it cannot return null here.
        // Non-null assertion documents that guarantee instead of reintroducing
        // a defensive branch that can never execute (and so can never be
        // exercised by a test — see MISTAKES.md Tests #5.5).
        const anchorIndex = findAnchorBarIndex(bars, candidateMs)!;
        const barKey = bars[anchorIndex].time;

        const current = winnerByBar.get(barKey);
        if (!current || candidateMs > current.generatedAt.getTime()) {
            winnerByBar.set(barKey, candidate);
        }
    }

    return Array.from(winnerByBar.values())
        .toSorted((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime())
        .slice(0, PRIOR_ANALYSIS_LIMIT);
}
