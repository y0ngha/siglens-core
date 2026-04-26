import {
    DEFAULT_DASHBOARD_TIMEFRAME,
    SECTOR_STOCKS,
} from '@/domain/constants/dashboard-tickers';
import {
    bucketedTimestamp,
    computeStockSignalResult,
    lookbackIsoFromNow,
} from '@/domain/dashboard';
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
import { createMarketDataProvider } from '@/infrastructure/market/factory';
import type { MarketDataProvider } from '@/infrastructure/market/types';

// FMP/Alpaca 동시 요청 제한 — 429 회피를 위한 청크 크기
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

export async function getSectorSignals(
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

    const provider = createMarketDataProvider();
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

    if (cache !== null) {
        try {
            await cache.set(
                cacheKey,
                payload,
                SECTOR_SIGNALS_TTL_BY_TIMEFRAME[timeframe]
            );
        } catch {
            // Graceful degradation: cache write failure does not block the response.
        }
    }

    return payload;
}
