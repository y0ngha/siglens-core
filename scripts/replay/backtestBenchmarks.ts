/**
 * The backtest benchmark instrument (WP-26 core-1): for one stored backtest run, the figures a
 * return needs next to it: the hold portfolio, the exposure-matched hold, the strategy's
 * mark-to-market drawdown, the per-trade excess over the same-length drift with a week-cluster
 * interval, the random-entry placebo and the bracket placebo. The definitions are
 * pre-registered in `backtestBenchmarksCompute.ts`.
 *
 *   npx tsx scripts/replay/backtestBenchmarks.ts --run <data-repo run dir> \
 *       --page-data <data.json> --out <dir> [--allow-dirty]
 *
 * Reads `<run>/data/bars/<TICKER>.json` for the run's tickers and the page data's `run`,
 * `baselines` and `trades`; writes `benchmarks.json` (the `BacktestBenchmarks` the page data
 * embeds), `per-trade.csv`, `perTicker.json` and `diagnostics.json` into `--out`. No network,
 * no model, no clock: the same checkout and inputs give byte-identical files.
 *
 * Fails closed (exit 2, TE-16) on a dirty checkout, an output path inside this repository, a
 * bars fingerprint it does not know, a missing ticker or trade date, a run whose tickers and
 * baselines differ, no trades, trades that overlap or are still open, bars that do not
 * reproduce the stored baselines, stored returns that do not match their legs, a first half
 * that ended at a stored level the initial plan cannot explain, and any figure that is not
 * finite. Any other error exits 1. `--allow-dirty` lets an uncommitted checkout be inspected
 * and keeps the `+dirty` sha in the output; re-run on a clean commit for the stored file.
 *
 * Reproduction (env-gated): `BACKTEST_RUN_DIR=<run dir> BACKTEST_PAGE_DATA=<data.json> yarn
 * test src/__tests__/scripts/replay/backtestBenchmarksReal.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from '../ab-harness/cliArgs';
import {
    FailClosedError,
    computeBenchmarks,
    roundForOutput,
    type BenchmarkBaseline,
    type BenchmarkResult,
    type BenchmarkTrade,
} from './backtestBenchmarksCompute';
import { dirtyDiffSha256 } from './engineEval';
import {
    REPO_ROOT,
    assertOutsideRepo,
    gitOutput,
    sha256Hex,
    writeFileAtomic,
} from './fsUtil';
import { canonicalJson } from '@/domain/canonicalJson';
import type { Bar } from '@/domain/types';

/**
 * Fingerprints of the bars of the runs this instrument may measure (`barsFingerprint`): the
 * stored sets the pre-registered definitions were written for. Another set is a decision.
 */
export const KNOWN_BARS_FINGERPRINTS: readonly string[] = [
    '4b8d0f13f34282105e901c961b841de787ae9ed82eb5b49c0ce19f095df8ad98',
];

export { FailClosedError };

export interface BenchmarkArgs {
    run: string;
    pageData: string;
    out: string;
    allowDirty: boolean;
}

export function parseBenchmarkArgs(argv: readonly string[]): BenchmarkArgs {
    const raw = parseArgs(argv);
    const missing = (['run', 'page-data', 'out'] as const).filter(
        name => !raw[name]
    );
    if (missing.length > 0) {
        throw new Error(`missing ${missing.map(m => `--${m}`).join(', ')}`);
    }
    return {
        run: resolve(raw.run),
        pageData: resolve(raw['page-data']),
        out: resolve(raw.out),
        allowDirty: raw['allow-dirty'] === 'true',
    };
}

/** What the CLI reads of the page data; the rest of the file is not its business. */
export interface PageDataRun {
    run: {
        runId?: string;
        periodStart: string;
        periodEnd: string;
        tickers: readonly string[];
    };
    baselines: readonly BenchmarkBaseline[];
    trades: readonly BenchmarkTrade[];
}

/** SHA-256 of the canonical JSON of the trades: the pairing key between a benchmark and its trades. */
export const tradesSha256 = (trades: readonly unknown[]): string =>
    sha256Hex(canonicalJson(trades));

/**
 * Fingerprint of the bars files of `tickers`: SHA-256 over `TICKER:sha256(file bytes)` lines in
 * ticker order.
 */
