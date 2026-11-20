/**
 * Fetches the US symbols' daily bars and company names from FMP into one `StoredBars`
 * file per symbol (operator step: it makes network requests with a production key).
 * Korean listings are not fetched here: core has no Yahoo provider, see `README.md`.
 *
 * Usage:
 *   SIGLENS_ENV_FILE=<path> npx tsx scripts/replay/fetchBars.ts --symbols <A,B|all-us> --from 2017-01-03 --to <date> --out <dir> [--execute] [--force]
 *
 * Without `--execute` it prints the plan (symbols and request count) and exits: nothing
 * is requested. The key comes from `FMP_API_KEY` or the file named by `SIGLENS_ENV_FILE`
 * (`scripts/validation/loadEnv.ts`) and is never printed; error messages carry the HTTP
 * status only, never the URL. Two requests per symbol (EOD bars, then the profile for the
 * company name). An existing file is kept unless `--force`.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from '../ab-harness/cliArgs';
import { requireFmpApiKey } from '../validation/loadEnv';
import { assertOutsideRepo, writeJsonAtomic } from './fsUtil';
import { REPLAY_BARS_FROM, REPLAY_US_SYMBOLS } from './symbols';
import type { StoredBars } from './types';
import type { Bar } from '@/domain/types';

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const RETRY_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);
export const FETCH_ATTEMPTS = 4;
export const REQUESTS_PER_SYMBOL = 2;
const RETRY_BASE_MS = 5_000;
const PAUSE_BETWEEN_SYMBOLS_MS = 300;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface FmpEodRow {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface FetchDeps {
    fetchImpl: typeof fetch;
    apiKey: string;
    sleep: (ms: number) => Promise<void>;
    now: () => Date;
}

/** FMP daily row to a core bar stamped at UTC midnight (the production provider's mapping). */
export function toBar(row: FmpEodRow): Bar {
    return {
        time: Math.floor(Date.parse(`${row.date}T00:00:00Z`) / 1000),
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
    };
}

/**
 * One GET with retries on rate-limit and server errors (waiting `5 s × attempt`). The
 * failure message is the status only: the URL carries the key.
 */
export async function fmpGet(
    deps: FetchDeps,
    path: string,
    query: Readonly<Record<string, string>>,
    attempt = 1
): Promise<unknown> {
    const params = new URLSearchParams({ ...query, apikey: deps.apiKey });
    const response = await deps.fetchImpl(`${FMP_BASE}/${path}?${params}`);
    if (response.ok) return response.json();
    if (RETRY_STATUSES.has(response.status) && attempt < FETCH_ATTEMPTS) {
        await deps.sleep(RETRY_BASE_MS * attempt);
        return fmpGet(deps, path, query, attempt + 1);
    }
    throw new Error(`FMP ${path} ${query.symbol}: HTTP ${response.status}`);
}

const PRICE_FIELDS = ['open', 'high', 'low', 'close', 'volume'] as const;

/** A row of the EOD reply: an ISO date and finite OHLCV numbers. */
function isEodRow(value: unknown): value is FmpEodRow {
    if (typeof value !== 'object' || value === null) return false;
    // `value` is a non-null object here; its fields are read as `unknown` and each one is
    // checked below, so nothing is assumed about them.
    const row = value as Record<string, unknown>;
    return (
        typeof row.date === 'string' &&
        ISO_DATE.test(row.date) &&
        PRICE_FIELDS.every(field => Number.isFinite(row[field]))
    );
}

function companyNameOf(profile: unknown, fallback: string): string {
    const first: unknown = Array.isArray(profile) ? profile[0] : null;
    const name =
        typeof first === 'object' && first !== null
            ? // `first` is a non-null object; `companyName` is read as `unknown` and checked
              // to be a non-empty string below, so a missing or odd value falls back.
              (first as { companyName?: unknown }).companyName
            : undefined;
    return typeof name === 'string' && name !== '' ? name : fallback;
}

