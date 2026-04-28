import type { AssetInfoMatch } from '@/application/ticker/types';
import { isValidTickerFormat } from '@/domain/ticker';
import type { AssetInfo, KoreanTickerEntry } from '@/domain/types';
import {
    ASSET_INFO_CACHE_TTL_WITH_KOREAN,
    ASSET_INFO_CACHE_TTL_WITHOUT_KOREAN,
    buildAssetInfoCacheKey,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import type { CacheProvider } from '@/infrastructure/cache/types';
import { tryGetDatabaseClient } from '@/infrastructure/db/client';
import { DrizzleAssetTranslationRepository } from '@/infrastructure/db/tickerRepository';
import type {
    AssetTranslationRecord,
    AssetTranslationRepository,
} from '@/infrastructure/db/types';
import {
    filterUsExchanges,
    searchBySymbol,
} from '@/infrastructure/ticker/fmpTickerApi';
import {
    getKoreanNames,
    setKoreanTickers,
} from '@/application/ticker/koreanNameStore';
import { translateCompanyNames } from '@/infrastructure/ticker/koreanTranslator';

function tryGetRepository(): AssetTranslationRepository | null {
    const client = tryGetDatabaseClient();
    if (!client) return null;
    return new DrizzleAssetTranslationRepository(client.db);
}

function recordToAssetInfo(record: AssetTranslationRecord): AssetInfo {
    return {
        symbol: record.symbol,
        name: record.name,
        koreanName: record.koreanName,
        ...(record.fmpSymbol !== record.symbol && {
            fmpSymbol: record.fmpSymbol,
        }),
    };
}

async function readFromDatabase(symbol: string): Promise<AssetInfo | null> {
    const repository = tryGetRepository();
    if (!repository) return null;

    try {
        const record = await repository.findBySymbol(symbol);
        return record ? recordToAssetInfo(record) : null;
    } catch (e) {
        console.warn('[getAssetInfo] DB read failed', e);
        return null;
    }
}

async function persistTranslation(
    symbol: string,
    fmpSymbol: string,
    name: string,
    koreanName: string,
    cache: CacheProvider | null
): Promise<void> {
    const repository = tryGetRepository();
    if (repository) {
        try {
            await repository.upsert({
                symbol,
                name,
                koreanName,
                fmpSymbol,
            });
        } catch (e) {
            console.warn('[getAssetInfo] DB upsert failed', e);
            return;
        }
    }

    if (!cache) return;
    try {
        await cache.set(
            buildAssetInfoCacheKey(symbol),
            {
                symbol,
                name,
                koreanName,
                ...(fmpSymbol !== symbol && { fmpSymbol }),
            },
            ASSET_INFO_CACHE_TTL_WITH_KOREAN
        );
    } catch (e) {
        console.warn('[getAssetInfo] cache write failed', e);
    }
}

async function translateAndPersist(
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
    await persistTranslation(
        symbol,
        match.symbol,
        match.name,
        koreanName,
        cache
    );
}

/**
 * Resolve canonical asset information for a single ticker symbol.
 *
 * Pipeline:
 * 1. Validate symbol format via {@link isValidTickerFormat}; reject otherwise.
 * 2. Look up the Redis cache (separate TTLs for entries with vs. without a
 *    Korean name).
 * 3. On cache miss, look up the persistent `asset_translations` table —
 *    when found, write through to the cache and return.
 * 4. On both miss, query FMP, filter to U.S. exchanges, prefer an exact
 *    symbol match.
 * 5. Look up the Korean name in the persistent store. If absent, fire a
 *    background translation job that upserts the asset_translations row +
 *    cache; otherwise upsert immediately.
 *
 * Cache, DB, and background-translation failures are logged but never
 * propagate — this function always returns either an {@link AssetInfo} or
 * `null` (when the symbol is invalid or no U.S.-listed match exists).
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

    const fromDb = await readFromDatabase(upper);
    if (fromDb) {
        if (cache) {
            cache
                .set(cacheKey, fromDb, ASSET_INFO_CACHE_TTL_WITH_KOREAN)
                .catch(e =>
                    console.warn('[getAssetInfo] cache write failed', e)
                );
        }
        return fromDb;
    }

    const fmpResults = await searchBySymbol(upper);
    const usResults = filterUsExchanges(fmpResults);
    const match = usResults.find(r => r.symbol === upper) ?? usResults[0];
    if (!match) return null;

    const { symbol: fmpSymbol, name, exchange, exchangeFullName } = match;

    const koreanNames = await getKoreanNames([upper]);
    const koreanName = koreanNames[upper];

    const info: AssetInfo = {
        symbol: upper,
        name,
        ...(fmpSymbol !== upper && { fmpSymbol }),
        ...(koreanName && { koreanName }),
    };

    if (koreanName) {
        persistTranslation(upper, fmpSymbol, name, koreanName, cache).catch(e =>
            console.warn('[getAssetInfo] persist failed', e)
        );
        return info;
    }

    translateAndPersist(
        upper,
        { symbol: fmpSymbol, name, exchange, exchangeFullName },
        cache
    ).catch(e =>
        console.warn('[getAssetInfo] background translation failed', e)
    );

    if (cache) {
        cache
            .set(cacheKey, info, ASSET_INFO_CACHE_TTL_WITHOUT_KOREAN)
            .catch(e => console.warn('[getAssetInfo] cache write failed', e));
    }

    return info;
}
