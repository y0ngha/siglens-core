import { returnOver } from '@/domain/indicators/fearGreed/returns';
import type {
    ExtremeFearGreedZone,
    ExtremeZoneEpisode,
    ExtremeZoneEpisodeOptions,
    ExtremeZoneEpisodeSummary,
    ExtremeZoneOutcome,
    ExtremeZoneOutcomeOptions,
    FearGreedLabel,
    FearGreedLabelTransition,
    FearGreedReading,
    FearGreedScoreGap,
    ForwardChangeStat,
} from '@/domain/indicators/fearGreed/types';
import { median } from '@/domain/indicators/utils';
import type { Bar } from '@/domain/types';

/**
 * Descriptive statistics over a Fear & Greed score history.
 *
 * Everything here returns **numbers and enum states only** — no sentences, no
 * advisory labels. These are after-the-fact counts and changes over a past
 * window, not expected returns: callers must present them as such (e.g. with a
 * "past aggregate, not a forecast" notice) and own all display wording.
 */

/** Default forward horizons, in trading sessions, measured from each zone entry. */
export const EXTREME_ZONE_FORWARD_HORIZONS = [5, 20, 60] as const;

/**
 * Default minimum sample size. Below this the medians are withheld
 * (`median: null`) — a median of two or three entries reads like a pattern but
 * is mostly noise.
 */
export const EXTREME_ZONE_MIN_SAMPLE = 5;

/**
 * Default minimum gap, in sessions, before a return to the same extreme zone
 * counts as a **new** entry. Scores that hover at a zone boundary flip in and
 * out daily; counting every flip inflates the entry count with heavily
 * overlapping forward windows. A return within this many sessions of the last
 * session spent in the zone is treated as the same episode.
 */
export const EXTREME_ZONE_REENTRY_GAP = 20;

/** The two extreme zones, in display order. */
export const EXTREME_FEAR_GREED_ZONES: readonly ExtremeFearGreedZone[] = [
    'EXTREME_FEAR',
    'EXTREME_GREED',
];

const PERCENT_FACTOR = 100;

/**
 * Label of the session right before `i`, or `null` when there is none or it is
 * a warm-up / insufficient-sample gap. Both transitions and zone entries use it,
 * so "a gap breaks the chain" lives in one place.
 */
function previousLabel(
    history: readonly FearGreedReading[],
    i: number
): FearGreedLabel | null {
    return i > 0 ? history[i - 1].label : null;
}

/**
 * Label changes between consecutive sessions, newest first.
 *
 * A change is counted only between two **adjacent** sessions that both have a
 * label. A warm-up / insufficient-sample gap (`label: null`) breaks the chain,
 * so the first labelled session after a gap is not reported as a change — its
 * "previous" label is unknown, not different.
 *
 * @param history - Score history in chronological order (e.g. the output of
 *   `computeFearGreedHistory` or `computeMarketFearGreedHistory`).
 * @param limit - Maximum number of transitions to return (newest first). A
 *   value that is not a whole number ≥ 1 returns an empty array.
 * @returns Up to `limit` transitions, most recent first.
 */
export function computeLabelTransitions(
    history: readonly FearGreedReading[],
    limit: number
): FearGreedLabelTransition[] {
    if (!Number.isInteger(limit) || limit < 1) return [];
    const transitions = history.flatMap(
        (point, i): FearGreedLabelTransition[] => {
            const prev = previousLabel(history, i);
            if (prev === null || point.label === null || prev === point.label)
                return [];
            return [{ date: point.date, from: prev, to: point.label }];
        }
    );
    return transitions.toReversed().slice(0, limit);
}

/**
 * Indices where the history **enters** `zone`: the session is labelled `zone`,
 * the immediately preceding session has a different, non-null label, and none
 * of the previous `reentryGap` sessions was in `zone` (a quick return is the
 * same episode). A session right after a warm-up gap is not an entry — the
 * prior state is unknown.
 */
function zoneEntryIndices(
    history: readonly FearGreedReading[],
    zone: ExtremeFearGreedZone,
    reentryGap: number
): number[] {
    // Single pass that remembers the last session spent in `zone`, so a quick
    // return is recognised without re-scanning a window per session. A for
    // loop with push (MISTAKES 14.5 / 15.5): reduce + spread would be O(N²).
    const entries: number[] = [];
    let lastInZone: number | null = null;
    const n = history.length;
    for (let i = 0; i < n; i++) {
        if (history[i].label !== zone) continue;
        const prev = previousLabel(history, i);
        const isEntry =
            prev !== null &&
            prev !== zone &&
            (lastInZone === null || i - lastInZone > reentryGap);
        if (isEntry) entries.push(i);
        lastInZone = i;
    }
    return entries;
}