/** Bars (oldest first) and company name of one symbol, as a `StoredBars`. */
export async function fetchStoredBars(
    deps: FetchDeps,
    symbol: string,
    from: string,
    to: string
): Promise<StoredBars> {
    const rows = await fmpGet(deps, 'historical-price-eod/full', {
        symbol,
        from,
        to,
    });
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error(`FMP bars for ${symbol}: empty or not an array`);
    }
    const valid = rows.filter(isEodRow);
    if (valid.length !== rows.length) {
        const bad = rows.findIndex(row => !isEodRow(row));
        throw new Error(`FMP bars for ${symbol}: row ${bad} is malformed`);
    }
    const profile = await fmpGet(deps, 'profile', { symbol });
    const bars = valid.map(toBar).toReversed();
    return {
        ticker: symbol,
        companyName: companyNameOf(profile, symbol),
        fetchedAt: deps.now().toISOString(),
        from: valid[valid.length - 1].date,
        to: valid[0].date,
        bars,
    };
}

export interface FetchPlan {
    symbols: readonly string[];
    requests: number;
    /** Every request retried up to the last attempt (`FETCH_ATTEMPTS`). */
    worstCaseRequests: number;
}

export function planFetch(symbols: readonly string[]): FetchPlan {
    const requests = symbols.length * REQUESTS_PER_SYMBOL;
    return { symbols, requests, worstCaseRequests: requests * FETCH_ATTEMPTS };
}

/** `all-us` or a comma list; every symbol must be one of the replay's US symbols. */
export function parseSymbols(raw: string): readonly string[] {
    const symbols =
        raw === 'all-us'
            ? REPLAY_US_SYMBOLS
            : raw.split(',').map(s => s.trim());
    const unknown = symbols.filter(s => !REPLAY_US_SYMBOLS.includes(s));
    if (symbols.length === 0 || unknown.length > 0) {
        throw new Error(
            `--symbols must be all-us or replay US symbols; got ${unknown.join(', ') || 'none'}`
        );
    }
    return symbols;
}

/**
 * Fetches the symbols one after another (a pause between them keeps the request rate far
 * under the plan limit) and writes `<out>/<SYMBOL>.json`. Skips an existing file unless `force`.
 * Returns the symbols written.
 */
export async function fetchAll(
    deps: FetchDeps,
    options: {
        symbols: readonly string[];
        from: string;
        to: string;
        out: string;
        force: boolean;
        log: (line: string) => void;
    }
): Promise<readonly string[]> {
    assertOutsideRepo(options.out);
    const written = new Set<string>();
    const fetchOne = async (symbol: string): Promise<void> => {
        const file = join(options.out, `${symbol}.json`);
        if (existsSync(file) && !options.force) {
            options.log(`[${symbol}] exists, skipped`);
            return;
        }
        const stored = await fetchStoredBars(
            deps,
            symbol,
            options.from,
            options.to
        );
        writeJsonAtomic(file, stored);
        options.log(
            `[${symbol}] ${stored.bars.length} bars ${stored.from}..${stored.to}`
        );
        written.add(symbol);
        await deps.sleep(PAUSE_BETWEEN_SYMBOLS_MS);
    };
    await options.symbols.reduce<Promise<void>>(
        (previous, symbol) => previous.then(() => fetchOne(symbol)),
        Promise.resolve()
    );
    return [...written];
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const from = args.from ?? REPLAY_BARS_FROM;
    const { to } = args;
    if (
        !args.symbols ||
        !args.out ||
        !to ||
        ![from, to].every(d => ISO_DATE.test(d))
    ) {
        throw new Error(
            'usage: fetchBars.ts --symbols <A,B|all-us> [--from YYYY-MM-DD] --to YYYY-MM-DD --out <dir> [--execute] [--force]'
        );
    }
    const symbols = parseSymbols(args.symbols);
    const plan = planFetch(symbols);
    console.log(
        `plan: ${plan.symbols.length} symbols, ${plan.requests} FMP requests (up to ${plan.worstCaseRequests} with retries: ${FETCH_ATTEMPTS} attempts each), ${from}..${to}`
    );
    if (args.execute !== 'true') {
        console.log('dry run: nothing requested. Add --execute to fetch.');
        return;
    }
    await fetchAll(
        {
            fetchImpl: fetch,
            apiKey: requireFmpApiKey(),
            sleep: ms => new Promise(done => setTimeout(done, ms)),
            now: () => new Date(),
        },
        {
            symbols,
            from,
            to,
            out: resolve(args.out),
            force: args.force === 'true',
            log: console.log,
        }
    );
}

if (require.main === module) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
