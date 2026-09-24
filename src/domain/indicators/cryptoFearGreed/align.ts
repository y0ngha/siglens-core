import type {
    AlignedCryptoSeries,
    CryptoDailyBar,
    CryptoFearGreedInput,
} from '@/domain/indicators/cryptoFearGreed/types';
import { toCloseMap } from '@/domain/indicators/marketFearGreed/align';

interface BarValue {
    close: number;
    volume: number;
}

/**
 * Last-write-wins map from ISO date to bar, dropping bars whose close is
 * non-finite or non-positive (a zero close would make every return diverge) or
 * whose volume is non-finite or negative.
 */
function toBarMap(series: CryptoDailyBar[]): Map<string, BarValue> {
    const map = new Map<string, BarValue>();
    for (const bar of series) {
        if (!Number.isFinite(bar.close) || bar.close <= 0) continue;
        if (!Number.isFinite(bar.volume) || bar.volume < 0) continue;
        map.set(bar.date, { close: bar.close, volume: bar.volume });
    }
    return map;
}

/**
 * Align the crypto index inputs onto one 7-day session calendar.
 *
 * Sessions are the inner join of the benchmark and every universe coin, so a
 * coin missing a day removes that day for all of them — otherwise one series
 * would shift against the others and corrupt every cross-coin factor. The
 * safe-haven asset (gold) does not trade on weekends and holidays, so it is
 * forward-filled: each session takes the last safe-haven close on or before
 * its date. Sessions before the first safe-haven close are dropped.
 *
 * @param input - Benchmark, safe-haven, and universe series; any order,
 *   duplicates allowed.
 * @returns Ascending, index-aligned arrays. `dates` is empty when the series
 *   share no session on or after the first safe-haven close.
 *
 * @internal Used by the crypto walk-forward module.
 */
export function alignCryptoSeries(
    input: CryptoFearGreedInput
): AlignedCryptoSeries {
    // `?? []` / `?? {}` defend the JS boundary — a consumer without TypeScript
    // can hand us a partial object, and a missing series must read as empty
    // (which the inner join turns into an empty result) rather than throw.
    const benchmark = toBarMap(input.benchmark ?? []);
    const universe = Object.values(input.universe ?? {}).map(toBarMap);
    const safeHaven = toCloseMap(input.safeHaven ?? []);
    const havenDates = [...safeHaven.keys()].sort();

    const joined = [...benchmark.keys()]
        .filter(date => universe.every(coin => coin.has(date)))
        .sort();

    const dates: string[] = [];
    const havenCloses: number[] = [];
    // Both lists are ascending, so one forward-moving pointer finds the last
    // safe-haven date ≤ each session in O(n + m) total.
    let h = -1;
    for (const date of joined) {
        while (h + 1 < havenDates.length && havenDates[h + 1] <= date) h++;
        if (h < 0) continue;
        dates.push(date);
        // Safe: `havenDates` is the key list of `safeHaven`.
        havenCloses.push(safeHaven.get(havenDates[h]) as number);
    }

    // Safe: `dates` ⊆ keys present in the benchmark and every universe map.
    const bar = (map: Map<string, BarValue>, date: string) =>
        map.get(date) as BarValue;

    return {
        dates,
        benchmark: dates.map(date => bar(benchmark, date).close),
        safeHaven: havenCloses,
        universe: universe.map(coin =>
            dates.map(date => bar(coin, date).close)
        ),
        totalVolume: dates.map(date =>
            universe.reduce(
                (sum, coin) => sum + bar(coin, date).volume,
                bar(benchmark, date).volume
            )
        ),
    };
}
