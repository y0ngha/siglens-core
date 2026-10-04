import type { Bar } from '@/domain/types';
import { median } from '@/domain/indicators/utils';
import { returnOver } from '@/domain/indicators/fearGreed/returns';
import type {
    ExtremeFearGreedZone,
    ExtremeZoneOutcome,
    ExtremeZoneOutcomeOptions,
    FearGreedLabelTransition,
    FearGreedReading,
    FearGreedScoreGap,
    ForwardChangeStat,
} from '@/domain/indicators/fearGreed/types';

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

/** The two extreme zones, in display order. */
export const EXTREME_FEAR_GREED_ZONES: readonly ExtremeFearGreedZone[] = [
    'EXTREME_FEAR',
    'EXTREME_GREED',
];

const PERCENT_FACTOR = 100;

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
 * @param limit - Maximum number of transitions to return (newest first). Values
 *   below 1 return an empty array.
 * @returns Up to `limit` transitions, most recent first.
 */
export function computeLabelTransitions(
    history: readonly FearGreedReading[],
    limit: number
): FearGreedLabelTransition[] {
    if (limit < 1) return [];
    const transitions = history.flatMap(
        (point, i): FearGreedLabelTransition[] => {
            const prev = i > 0 ? history[i - 1] : undefined;
            if (
                prev === undefined ||
                prev.label === null ||
                point.label === null ||
                prev.label === point.label
            ) {
                return [];
            }
            return [{ date: point.date, from: prev.label, to: point.label }];
        }
    );
    return transitions.toReversed().slice(0, limit);
}

/**
 * Indices where the history **enters** `zone`: the session is labelled `zone`
 * and the immediately preceding session has a different, non-null label. A
 * session right after a warm-up gap is not an entry (the prior state is unknown).
 */
function zoneEntryIndices(
    history: readonly FearGreedReading[],
    zone: ExtremeFearGreedZone
): number[] {
    return history.flatMap((point, i) => {
        const prev = i > 0 ? history[i - 1] : undefined;
        return point.label === zone &&
            prev !== undefined &&
            prev.label !== null &&
            prev.label !== zone
            ? [i]
            : [];
    });
}

function forwardChangeStat(
    closes: number[],
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

/**
 * For each extreme zone, how many times the history entered it and how the
 * close moved over the following sessions.
 *
 * - `history` must be **index-aligned** with `bars` (same length, `history[i]`
 *   describes `bars[i]`) — exactly what `computeFearGreedHistory(bars, …)`
 *   returns. A length mismatch returns an empty array rather than guessing an
 *   alignment.
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
 * @param history - Score history aligned to `bars`.
 * @param bars - Daily bars in chronological order.
 * @param options - Optional horizons (sessions) and minimum sample size.
 *   Horizons that are not whole numbers ≥ 1 are ignored.
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
    const closes = bars.map(bar => bar.close);
    return EXTREME_FEAR_GREED_ZONES.map(zone => {
        const entries = zoneEntryIndices(history, zone);
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
