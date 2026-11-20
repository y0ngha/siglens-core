/**
 * A market-data provider that serves stored bars up to a case's `asOf` day and nothing
 * after it: the replay's look-ahead barrier. Like the production provider it ignores
 * `limit` and cuts by `from`; it has no quote, so a replay never sees a live price.
 */
import type { Bar } from '@/domain/types';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';

const SECONDS_PER_MS = 1 / 1000;

function isoDateToSeconds(isoDate: string): number {
    return Date.parse(`${isoDate}T00:00:00Z`) * SECONDS_PER_MS;
}

/**
 * @param bars - The symbol's stored daily bars, oldest first.
 * @param asOf - `YYYY-MM-DD`; the last bar served is the one stamped that day.
 */
export function createStoredProvider(
    bars: readonly Bar[],
    asOf: string
): MarketDataProvider {
    const asOfSeconds = isoDateToSeconds(asOf);
    return {
        async getBars({ from }) {
            const fromSeconds =
                from === undefined
                    ? -Infinity
                    : Date.parse(from) * SECONDS_PER_MS;
            return bars.filter(
                bar => bar.time >= fromSeconds && bar.time <= asOfSeconds
            );
        },
        async getQuote() {
            return null;
        },
    };
}