/**
 * Forward close change after each entry over one `horizon`, in percent. An
 * entry without `horizon` sessions after it, or whose change is not finite
 * (non-positive base close, or a NaN/Infinity close), is left out of the
 * sample. The median is withheld below `minSample`.
 */
function forwardChangeStat(
    closes: readonly number[],
    entries: readonly number[],
    horizon: number,
    minSample: number
): ForwardChangeStat {
    const lastIndex = closes.length - 1;
    const changes = entries.flatMap(i => {
        const end = i + horizon;
        if (end > lastIndex) return [];
        const change = returnOver(closes, end, horizon);
        return change === null || !Number.isFinite(change)
            ? []
            : [change * PERCENT_FACTOR];
    });
    return {
        horizon,
        sampleSize: changes.length,
        median: changes.length >= minSample ? median(changes) : null,
    };
}

/** A re-entry gap must be a whole number of sessions ≥ 0; anything else falls back to the default. */
function resolveReentryGap(reentryGap: number | undefined): number {
    return reentryGap !== undefined &&
        Number.isInteger(reentryGap) &&
        reentryGap >= 0
        ? reentryGap
        : EXTREME_ZONE_REENTRY_GAP;
}

/**
 * For each extreme zone, how many times the history entered it and how the
 * close moved over the following sessions.
 *
 * - `history` must be **index-aligned** with `bars` (same length, `history[i]`
 *   describes `bars[i]`) — exactly what `computeFearGreedHistory(bars, …)`
 *   returns. A length mismatch returns an empty array rather than guessing an
 *   alignment.
 * - An entry is a move into the zone from a different labelled session. A
 *   return to the same zone within `reentryGap` sessions (default 20) of the
 *   last session spent there is the same episode and not counted again.
 * - Forward change for horizon `h` from entry `i` is
 *   `(close[i + h] / close[i] - 1) × 100`, in percent. Entries without `h`
 *   sessions after them are left out of that horizon's sample, so later
 *   horizons can have smaller samples than `entryCount`.
 * - `median` is `null` when that horizon's sample is below `minSample`.
 *   `status` is `'insufficient_sample'` when `entryCount` itself is below it.
 * - Entries close together produce overlapping windows; samples are not
 *   independent. The window covers only the history supplied (survivorship and
 *   period dependence apply). This is a description of the past, not a
 *   forecast.
 *
 * @deprecated Use {@link summarizeExtremeZoneEpisodes}. Forward medians from a
 *   handful of entries proved indistinguishable from random sessions
 *   (measurement in siglens-core#256), so they read like a pattern but are
 *   noise. Kept for backward compatibility; removed in a future major version.
 * @param history - Score history aligned to `bars`.
 * @param bars - Daily bars in chronological order.
 * @param options - Optional horizons (sessions) and minimum sample size.
 *   Horizons that are not whole numbers ≥ 1 are ignored; a `reentryGap` that
 *   is not a whole number ≥ 0 falls back to the default.
 * @returns One outcome per extreme zone (`EXTREME_FEAR`, then `EXTREME_GREED`),
 *   or `[]` when `history` and `bars` are not aligned.
 */
export function summarizeExtremeZoneOutcomes(
    history: readonly FearGreedReading[],
    bars: readonly Bar[],
    options: ExtremeZoneOutcomeOptions = {}
): ExtremeZoneOutcome[] {
    if (history.length !== bars.length) return [];
    // A horizon must be a whole number of sessions ≥ 1: 0 would report a
    // trivial 0% change, and a fraction indexes past the bars.
    const horizons = (options.horizons ?? EXTREME_ZONE_FORWARD_HORIZONS).filter(
        h => Number.isInteger(h) && h >= 1
    );
    const minSample = options.minSample ?? EXTREME_ZONE_MIN_SAMPLE;
    const reentryGap = resolveReentryGap(options.reentryGap);
    const closes = bars.map(bar => bar.close);
    return EXTREME_FEAR_GREED_ZONES.map(zone => {
        const entries = zoneEntryIndices(history, zone, reentryGap);
        return {
            zone,
            entryCount: entries.length,
            status: entries.length >= minSample ? 'ok' : 'insufficient_sample',
            forward: horizons.map(horizon =>
                forwardChangeStat(closes, entries, horizon, minSample)
            ),
        };
    });
}

