import type { KoreanTickerEntry, TickerSearchResult } from '@/domain/types';
import {
    KOREAN_NAMES_CACHE_TTL,
    KOREAN_TICKERS_CACHE_KEY,
} from '@/infrastructure/cache/config';
import { createCacheProvider } from '@/infrastructure/cache/redis';
import type { CacheProvider } from '@/infrastructure/cache/types';
import { tryGetDatabaseClient } from '@/infrastructure/db/client';
import { DrizzleKoreanTickerRepository } from '@/infrastructure/db/tickerRepository';
import type { KoreanTickerRepository } from '@/infrastructure/db/types';

function koreanEntryToSearchResult(
    entry: KoreanTickerEntry
): TickerSearchResult {
    return {
        symbol: entry.symbol,
        name: entry.name,
        koreanName: entry.koreanName,
        exchange: entry.exchange,
        exchangeFullName: entry.exchangeFullName,
    };
}

function tryGetRepository(): KoreanTickerRepository | null {
    const client = tryGetDatabaseClient();
    if (!client) return null;
    return new DrizzleKoreanTickerRepository(client.db);
}

async function readFromCache(
    cache: CacheProvider
): Promise<KoreanTickerEntry[] | null> {
    try {
        return await cache.get<KoreanTickerEntry[]>(KOREAN_TICKERS_CACHE_KEY);
    } catch {
        return null;
    }
}

async function writeToCache(
    cache: CacheProvider,
    entries: KoreanTickerEntry[]
): Promise<void> {
    try {
        await cache.set(
            KOREAN_TICKERS_CACHE_KEY,
            entries,
            KOREAN_NAMES_CACHE_TTL
        );
    } catch {
        // Graceful degradation: cache write failure should not propagate.
    }
}

async function loadEntriesFromCache(
    cache: CacheProvider | null
): Promise<KoreanTickerEntry[] | null> {
    if (!cache) return null;

    return readFromCache(cache);
}

async function loadAllEntries(): Promise<KoreanTickerEntry[]> {
    const cache = createCacheProvider();
    const cached = await loadEntriesFromCache(cache);
    if (cached !== null) return cached;

    const repository = tryGetRepository();
    if (!repository) return [];

    const entries = await readAllFromDatabase(repository);
    if (cache && entries.length > 0) {
        await writeToCache(cache, entries);
    }
    return entries;
}

async function loadEntriesBySymbols(
    symbols: readonly string[]
): Promise<KoreanTickerEntry[]> {
    const cache = createCacheProvider();
    const cached = await loadEntriesFromCache(cache);
    if (cached !== null) {
        const symbolSet = new Set(symbols);
        return cached.filter(entry => symbolSet.has(entry.symbol));
    }

    const repository = tryGetRepository();
    if (!repository) return [];

    return readBySymbolsFromDatabase(repository, symbols);
}

async function readAllFromDatabase(
    repository: KoreanTickerRepository
): Promise<KoreanTickerEntry[]> {
    try {
        return await repository.findAll();
    } catch (e) {
        console.warn('[koreanNameStore] DB read failed', e);
        return [];
    }
}

async function readBySymbolsFromDatabase(
    repository: KoreanTickerRepository,
    symbols: readonly string[]
): Promise<KoreanTickerEntry[]> {
    try {
        return await repository.findBySymbols(symbols);
    } catch (e) {
        console.warn('[koreanNameStore] DB read failed', e);
        return [];
    }
}

/** @internal Korean-name substring lookup over the cached/persisted ticker store. */
export async function searchByKoreanName(
    query: string
): Promise<TickerSearchResult[]> {
    const entries = await loadAllEntries();
    const normalizedQuery = query.toLowerCase();
    return entries
        .filter(entry =>
            entry.koreanName.toLowerCase().includes(normalizedQuery)
        )
        .map(koreanEntryToSearchResult);
}

/** @internal Resolve Korean names for a list of canonical ticker symbols. */
export async function getKoreanNames(
    symbols: string[]
): Promise<Record<string, string>> {
    if (symbols.length === 0) return {};

    const entries = await loadEntriesBySymbols(symbols);
    const symbolMap = new Map(entries.map(e => [e.symbol, e.koreanName]));

    const pairs = symbols.flatMap<readonly [string, string]>(symbol => {
        const koreanName = symbolMap.get(symbol);
        return koreanName ? [[symbol, koreanName]] : [];
    });
    // Object.fromEntries widens to { [k: string]: string } but pairs is readonly [string, string][], so the cast is safe.
    return Object.fromEntries(pairs) as Record<string, string>;
}

function mergeEntries(
    existing: readonly KoreanTickerEntry[],
    incoming: readonly KoreanTickerEntry[]
): KoreanTickerEntry[] {
    const incomingSymbols = new Set(incoming.map(e => e.symbol));
    return [
        ...existing.filter(e => !incomingSymbols.has(e.symbol)),
        ...incoming,
    ];
}

/** @internal Upsert ticker entries to the DB and refresh the Redis cache. */
export async function setKoreanTickers(
    newEntries: KoreanTickerEntry[]
): Promise<void> {
    if (newEntries.length === 0) return;

    const repository = tryGetRepository();
    if (repository) {
        try {
            await repository.upsertMany(newEntries);
        } catch (e) {
            console.warn('[koreanNameStore] DB upsert failed', e);
            return;
        }
    }

    const cache = createCacheProvider();
    if (!cache) return;

    try {
        const existing =
            (await cache.get<KoreanTickerEntry[]>(KOREAN_TICKERS_CACHE_KEY)) ??
            [];
        await cache.set(
            KOREAN_TICKERS_CACHE_KEY,
            mergeEntries(existing, newEntries),
            KOREAN_NAMES_CACHE_TTL
        );
    } catch {
        // Graceful degradation: persistence failure should not propagate.
    }
}
