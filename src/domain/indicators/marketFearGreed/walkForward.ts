import { alignSeries } from '@/domain/indicators/marketFearGreed/align';
import { composeMarketSnapshot } from '@/domain/indicators/marketFearGreed/composition';
import { computeMarketFactorsAtT } from '@/domain/indicators/marketFearGreed/factors';
import type {
    AlignedMarketSeries,
    MarketFactorValues,
    MarketFearGreedHistoryPoint,
    MarketFearGreedInput,
    MarketFearGreedSnapshot,
} from '@/domain/indicators/marketFearGreed/types';

function buildFactorTS(
    series: AlignedMarketSeries
): Array<MarketFactorValues | null> {
    return Array.from({ length: series.dates.length }, (_, t) =>
        computeMarketFactorsAtT(series, t)
    );
}

/**
 * Market-wide Fear & Greed snapshot for the latest common session.
 *
 * The six input series are inner-joined on their calendar date first, so a
 * session missing from any one series is excluded from all of them. Each factor
 * is then ranked against its own prior history (walk-forward — the current
 * session is never part of its own distribution), and the five percentiles are
 * averaged.
 *
 * Returns `null` when:
 * - the series share no common session,
 * - the latest session is still inside a factor warm-up window, or
 * - fewer than 10 earlier sessions are available to rank against.
 *
 * @param input - One daily close series per semantic key. Roughly two years of
 *   history is the practical minimum: 125 sessions warm up the momentum window
 *   and another 60 are needed for `confidence: 'normal'`.
 * @returns {MarketFearGreedSnapshot | null} The snapshot, or `null` when the data is insufficient.
 */
export function computeMarketFearGreedIndex(
    input: MarketFearGreedInput
): MarketFearGreedSnapshot | null {
    const series = alignSeries(input);
    if (series.dates.length === 0) return null;

    const factorTS = buildFactorTS(series);
    const t = series.dates.length - 1;
    const current = factorTS[t];
    if (!current) return null;

    const sample = factorTS
        .slice(0, t)
        .filter((f): f is MarketFactorValues => f !== null);

    const composition = composeMarketSnapshot(current, sample);
    if (!composition) return null;

    return { ...composition, asOf: series.dates[t] };
}

/**
 * Walk-forward market Fear & Greed history, one point per common session.
 *
 * For each session `t` the distribution is the valid factor bundles in `[0, t)`,
 * so appending later sessions never changes an earlier point. Points inside the
 * warm-up window — or before 10 prior samples accumulate — carry
 * `score: null`, which the UI renders as a gap.
 *
 * @param input - One daily close series per semantic key.
 * @returns {MarketFearGreedHistoryPoint[]} One point per common session, ascending by date.
 */
export function computeMarketFearGreedHistory(
    input: MarketFearGreedInput
): MarketFearGreedHistoryPoint[] {
    const series = alignSeries(input);
    const factorTS = buildFactorTS(series);
    const sample: MarketFactorValues[] = [];
    const out: MarketFearGreedHistoryPoint[] = new Array(series.dates.length);

    // Sequential, not a `.map` — each session's percentile ranks depend on the
    // sample accumulated by the sessions before it.
    for (let t = 0; t < series.dates.length; t++) {
        const date = series.dates[t];
        const current = factorTS[t];

        if (!current) {
            out[t] = { date, score: null, label: null };
            continue;
        }

        const composition = composeMarketSnapshot(current, sample);
        out[t] = composition
            ? { date, score: composition.score, label: composition.label }
            : { date, score: null, label: null };
        sample.push(current);
    }

    return out;
}
