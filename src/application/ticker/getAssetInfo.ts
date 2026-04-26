import { isValidTickerFormat } from '@/domain/ticker';
import type { AssetInfo, KoreanTickerEntry } from '@/domain/types';
import {
    ASSET_INFO_CACHE_TTL_WITH_KOREAN,
    ASSET_INFO_CACHE_TTL_WITHOUT_KOREAN,
    buildAssetInfoCacheKey,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import type { CacheProvider } from '@/infrastructure/cache/types';
import {
    filterUsExchanges,
    searchBySymbol,
} from '@/infrastructure/ticker/fmpTickerApi';
import {
    getKoreanNames,
    setKoreanTickers,
} from '@/infrastructure/ticker/koreanNameStore';
import { translateCompanyNames } from '@/infrastructure/ticker/koreanTranslator';

interface AssetInfoMatch {
    name: string;
    exchange: string;
    exchangeFullName: string;
}

async function translateAndCache(
    symbol: string,
    match: AssetInfoMatch,
    cache: CacheProvider | null
): Promise<void> {
    const translated = await translateCompanyNames([
        { symbol, name: match.name },
    ]);
    const koreanName = translated[symbol];
    if (!koreanName) return;

    const entry: KoreanTickerEntry = {
        symbol,
        name: match.name,
        koreanName,
        exchange: match.exchange,
        exchangeFullName: match.exchangeFullName,
    };
    await setKoreanTickers([entry]);

    if (!cache) return;

    try {
        await cache.set(
            buildAssetInfoCacheKey(symbol),
            { symbol, name: match.name, koreanName },
            ASSET_INFO_CACHE_TTL_WITH_KOREAN
        );
    } catch {
        // Graceful degradation: cache write failure does not affect callers.
    }
}

/**
 * Resolve canonical asset information for a single ticker symbol.
 *
 * Pipeline:
 * 1. Validate symbol format via {@link isValidTickerFormat}; reject otherwise.
 * 2. Look up the cache (separate TTLs for entries with vs. without a Korean name).
 * 3. On cache miss, query FMP, filter to U.S. exchanges, prefer an exact
 *    symbol match.
 * 4. Look up the Korean name in the persistent store. If absent, fire a
 *    background translation job and write through to the store + cache.
 *
 * Cache and background-translation failures are logged but never propagate
 * — this function always returns either an {@link AssetInfo} or `null`
 * (when the symbol is invalid or no U.S.-listed match exists).
 *
 * @param symbol - Ticker symbol; case-insensitive (uppercased internally).
 * @returns The resolved asset info, or `null` when the symbol cannot be
 *   identified on any U.S. exchange.
 *
 * @example
 * ```ts
 * const info = await getAssetInfo('aapl');
 * if (info) console.log(info.name, info.koreanName);
 * ```
 *
 * @see searchTicker
 */
export async function getAssetInfo(symbol: string): Promise<AssetInfo | null> {
    const upper = symbol.toUpperCase();
    if (!isValidTickerFormat(upper)) return null;

    const cache = createCacheProvider();
    const cacheKey = buildAssetInfoCacheKey(upper);

    if (cache) {
        try {
            const cached = await cache.get<AssetInfo>(cacheKey);
            if (cached) return cached;
        } catch {
            // Graceful degradation: cache read failure falls through to provider fetch.
        }
    }

    const fmpResults = await searchBySymbol(upper);
    const usResults = filterUsExchanges(fmpResults);
    const match = usResults.find(r => r.symbol === upper) ?? usResults[0];
    if (!match) return null;

    const { name, exchange, exchangeFullName } = match;

    const koreanNames = await getKoreanNames([upper]);
    const koreanName = koreanNames[upper];

    const info: AssetInfo = {
        symbol: upper,
        name,
        ...(koreanName && { koreanName }),
    };

    if (!koreanName) {
        translateAndCache(
            upper,
            { name, exchange, exchangeFullName },
            cache
        ).catch(e =>
            console.warn('[getAssetInfo] background translation failed', e)
        );
    }

    if (cache) {
        const ttl = koreanName
            ? ASSET_INFO_CACHE_TTL_WITH_KOREAN
            : ASSET_INFO_CACHE_TTL_WITHOUT_KOREAN;
        cache
            .set(cacheKey, info, ttl)
            .catch(e => console.warn('[getAssetInfo] cache write failed', e));
    }

    return info;
}
