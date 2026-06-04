import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Bar, Timeframe } from '@/domain/types';
import { requireFmpApiKey } from './loadEnv';

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const CACHE_DIR = join(import.meta.dirname, '.cache');
const RETRY_WAIT_MS = 60_000; // D6: wait 1 minute, then retry
const MAX_RETRIES = 3;
const MS_PER_SECOND = 1000;
const SECONDS_PER_HOUR = 3600;

const INTRADAY_MAP: Partial<Record<Timeframe, string>> = {
    '15Min': '15min',
    '1Hour': '1hour',
    '4Hour': '4hour',
};

interface FmpRow {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

const sleep = (ms: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, ms));

function cachePath(symbol: string, tf: Timeframe): string {
    return join(CACHE_DIR, `${symbol.toUpperCase()}_${tf}.json`);
}

/** ISO date string (UTC midnight) → unix seconds. */
function dailyToBar(r: FmpRow): Bar {
    return {
        time: Math.floor(
            new Date(r.date + 'T00:00:00Z').getTime() / MS_PER_SECOND
        ),
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
    };
}

/** FMP intraday "YYYY-MM-DD HH:mm:ss" (ET) → unix seconds (approx UTC). */
function intradayToBar(r: FmpRow): Bar {
    // ET offset is handled coarsely here (validation tolerance); production uses
    // FmpMarketProvider's exact DST conversion. EST = UTC−5, so add 5h to reach UTC.
    const EST_OFFSET = 5;
    const utcMs =
        new Date(r.date.replace(' ', 'T') + 'Z').getTime() +
        EST_OFFSET * SECONDS_PER_HOUR * MS_PER_SECOND;
    return {
        time: Math.floor(utcMs / MS_PER_SECOND),
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
    };
}

/** Single FMP GET; throws on non-OK status or non-array response. */
async function fetchOnce(url: string): Promise<FmpRow[]> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // res.json() is typed `unknown`; the FMP success path returns a JSON array.
    // The Array.isArray() guard on the next line validates the top-level shape;
    // per-field FmpRow types are assumed from the FMP API contract (dev tooling).
    const json = (await res.json()) as FmpRow[];
    if (!Array.isArray(json)) throw new Error('non-array response');
    return json;
}

/**
 * GET with retry: attempts 1..MAX_RETRIES-1 retry after a 60s wait (D6); the
 * final attempt runs outside the loop so its failure propagates. The function
 * therefore always returns a successful response or throws — no unreachable tail.
 */
async function fmpGetWithRetry(url: string): Promise<FmpRow[]> {
    for (let attempt = 1; attempt < MAX_RETRIES; attempt++) {
        try {
            return await fetchOnce(url);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(
                `  [fetch] attempt ${attempt} failed (${msg}) — waiting 60s then retrying`
            );
            await sleep(RETRY_WAIT_MS); // D6
        }
    }
    try {
        return await fetchOnce(url);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`FMP fetch failed after ${MAX_RETRIES} tries: ${msg}`);
    }
}

/** Fetch + normalize bars for one symbol/timeframe (oldest-first). */
async function fetchRawBars(
    symbol: string,
    tf: Timeframe,
    from: string,
    to: string
): Promise<Bar[]> {
    const apikey = requireFmpApiKey();
    if (tf === '1Day') {
        const url = `${FMP_BASE}/historical-price-eod/full?symbol=${symbol}&from=${from}&to=${to}&apikey=${apikey}`;
        return (await fmpGetWithRetry(url)).map(dailyToBar).toReversed();
    }
    const interval = INTRADAY_MAP[tf];
    if (!interval) throw new Error(`unsupported timeframe ${tf}`);
    const url = `${FMP_BASE}/historical-chart/${interval}?symbol=${symbol}&from=${from}&to=${to}&apikey=${apikey}`;
    return (await fmpGetWithRetry(url)).map(intradayToBar).toReversed();
}

/**
 * Fetch ~`from`..`to` bars for one symbol/timeframe, caching to
 * `.cache/{SYMBOL}_{TF}.json`. Cached files are reused unless `refresh` is set.
 * On total fetch failure the caller decides whether to skip.
 */
export async function fetchBarsCached(
    symbol: string,
    tf: Timeframe,
    from: string,
    to: string,
    refresh = false
): Promise<Bar[]> {
    mkdirSync(CACHE_DIR, { recursive: true });
    const path = cachePath(symbol, tf);
    if (!refresh && existsSync(path)) {
        // JSON.parse returns `any`; this cache file is written only by the
        // writeFileSync below from already-normalized Bar[] data, so its shape
        // is guaranteed to match Bar[].
        return JSON.parse(readFileSync(path, 'utf-8')) as Bar[];
    }

    const bars = await fetchRawBars(symbol, tf, from, to);
    if (bars.length > 0) {
        writeFileSync(path, JSON.stringify(bars), 'utf-8'); // D5: persist once
    }
    return bars;
}