export function barsFingerprintOf(
    runDir: string,
    tickers: readonly string[]
): string {
    return sha256Hex(
        tickers
            .toSorted()
            .map(t => {
                try {
                    return `${t}:${sha256Hex(readFileSync(join(runDir, 'data', 'bars', `${t}.json`)))}`;
                } catch (error) {
                    throw new FailClosedError(
                        `no bars file for ${t} in ${runDir}: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            })
            .join('\n')
    );
}

export interface BenchmarkDeps {
    gitSha: () => string;
    dirtyDiffSha256: () => string | null;
    knownFingerprints: readonly string[];
    log: (line: string) => void;
}

export const defaultBenchmarkDeps: BenchmarkDeps = {
    gitSha: () =>
        `${gitOutput(['rev-parse', 'HEAD'])}${gitOutput(['status', '--porcelain']) === '' ? '' : '+dirty'}`,
    dirtyDiffSha256,
    knownFingerprints: KNOWN_BARS_FINGERPRINTS,
    log: console.log,
};

function readStoredBars(runDir: string, ticker: string): readonly Bar[] {
    try {
        const parsed: unknown = JSON.parse(
            readFileSync(
                join(runDir, 'data', 'bars', `${ticker}.json`),
                'utf-8'
            )
        );
        const bars =
            typeof parsed === 'object' && parsed !== null
                ? (parsed as { bars?: unknown }).bars
                : undefined;
        if (!Array.isArray(bars)) {
            throw new Error('no bars array');
        }
        // The shape is the stored-bars file `fetchBars` and the data repository write.
        return bars as Bar[];
    } catch (error) {
        throw new FailClosedError(
            `no readable bars for ${ticker} in ${runDir}: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

function readPageData(path: string): PageDataRun {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    const record = (
        typeof parsed === 'object' && parsed !== null ? parsed : {}
    ) as Partial<PageDataRun>;
    if (
        record.run === undefined ||
        !Array.isArray(record.run.tickers) ||
        !Array.isArray(record.baselines) ||
        !Array.isArray(record.trades)
    ) {
        throw new FailClosedError(
            `${path} is not backtest page data (run.tickers, baselines and trades are required)`
        );
    }
    // The shape is `BacktestRunData`, which the data repository's export writes.
    return record as PageDataRun;
}

const CSV_HEADER =
    'ticker,decision_date,entry_date,return_pct,same_length_drift_pct,excess_pct';

export function perTradeCsv(rows: BenchmarkResult['perTrade']): string {
    return `${[
        CSV_HEADER,
        ...rows.map(r =>
            [
                r.ticker,
                r.decisionDate,
                r.entryDate,
                r.returnPct.toFixed(2),
                r.sameLengthDriftPct.toFixed(4),
                r.excessPct.toFixed(4),
            ].join(',')
        ),
    ].join('\n')}\n`;
}

/** The files of one run, as text keyed by file name. */
export function generateBenchmarkFiles(
    args: BenchmarkArgs,
    deps: BenchmarkDeps
): Record<string, string> {
    if (!args.allowDirty) {
        const sha = deps.gitSha();
        if (sha.endsWith('+dirty') || deps.dirtyDiffSha256() !== null) {
            throw new FailClosedError(
                `the checkout is dirty (${sha}); run on a clean commit or pass --allow-dirty to inspect`
            );
        }
    }
    const page = readPageData(args.pageData);
    const fingerprint = barsFingerprintOf(args.run, page.run.tickers);
    if (!deps.knownFingerprints.includes(fingerprint)) {
        throw new FailClosedError(
            `unknown bars fingerprint ${fingerprint}: the definitions were written for ${deps.knownFingerprints.join(', ')}`
        );
    }
    const result = computeBenchmarks({
        run: page.run,
        baselines: page.baselines,
        trades: page.trades,
        bars: Object.fromEntries(
            page.run.tickers.map(t => [t, readStoredBars(args.run, t)])
        ),
        identity: {
            tradesSha256: tradesSha256(page.trades),
            barsFingerprint: fingerprint,
            coreSha: deps.gitSha(),
        },
    });
    const json = (value: unknown): string =>
        `${JSON.stringify(roundForOutput(value), null, 2)}\n`;
    return {
        'benchmarks.json': json(result.benchmarks),
        'per-trade.csv': perTradeCsv(result.perTrade),
        'perTicker.json': json(result.perTicker),
        'diagnostics.json': json(result.diagnostics),
    };
}

/** Writes the files and returns the exit code: 0, or 2 when the instrument refused. */
export function runBacktestBenchmarks(
    args: BenchmarkArgs,
    deps: BenchmarkDeps = defaultBenchmarkDeps
): number {
    try {
        try {
            assertOutsideRepo(args.out, REPO_ROOT);
        } catch (error) {
            throw new FailClosedError(
                error instanceof Error ? error.message : String(error)
            );
        }
        const files = generateBenchmarkFiles(args, deps);
        Object.entries(files).forEach(([name, text]) => {
            writeFileAtomic(join(args.out, name), text);
        });
        deps.log(`wrote ${Object.keys(files).join(', ')} to ${args.out}`);
        return 0;
    } catch (error) {
        if (error instanceof FailClosedError) {
            deps.log(`FAIL: ${error.message}`);
            return 2;
        }
        throw error;
    }
}

if (require.main === module) {
    try {
        process.exitCode = runBacktestBenchmarks(
            parseBenchmarkArgs(process.argv.slice(2))
        );
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
