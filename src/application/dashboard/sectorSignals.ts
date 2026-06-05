import {
    DEFAULT_DASHBOARD_TIMEFRAME,
    SECTOR_STOCKS,
} from '@/domain/constants/dashboard-tickers';
import {
    bucketedTimestamp,
    computeStockSignalResult,
    lookbackIsoFromNow,
} from '@/domain/dashboard';
import type { MarketDataProvider } from '@/domain/ports/marketDataProvider';
import type {
    Bar,
    DashboardTimeframe,
    MarketQuote,
    SectorSignalsResult,
    SectorStock,
    StockSignalResult,
    Timeframe,
} from '@/domain/types';
import {
    buildSectorSignalsCacheKey,
    SECTOR_SIGNALS_TTL_BY_TIMEFRAME,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
// 시장 데이터 provider 동시 요청 제한 — 429 회피를 위한 청크 크기
const FETCH_CONCURRENCY = 10;

interface BarsAndQuotesResults {
    barsResults: PromiseSettledResult<Bar[]>[];
    quoteResults: PromiseSettledResult<MarketQuote | null>[];
}

async function fetchInChunks<T, R>(
    items: readonly T[],
    chunkSize: number,
    fetcher: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
    // Sequential chunked fetch keeps concurrent provider calls within FETCH_CONCURRENCY.
    // for-loop + push is the documented exception (MISTAKES.md #14) for sequential async
    // accumulation where reduce + spread would be O(N²).
    const results: PromiseSettledResult<R>[] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        const settled = await Promise.allSettled(chunk.map(fetcher));
        results.push(...settled);
    }
    return results;
}

async function fetchBarsAndQuotes(
    provider: MarketDataProvider,
    timeframe: DashboardTimeframe,
    fromIso: string
): Promise<BarsAndQuotesResults> {
    // DashboardTimeframe('15Min' | '1Hour' | '1Day')은 Timeframe 의 부분집합이므로
    // provider.getBars 시그니처에 맞추기 위한 안전한 widening.
    const tf: Timeframe = timeframe;
    const barsResults = await fetchInChunks(
        SECTOR_STOCKS,
        FETCH_CONCURRENCY,
        s =>
            provider.getBars({ symbol: s.symbol, timeframe: tf, from: fromIso })
    );
    const quoteResults = await fetchInChunks(
        SECTOR_STOCKS,
        FETCH_CONCURRENCY,
        s => provider.getQuote(s.symbol)
    );
    return { barsResults, quoteResults };
}

function combineResults(
    stockDefs: readonly SectorStock[],
    barsResults: PromiseSettledResult<Bar[]>[],
    quoteResults: PromiseSettledResult<MarketQuote | null>[]
): StockSignalResult[] {
    return stockDefs.flatMap((stockDef, i) => {
        const barsResult = barsResults[i];
        if (!barsResult || barsResult.status === 'rejected') return [];
        const quoteResult = quoteResults[i];
        const quote =
            quoteResult && quoteResult.status === 'fulfilled'
                ? quoteResult.value
                : null;
        const result = computeStockSignalResult(
            stockDef,
            barsResult.value,
            quote
        );
        return result === null ? [] : [result];
    });
}

/**
 * Compute per-stock trading signals across every sector tracked by the dashboard.
 *
 * For each ticker in `SECTOR_STOCKS`, fetches recent bars + the latest quote,
 * runs them through the indicator and signal pipelines, and returns a
 * compact result. Results are cached per `(timeframe, time-bucket)` so
 * concurrent dashboard loads within the same bucket share a single fetch.
 *
 * Provider calls are chunked (10 at a time) to stay below the market data
 * provider's rate limits. Per-ticker failures are dropped from the result (graceful
 * degradation): if one symbol's bars or quote rejects, the rest of the
 * dashboard still renders.
 *
 * @param provider - Market data provider injected by the consumer (siglens app).
 * @param timeframe - Dashboard bar resolution. Defaults to
 *   `DEFAULT_DASHBOARD_TIMEFRAME`.
 * @param now - Override the "now" reference used to compute the time bucket
 *   and lookback window. Useful in tests; defaults to `new Date()`.
 * @returns Computation timestamp plus per-stock signal results —
 *   see {@link SectorSignalsResult}.
 *
 * @see getMarketSummary
 * @see bucketedTimestamp
 */
export async function getSectorSignals(
    provider: MarketDataProvider,
    timeframe: DashboardTimeframe = DEFAULT_DASHBOARD_TIMEFRAME,
    now: Date = new Date()
): Promise<SectorSignalsResult> {
    const cache = createCacheProvider();
    const bucket = bucketedTimestamp(timeframe, now);
    const cacheKey = buildSectorSignalsCacheKey(timeframe, bucket);

    if (cache !== null) {
        try {
            const cached = await cache.get<SectorSignalsResult>(cacheKey);
            if (cached !== null) return cached;
        } catch {
            // Graceful degradation: cache read failure falls through to provider fetch.
        }
    }

    const fromIso = lookbackIsoFromNow(timeframe, now);
    const { barsResults, quoteResults } = await fetchBarsAndQuotes(
        provider,
        timeframe,
        fromIso
    );

    const stocks = combineResults(SECTOR_STOCKS, barsResults, quoteResults);

    const payload: SectorSignalsResult = {
        computedAt: now.toISOString(),
        stocks,
    };

    // Skip caching an empty result: `stocks` is empty only when every per-ticker
    // bars/quote fetch failed (full provider outage) — caching it would freeze an
    // empty dashboard for the whole TTL even after the provider recovers. Skipping
    // the write lets the next request retry. Mirrors the siglens-side shouldCache
    // guard (CachedMarketDataProvider / getCachedSectorSignals: `stocks.length > 0`).
    if (cache !== null && stocks.length > 0) {
        cache
            .set(cacheKey, payload, SECTOR_SIGNALS_TTL_BY_TIMEFRAME[timeframe])
            .catch(() => {
                // Graceful degradation: cache write failure does not block the response.
            });
    }

    return payload;
}
