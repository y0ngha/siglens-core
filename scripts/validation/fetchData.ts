import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Bar, Timeframe } from '../../src/domain/types';
import { requireFmpApiKey } from './loadEnv';

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const CACHE_DIR = join(import.meta.dirname, '.cache');
const RETRY_WAIT_MS = 60_000; // D6: wait 1 minute, then retry
const MAX_RETRIES = 3;
const MS_PER_SECOND = 1000;

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
        EST_OFFSET * 3600 * MS_PER_SECOND;
    return {
        time: Math.floor(utcMs / MS_PER_SECOND),
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
    };
}

async function fmpGetWithRetry(url: string): Promise<FmpRow[]> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = (await res.json()) as FmpRow[];
            if (!Array.isArray(json)) throw new Error('non-array response');
            return json;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (attempt === MAX_RETRIES) {
                throw new Error(
                    `FMP fetch failed after ${MAX_RETRIES} tries: ${msg}`
                );
            }
            console.warn(
                `  [fetch] attempt ${attempt} failed (${msg}) — waiting 60s then retrying`
            );
            await sleep(RETRY_WAIT_MS); // D6
        }
    }
    return [];
}

/**
 * Fetch ~`from`..`to` bars for one symbol/timeframe, caching to
 * `.cache/{SYMBOL}_{TF}.json`. Cached files are reused unless `refresh` is set.
 * On total fetch failure the caller decides to skip (returns []).
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
        return JSON.parse(readFileSync(path, 'utf-8')) as Bar[];
    }

    const apikey = requireFmpApiKey();
    let bars: Bar[];
    if (tf === '1Day') {
        const url = `${FMP_BASE}/historical-price-eod/full?symbol=${symbol}&from=${from}&to=${to}&apikey=${apikey}`;
        bars = (await fmpGetWithRetry(url)).map(dailyToBar).reverse();
    } else {
        const interval = INTRADAY_MAP[tf];
        if (!interval) throw new Error(`unsupported timeframe ${tf}`);
        const url = `${FMP_BASE}/historical-chart/${interval}?symbol=${symbol}&from=${from}&to=${to}&apikey=${apikey}`;
        bars = (await fmpGetWithRetry(url)).map(intradayToBar).reverse();
    }

    if (bars.length > 0) {
        writeFileSync(path, JSON.stringify(bars), 'utf-8'); // D5: persist once
    }
    return bars;
}
