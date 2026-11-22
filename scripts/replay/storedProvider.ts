/**
 * A market-data provider that serves stored bars up to a case's `asOf` day and nothing
 * after it: the replay's look-ahead barrier. Like the production provider it ignores
 * `limit` and cuts by `from`; it has no quote, so a replay never sees a live price.
 *
 * With `scope`, the provider serves the case's own symbol from `bars` and a listed benchmark
 * (`SPY`, `KS11`; a leading `^` is ignored, `^KS11` is `KS11`) from `scope.others`, both under
 * the same `asOf` barrier. Any other symbol throws: serving the case's bars for a symbol the
 * caller did not mean would put the wrong series under a benchmark name without a trace.
 */
import type { Bar } from '@/domain/types';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';

const SECONDS_PER_MS = 1 / 1000;

function isoDateToSeconds(isoDate: string): number {
    return Date.parse(`${isoDate}T00:00:00Z`) * SECONDS_PER_MS;
}

export interface StoredScope {
    /** The case's own symbol: the one `bars` belong to. */
    symbol: string;
    /** Stored bars of the benchmarks the case may ask for, by symbol. */
    others: ReadonlyMap<string, readonly Bar[]>;
}

function sourceOf(
    symbol: string,
    bars: readonly Bar[],
    scope: StoredScope | undefined
): readonly Bar[] {
    if (scope === undefined) return bars;
    const plain = symbol.replace(/^\^/, '');
    if (plain === scope.symbol) return bars;
    const other = scope.others.get(plain);
    if (other === undefined) {
        throw new Error(
            `stored provider: no bars for ${symbol} (the case is ${scope.symbol})`
        );
    }
    return other;
}

/**
 * @param bars - The symbol's stored daily bars, oldest first.
 * @param asOf - `YYYY-MM-DD`; the last bar served is the one stamped that day.
 */
export function createStoredProvider(
    bars: readonly Bar[],
    asOf: string,
    scope?: StoredScope
): MarketDataProvider {
    const asOfSeconds = isoDateToSeconds(asOf);
    return {
        async getBars({ symbol, from }) {
            const source = sourceOf(symbol, bars, scope);
            const fromSeconds =
                from === undefined
                    ? -Infinity
                    : Date.parse(from) * SECONDS_PER_MS;
            return source.filter(
                bar => bar.time >= fromSeconds && bar.time <= asOfSeconds
            );
        },
        async getQuote() {
            return null;
        },
    };
}