/**
 * In-zone sessions that belong to the episode starting at `start`: walking the
 * zone's sessions before the next entry, the episode continues while each one
 * comes within `reentryGap` sessions of the previous — the same rule that
 * decides a new entry. A zone session after a longer gap that was not an entry
 * (it followed a warm-up gap) does not stretch the episode.
 */
function episodeMemberIndices(
    history: readonly FearGreedReading[],
    zone: ExtremeFearGreedZone,
    start: number,
    stop: number,
    reentryGap: number
): number[] {
    const inZone = history
        .slice(start, stop)
        .flatMap((point, j) => (point.label === zone ? [start + j] : []));
    const breakAt = inZone.findIndex(
        (i, k) => k > 0 && i - inZone[k - 1] > reentryGap
    );
    return breakAt === -1 ? inZone : inZone.slice(0, breakAt);
}

function buildEpisode(
    history: readonly FearGreedReading[],
    zone: ExtremeFearGreedZone,
    members: readonly number[]
): ExtremeZoneEpisode {
    // `members[0]` is the entry, labelled `zone`, so the list is never empty. A
    // label normally implies a score; a malformed reading without one is skipped.
    const scores = members.flatMap(i => {
        const score = history[i].score;
        return score === null ? [] : [score];
    });
    const first = members[0];
    const last = members[members.length - 1];
    return {
        startDate: history[first].date,
        endDate: history[last].date,
        sessionsInZone: members.length,
        peakScore:
            scores.length === 0
                ? null
                : zone === 'EXTREME_FEAR'
                  ? Math.min(...scores)
                  : Math.max(...scores),
        ongoing: last === history.length - 1,
    };
}

/**
 * For each extreme zone, every stay in it: when it started, the last session
 * spent there, how many sessions carried the zone label, and the most extreme
 * score reached.
 *
 * - Entries follow the same rule as the zone entries elsewhere in this module:
 *   a move into the zone from a different labelled session. A return within
 *   `reentryGap` sessions (default 20) of the episode's last zone session is
 *   folded into the same episode instead of starting a new one.
 * - A zone session right after a warm-up gap (`label: null`) is not an entry —
 *   the prior state is unknown — and, when it is further than `reentryGap`
 *   from the previous episode, it belongs to no episode. Such sessions are left
 *   out of every count, and `ongoing` stays `false` even if the history ends
 *   on one.
 * - These are recorded facts — dates, counts and scores — not price outcomes.
 *   No returns, averages or win rates are computed. Callers own all wording and
 *   should present the record as history, not as a signal.
 *
 * @param history - Score history in chronological order.
 * @param options - Optional `reentryGap`; a value that is not a whole number ≥ 0
 *   falls back to the default.
 * @returns One record per extreme zone (`EXTREME_FEAR`, then `EXTREME_GREED`).
 */
export function summarizeExtremeZoneEpisodes(
    history: readonly FearGreedReading[],
    options: ExtremeZoneEpisodeOptions = {}
): ExtremeZoneEpisodeSummary[] {
    const reentryGap = resolveReentryGap(options.reentryGap);
    return EXTREME_FEAR_GREED_ZONES.map(zone => {
        const entries = zoneEntryIndices(history, zone, reentryGap);
        const episodes = entries.map((start, k) =>
            buildEpisode(
                history,
                zone,
                episodeMemberIndices(
                    history,
                    zone,
                    start,
                    entries[k + 1] ?? history.length,
                    reentryGap
                )
            )
        );
        return {
            zone,
            entryCount: entries.length,
            medianSessionsInZone:
                episodes.length === 0
                    ? null
                    : median(episodes.map(e => e.sessionsInZone)),
            episodes: episodes.toReversed(),
        };
    });
}

/**
 * Gap between an instrument's score and the market-wide score **on the same
 * session**: `symbolScore - marketScore`.
 *
 * The two series are computed from different bars and can end on different
 * days (an instrument's last closed bar vs the market snapshot's `asOf`), so the
 * symbol score is looked up at the market reading's date. No match — or a null
 * score on either side — returns `null` instead of comparing different days.
 *
 * @param symbolHistory - The instrument's score history.
 * @param market - The market reading to compare against (date + score).
 * @returns The same-day gap, or `null` when no same-day pair exists.
 */
export function computeMarketScoreGap(
    symbolHistory: readonly FearGreedReading[],
    market: FearGreedReading
): FearGreedScoreGap | null {
    if (market.score === null) return null;
    const point = symbolHistory.find(p => p.date === market.date);
    if (point === undefined || point.score === null) return null;
    return {
        date: market.date,
        symbolScore: point.score,
        marketScore: market.score,
        gap: point.score - market.score,
    };
}
