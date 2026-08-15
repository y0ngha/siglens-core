import {
    MARKET_FEAR_GREED_SERIES_KEYS,
    type AlignedMarketSeries,
    type MarketDailyClose,
    type MarketFearGreedInput,
    type MarketFearGreedSeriesKey,
} from '@/domain/indicators/marketFearGreed/types';

/**
 * Last-write-wins map from ISO date to close, dropping non-finite and
 * non-positive closes (a zero close would make every return diverge).
 */
function toCloseMap(series: MarketDailyClose[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const point of series) {
        if (!Number.isFinite(point.close) || point.close <= 0) continue;
        map.set(point.date, point.close);
    }
    return map;
}

/**
 * Inner-join the six close series on their calendar date.
 *
 * Providers disagree about holidays and index-vs-ETF trading calendars, and a
 * single missing session would otherwise shift one series against the others
 * and silently corrupt every return-difference factor. Joining on the date
 * keeps all six arrays index-aligned by construction.
 *
 * @param input - One daily close series per semantic key; any order, duplicates allowed.
 * @returns Ascending, date-aligned close arrays. `dates` is empty when the
 *   series share no common date.
 *
 * @internal Used by the walk-forward module.
 */
export function alignSeries(input: MarketFearGreedInput): AlignedMarketSeries {
    // Safe: the loop below assigns every key of the Record before any read.
    const maps = {} as Record<MarketFearGreedSeriesKey, Map<string, number>>;
    for (const key of MARKET_FEAR_GREED_SERIES_KEYS) {
        // `?? []` defends the JS boundary — a consumer without TypeScript can
        // hand us a partial object, and a missing series must read as empty
        // (which the inner join below turns into an empty result) rather than
        // throw inside `toCloseMap`.
        maps[key] = toCloseMap(input[key] ?? []);
    }

    const [first, ...rest] = MARKET_FEAR_GREED_SERIES_KEYS;
    const dates = [...maps[first].keys()]
        .filter(date => rest.every(key => maps[key].has(date)))
        .sort();

    // Safe: same pre-fill invariant as `maps` above.
    const closes = {} as Record<MarketFearGreedSeriesKey, number[]>;
    for (const key of MARKET_FEAR_GREED_SERIES_KEYS) {
        const map = maps[key];
        // Safe: `dates` was filtered to the keys present in *every* map, so the
        // lookup cannot miss. Narrowing this without a cast would need a second
        // pass that re-checks an invariant the filter already established.
        closes[key] = dates.map(date => map.get(date) as number);
    }

    return { dates, closes };
}
